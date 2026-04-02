import { Response } from 'express';
import { SlashBody } from '../slack/router';
import { supabase, getPendingArticles, getActiveSources, addSource, getSetting, setSetting, getAllSettings, updateArticle, getArticle } from '../lib/supabase';
import { postMessage, buildStatusCard, buildDebugCard, postSimple } from '../slack/blocks';
import { ENV } from '../lib/env';
import { log } from '../lib/logger';
import { runWF1 } from '../jobs/wf1-scan';
import { runWF2 } from '../jobs/wf2-threading';

// ─── /sc-status ───────────────────────────────────────────────────────────────

export async function handleSlashStatus(body: SlashBody, res: Response) {
  res.json({ response_type: 'ephemeral', text: '⏳ Fetching status...' });

  try {
    const [articles, pitches, blogs, pendingSends, brokers] = await Promise.all([
      supabase.from('articles').select('queue', { count: 'exact', head: false }),
      supabase.from('narrative_pitches').select('status', { count: 'exact', head: false }),
      supabase.from('blog_posts').select('status', { count: 'exact', head: false }),
      supabase.from('pending_sends').select('status').eq('status', 'pending'),
      supabase.from('brokers').select('status').eq('status', 'active'),
    ]);

    const articleRows = articles.data || [];
    const pitchRows = pitches.data || [];
    const blogRows = blogs.data || [];

    const counts = (rows: Array<{[k:string]:string}>, key: string, val: string) =>
      rows.filter(r => r[key] === val).length;

    const blocks = buildStatusCard([
      { label: '📰 Articles — pending',   value: String(counts(articleRows, 'queue', 'pending')) },
      { label: '📰 Articles — approved',  value: String(counts(articleRows, 'queue', 'approved')) },
      { label: '🎯 Pitches — pending',    value: String(counts(pitchRows, 'status', 'pending')) },
      { label: '🎯 Pitches — approved',   value: String(counts(pitchRows, 'status', 'approved')) },
      { label: '📝 Blogs — draft',        value: String(counts(blogRows, 'status', 'draft')) },
      { label: '📝 Blogs — approved',     value: String(counts(blogRows, 'status', 'approved')) },
      { label: '📧 Newsletters queued',   value: String(pendingSends.data?.length || 0) },
      { label: '🤝 Active brokers',       value: String(brokers.data?.length || 0) },
    ]);

    await postMessage(body.channel_id, blocks, 'System Status');
  } catch (err) {
    log.error('handleSlashStatus error', err);
  }
}

// ─── /generateblog ────────────────────────────────────────────────────────────

export async function handleSlashGenerateBlog(body: SlashBody, res: Response) {
  res.json({ response_type: 'ephemeral', text: '🔄 Triggering WF2 narrative threading...' });

  runWF2('slash-command').then(stats => {
    postMessage(body.channel_id, [{
      type: 'section',
      text: { type: 'mrkdwn', text: `✅ *WF2 complete* — ${stats.pitches} pitches generated, ${stats.errors} errors.` },
    }]);
  }).catch(err => {
    log.error('handleSlashGenerateBlog error', err);
  });
}

// ─── /viewarticles ────────────────────────────────────────────────────────────

export async function handleSlashViewArticles(body: SlashBody, res: Response) {
  res.json({ response_type: 'ephemeral', text: '⏳ Fetching article pool...' });

  try {
    const articles = await getPendingArticles(14);

    if (articles.length === 0) {
      await postSimple(body.channel_id, '📭 No pending articles in pool.');
      return;
    }

    // Post in batches of 10 to avoid Slack block text limits
    const batch = articles.slice(0, 20);
    const header = `*📰 Article Pool (${articles.length} pending)*`;
    await postSimple(body.channel_id, header);

    for (let i = 0; i < batch.length; i += 10) {
      const chunk = batch.slice(i, i + 10);
      const rows = chunk.map(a =>
        `• *${a.relevance_score}/10* — <${a.url}|${a.title}> _(${a.source})_`
      ).join('\n');

      await postMessage(body.channel_id, [{
        type: 'section',
        text: { type: 'mrkdwn', text: rows },
      }]);
    }
  } catch (err) {
    log.error('handleSlashViewArticles error', err);
    await postSimple(body.channel_id, `❌ Error loading articles: ${(err as Error).message}`);
  }
}

// ─── /runwf1 ─────────────────────────────────────────────────────────────────

export async function handleSlashRunWF1(body: SlashBody, res: Response) {
  res.json({ response_type: 'ephemeral', text: '🔄 Running WF1 editorial scan...' });

  runWF1('slash-command').then(stats => {
    postMessage(body.channel_id, [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *WF1 complete*\nScanned: ${stats.scanned} · Posted: ${stats.posted} · Errors: ${stats.errors}`,
      },
    }]);
  }).catch(err => {
    log.error('handleSlashRunWF1 error', err);
  });
}

// ─── /findarticles ───────────────────────────────────────────────────────────

export async function handleSlashFindArticles(body: SlashBody, res: Response) {
  res.json({ response_type: 'ephemeral', text: '🔍 Scanning RSS feeds for new articles...' });

  runWF1('findarticles').then(stats => {
    postMessage(body.channel_id, [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🔍 *Article scan complete*\nFeeds scanned: ${stats.scanned} articles · New cards posted: ${stats.posted} · Errors: ${stats.errors}`,
      },
    }]);
  }).catch(err => {
    log.error('handleSlashFindArticles error', err);
    postSimple(body.channel_id, `❌ Scan failed: ${(err as Error).message}`);
  });
}

// ─── /addsource ──────────────────────────────────────────────────────────────

export async function handleSlashAddSource(body: SlashBody, res: Response) {
  const url = body.text?.trim();

  if (!url) {
    res.json({ response_type: 'ephemeral', text: 'Usage: `/addsource https://example.com/feed`' });
    return;
  }

  res.json({ response_type: 'ephemeral', text: `⏳ Validating feed: ${url}` });

  try {
    // Validate it's a working RSS feed
    const Parser = (await import('rss-parser')).default;
    const parser = new Parser();
    const feed = await parser.parseURL(url);
    const name = feed.title || new URL(url).hostname;

    await addSource(url, name);
    await postSimple(body.channel_id, `✅ *Source added:* ${name}\n\`${url}\`\n${feed.items.length} articles in feed.`);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('duplicate key') || msg.includes('unique')) {
      await postSimple(body.channel_id, `⚠️ That feed URL is already in the sources list.`);
    } else {
      log.error('handleSlashAddSource error', err);
      await postSimple(body.channel_id, `❌ Failed to add source: ${msg.slice(0, 200)}`);
    }
  }
}

// ─── /tweakscore ─────────────────────────────────────────────────────────────

export async function handleSlashTweakScore(body: SlashBody, res: Response) {
  const parts = body.text?.trim().split(/\s+/);

  if (!parts || parts.length < 2) {
    res.json({ response_type: 'ephemeral', text: 'Usage: `/tweakscore <article_id> <new_score>`\nExample: `/tweakscore abc123 8`' });
    return;
  }

  const articleId = parts[0];
  const newScore = parseInt(parts[1], 10);

  if (isNaN(newScore) || newScore < 1 || newScore > 10) {
    res.json({ response_type: 'ephemeral', text: '❌ Score must be a number between 1 and 10.' });
    return;
  }

  res.json({ response_type: 'ephemeral', text: '⏳ Updating score...' });

  try {
    const article = await getArticle(articleId);
    const oldScore = article.relevance_score;
    await updateArticle(articleId, { relevance_score: newScore });
    await postSimple(body.channel_id, `✅ *Score updated:* ${article.title}\n${oldScore}/10 → ${newScore}/10`);
  } catch (err) {
    log.error('handleSlashTweakScore error', err);
    await postSimple(body.channel_id, `❌ Failed: ${(err as Error).message}`);
  }
}

// ─── /tweaksettings ──────────────────────────────────────────────────────────

export async function handleSlashTweakSettings(body: SlashBody, res: Response) {
  const parts = body.text?.trim().split(/\s+/);

  // No args = show current settings
  if (!parts || parts[0] === '') {
    res.json({ response_type: 'ephemeral', text: '⏳ Loading settings...' });
    try {
      const settings = await getAllSettings();
      const sources = await getActiveSources();
      const lines = settings.map(s => `\`${s.key}\` = \`${s.value}\``).join('\n');
      const sourceLines = sources.map(s => `• ${s.name} — \`${s.url}\``).join('\n');
      await postMessage(body.channel_id, [
        { type: 'section', text: { type: 'mrkdwn', text: `*⚙️ Bot Settings*\n${lines || '_No settings configured_'}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*📡 Active RSS Sources (${sources.length})*\n${sourceLines || '_No sources_'}` } },
      ], 'Settings');
    } catch (err) {
      log.error('handleSlashTweakSettings error', err);
      await postSimple(body.channel_id, `❌ Error: ${(err as Error).message}`);
    }
    return;
  }

  // Set a value: /tweaksettings MIN_SCORE 7
  if (parts.length >= 2) {
    const key = parts[0].toUpperCase();
    const value = parts[1];
    res.json({ response_type: 'ephemeral', text: `⏳ Setting ${key}...` });

    try {
      const old = await getSetting(key);
      await setSetting(key, value);
      await postSimple(body.channel_id, `✅ *Setting updated:* \`${key}\` = \`${value}\`${old ? ` (was \`${old}\`)` : ''}`);
    } catch (err) {
      log.error('handleSlashTweakSettings set error', err);
      await postSimple(body.channel_id, `❌ Error: ${(err as Error).message}`);
    }
    return;
  }

  res.json({ response_type: 'ephemeral', text: 'Usage: `/tweaksettings` (show all) or `/tweaksettings MIN_SCORE 7` (set value)' });
}

// ─── /scdebug ────────────────────────────────────────────────────────────────

export async function handleSlashDebug(body: SlashBody, res: Response) {
  const target = body.text?.trim().toLowerCase();

  if (!target) {
    res.json({
      response_type: 'ephemeral',
      text: `*Debug commands:*\n\`/scdebug env\` — check env vars\n\`/scdebug db\` — test Supabase connection\n\`/scdebug pitch <uuid>\` — inspect pitch\n\`/scdebug blog <uuid>\` — inspect blog post\n\`/scdebug articles\` — dump pending article IDs`,
    });
    return;
  }

  res.json({ response_type: 'ephemeral', text: `⏳ Running debug: \`${target}\`` });

  try {
    if (target === 'env') {
      const safeEnv = {
        SUPABASE_URL: ENV.SUPABASE_URL ? '✅ set' : '❌ missing',
        SUPABASE_KEY: ENV.SUPABASE_KEY ? '✅ set' : '❌ missing',
        SLACK_BOT_TOKEN: ENV.SLACK_BOT_TOKEN ? '✅ set' : '❌ missing',
        CLAUDE_API_KEY: ENV.CLAUDE_API_KEY ? '✅ set' : '❌ missing',
        RESEND_API_KEY: ENV.RESEND_API_KEY ? '✅ set' : '❌ missing',
        CHANNEL_NEWSLETTER: ENV.CHANNEL_NEWSLETTER,
        WP_AUTO_PUBLISH: String(ENV.WP_AUTO_PUBLISH),
      };
      await postMessage(body.channel_id, buildDebugCard('Environment', safeEnv));
    } else if (target === 'db') {
      const { data, error } = await supabase.from('articles').select('id').limit(1);
      await postMessage(body.channel_id, buildDebugCard('Supabase Connection', {
        status: error ? '❌ error' : '✅ connected',
        error: error?.message,
        sample_row: data?.[0],
      }));
    } else if (target === 'articles') {
      const { data } = await supabase.from('articles').select('id,title,queue,relevance_score')
        .eq('queue', 'pending').order('relevance_score', { ascending: false }).limit(10);
      await postMessage(body.channel_id, buildDebugCard('Pending Articles (top 10)', data || []));
    } else if (target.startsWith('pitch ')) {
      const id = target.split(' ')[1];
      const { data, error } = await supabase.from('narrative_pitches').select('*').eq('id', id).single();
      await postMessage(body.channel_id, buildDebugCard(`Pitch ${id}`, error || data));
    } else if (target.startsWith('blog ')) {
      const id = target.split(' ')[1];
      const { data, error } = await supabase.from('blog_posts').select('*').eq('id', id).single();
      const safe = data ? { ...data, body_html: data.body_html?.slice(0, 500) + '...' } : error;
      await postMessage(body.channel_id, buildDebugCard(`Blog ${id}`, safe));
    } else {
      await postMessage(body.channel_id, [{
        type: 'section',
        text: { type: 'mrkdwn', text: `❓ Unknown debug target: \`${target}\`` },
      }]);
    }
  } catch (err) {
    log.error('handleSlashDebug error', err);
    await postMessage(body.channel_id, buildDebugCard('Debug Error', { error: (err as Error).message }));
  }
}
