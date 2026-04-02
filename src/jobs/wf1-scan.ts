import Parser from 'rss-parser';
import { scoreArticle } from '../lib/claude';
import { upsertArticle, updateArticle, getActiveSources, getSetting } from '../lib/supabase';
import { postMessage, buildArticleCard } from '../slack/blocks';
import { ENV } from '../lib/env';
import { log } from '../lib/logger';

const parser = new Parser();

// Fallback feeds if sources table is empty
const DEFAULT_FEEDS = [
  'https://www.ratespy.com/feed',
  'https://www.mortgagebrokernews.ca/rss/news',
  'https://financialpost.com/feed',
  'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/real-estate/',
  'https://www.crea.ca/feed/',
  'https://renx.ca/feed',
  'https://storeys.com/feed',
];

export async function runWF1(triggeredBy = 'cron'): Promise<{ scanned: number; posted: number; errors: number }> {
  log.info(`WF1 starting (triggered by: ${triggeredBy})`);
  const stats = { scanned: 0, posted: 0, errors: 0 };

  // Pull feeds from Supabase, fall back to defaults
  let feedUrls: string[];
  try {
    const sources = await getActiveSources();
    feedUrls = sources.length > 0 ? sources.map(s => s.url) : DEFAULT_FEEDS;
    log.info(`WF1: using ${feedUrls.length} feeds (${sources.length > 0 ? 'from DB' : 'defaults'})`);
  } catch {
    feedUrls = DEFAULT_FEEDS;
    log.warn('WF1: failed to load sources, using defaults');
  }

  // Pull configurable MIN_SCORE
  const minScore = Number(await getSetting('MIN_SCORE')) || 5;

  for (const feedUrl of feedUrls) {
    try {
      const feed = await parser.parseURL(feedUrl);
      log.info(`WF1: fetched ${feed.items.length} items from ${feedUrl}`);

      for (const item of feed.items.slice(0, 10)) {
        if (!item.title || !item.link) continue;
        stats.scanned++;

        const summary = (item.contentSnippet || item.summary || '').slice(0, 600).replace(/<[^>]+>/g, '');
        const source = feed.title || new URL(feedUrl).hostname;

        try {
          // Score with Claude
          const { relevance_score, broker_angle } = await scoreArticle(item.title, summary, source);

          // Upsert to Supabase (skip if already exists)
          const article = await upsertArticle({
            title: item.title,
            url: item.link,
            summary,
            source,
            relevance_score,
            broker_angle,
            published_at: item.isoDate || new Date().toISOString(),
            queue: 'pending',
            used_in_email: false,
          });

          // Only post if score meets threshold AND not already tagged
          if (relevance_score >= minScore && !article.slack_ts) {
            const blocks = buildArticleCard(article);
            const ts = await postMessage(ENV.CHANNEL_NEWSLETTER, blocks, item.title);

            if (ts) {
              await updateArticle(article.id, {
                slack_ts: ts,
                slack_channel: ENV.CHANNEL_NEWSLETTER,
              });
              stats.posted++;
            }
          }
        } catch (err) {
          log.error(`WF1: error processing article "${item.title}"`, err);
          stats.errors++;
        }

        // Delay between articles to avoid Slack rate limits
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      log.error(`WF1: error fetching feed ${feedUrl}`, err);
      stats.errors++;
    }
  }

  log.info('WF1 complete', stats);
  return stats;
}
