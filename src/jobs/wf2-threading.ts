import { getPendingArticles, getArticlesByIds, getRecentPitchFeedback, savePitch } from '../lib/supabase';
import { generatePitches } from '../lib/claude';
import { postMessage, buildPitchCard } from '../slack/blocks';
import { ENV } from '../lib/env';
import { log } from '../lib/logger';

export async function runWF2(triggeredBy = 'cron'): Promise<{ pitches: number; errors: number }> {
  log.info(`WF2 starting (triggered by: ${triggeredBy})`);
  const stats = { pitches: 0, errors: 0 };

  try {
    // Pull pending articles (≤14 days old)
    const articles = await getPendingArticles(14);
    log.info(`WF2: ${articles.length} pending articles`);

    if (articles.length === 0) {
      log.warn('WF2: no pending articles — nothing to thread');
      return stats;
    }

    // Pull recent rejection feedback to avoid repeating bad angles
    const recentFeedback = await getRecentPitchFeedback(20);

    // Generate pitches via Claude
    const pitches = await generatePitches(articles, recentFeedback);
    log.info(`WF2: Claude generated ${pitches.length} pitches`);

    for (const pitch of pitches) {
      try {
        // Save to Supabase
        const saved = await savePitch({
          headline: pitch.headline,
          summary: pitch.summary,
          article_ids: pitch.article_ids,
          article_rationale: pitch.article_rationale,
          suggested_blog_title: pitch.suggested_blog_title,
          lens: pitch.lens,
          status: 'pending',
        });

        // Get article titles for the card
        const pitchArticles = await getArticlesByIds(pitch.article_ids);
        const articleTitles = pitchArticles.map(a => a.title);

        // Post pitch card to Slack
        const blocks = buildPitchCard(saved, articleTitles);
        await postMessage(ENV.CHANNEL_NEWSLETTER, blocks, pitch.headline);

        stats.pitches++;
        await new Promise(r => setTimeout(r, 500)); // stagger posts
      } catch (err) {
        log.error('WF2: error saving/posting pitch', err);
        stats.errors++;
      }
    }
  } catch (err) {
    log.error('WF2: fatal error', err);
    stats.errors++;
  }

  log.info('WF2 complete', stats);
  return stats;
}
