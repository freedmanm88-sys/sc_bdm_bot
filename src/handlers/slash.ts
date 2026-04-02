import { Response } from 'express';
import { SlashBody } from '../slack/router';
import { supabase, getPendingArticles } from '../lib/supabase';
import { postMessage, buildStatusCard, buildDebugCard } from '../slack/blocks';
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
      await postMessage(body.channel_id, [{
        type: 'section',
        text: { type: 'mrkdwn', text: '📭 No pending articles in pool.' },
      }]);
      return;
    }

    const rows = articles.slice(0, 20).map(a =>
      `• *${a.relevance_score}/10* — <${a.url}|${a.title}> _(${a.source})_\n  ${a.broker_angle}`
    ).join('\n\n');

    await postMessage(body.channel_id, [{
      type: 'section',
      text: { type: 'mrkdwn', text: `*📰 Article Pool (${articles.length} pending)*\n\n${rows}` },
    }]);
  } catch (err) {
    log.error('handleSlashViewArticles error', err);
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
