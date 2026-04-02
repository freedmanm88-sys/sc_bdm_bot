import { Response } from 'express';
import { SlackPayload } from '../slack/router';
import { updateArticle, getArticle } from '../lib/supabase';
import { deleteMessage, postSimple } from '../slack/blocks';
import { log } from '../lib/logger';
import { ENV } from '../lib/env';

export async function handleTagPool(payload: SlackPayload, _res: Response) {
  const articleId = payload.actions![0].value;
  log.info(`Tag Pool: article ${articleId}`);

  try {
    const article = await getArticle(articleId);
    await updateArticle(articleId, { queue: 'pending', tagged_at: new Date().toISOString() });

    if (article.slack_ts && article.slack_channel) {
      await deleteMessage(article.slack_channel, article.slack_ts);
    }

    await postSimple(ENV.CHANNEL_NEWSLETTER, `✅ *Added to pool:* ${article.title}`);
  } catch (err) {
    log.error('handleTagPool error', err);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `❌ Error tagging article: ${(err as Error).message}`);
  }
}

export async function handleTagSkip(payload: SlackPayload, _res: Response) {
  const articleId = payload.actions![0].value;
  log.info(`Tag Skip: article ${articleId}`);

  try {
    const article = await getArticle(articleId);
    await updateArticle(articleId, { queue: 'rejected', tagged_at: new Date().toISOString() });

    if (article.slack_ts && article.slack_channel) {
      await deleteMessage(article.slack_channel, article.slack_ts);
    }
  } catch (err) {
    log.error('handleTagSkip error', err);
  }
}
