import Parser from 'rss-parser';
import { scoreArticle } from '../lib/claude';
import { upsertArticle, updateArticle } from '../lib/supabase';
import { postMessage, buildArticleCard } from '../slack/blocks';
import { ENV } from '../lib/env';
import { log } from '../lib/logger';

const parser = new Parser();

// RSS feeds to scan
const RSS_FEEDS = [
  'https://www.ratespy.com/feed',
  'https://www.mortgagebrokernews.ca/rss/news',
  'https://financialpost.com/feed',
  'https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/real-estate/',
  'https://www.crea.ca/feed/',
  'https://renx.ca/feed',
  'https://storeys.com/feed',
];

const MIN_SCORE = 5;

export async function runWF1(triggeredBy = 'cron'): Promise<{ scanned: number; posted: number; errors: number }> {
  log.info(`WF1 starting (triggered by: ${triggeredBy})`);
  const stats = { scanned: 0, posted: 0, errors: 0 };

  for (const feedUrl of RSS_FEEDS) {
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
          if (relevance_score >= MIN_SCORE && !article.slack_ts) {
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
