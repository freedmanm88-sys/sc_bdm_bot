import { Response } from 'express';
import { SlackPayload } from '../slack/router';
import { getPitch, updatePitch, savePitchFeedback, updateArticle, getArticlesByIds, savePitch } from '../lib/supabase';
import { deleteMessage, postSimple, openModal, buildPitchRejectModal, buildPitchRefineModal, postMessage, buildPitchCard } from '../slack/blocks';
import { log } from '../lib/logger';
import { ENV } from '../lib/env';
import { runWF3a } from './wf3a-blog';
import { refinePitch } from '../lib/claude';

export async function handlePitchApprove(payload: SlackPayload, _res: Response) {
  const pitchId = payload.actions![0].value;
  const slack_ts = payload.message?.ts || '';
  const slack_channel = payload.channel?.id || ENV.CHANNEL_NEWSLETTER;
  log.info(`Pitch Approve: ${pitchId}`);

  try {
    await updatePitch(pitchId, { status: 'approved' });

    // Delete pitch card
    if (slack_ts) await deleteMessage(slack_channel, slack_ts);

    await postSimple(ENV.CHANNEL_NEWSLETTER, `✍️ Generating blog article — hang tight...`);

    // Trigger WF3a async
    runWF3a(pitchId).catch(err => {
      log.error('WF3a error after pitch approve', err);
      postSimple(ENV.CHANNEL_NEWSLETTER, `❌ Blog generation failed: ${err.message}`);
    });
  } catch (err) {
    log.error('handlePitchApprove error', err);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `❌ Error approving pitch: ${(err as Error).message}`);
  }
}

export async function handlePitchReject(payload: SlackPayload, _res: Response) {
  const pitchId = payload.actions![0].value;
  const slack_ts = payload.message?.ts || '';
  const slack_channel = payload.channel?.id || ENV.CHANNEL_NEWSLETTER;
  log.info(`Pitch Reject: ${pitchId} — opening modal`);

  try {
    const modal = buildPitchRejectModal(pitchId, slack_ts, slack_channel);
    await openModal(payload.trigger_id, modal);
  } catch (err) {
    log.error('handlePitchReject error', err);
  }
}

export async function handlePitchRejectSubmit(payload: SlackPayload, _res: Response) {
  const meta = JSON.parse(payload.view!.private_metadata);
  const reason = payload.view!.state.values.reason_block?.reason?.value || '';
  log.info(`Pitch Reject Submit: ${meta.pitch_id}, reason: ${reason}`);

  try {
    const pitch = await getPitch(meta.pitch_id);
    await updatePitch(meta.pitch_id, { status: 'rejected' });
    await savePitchFeedback({
      pitch_id: meta.pitch_id,
      article_ids: pitch.article_ids,
      reason,
    });

    if (meta.slack_ts) await deleteMessage(meta.slack_channel, meta.slack_ts);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `❌ Pitch rejected: _${reason}_`);
  } catch (err) {
    log.error('handlePitchRejectSubmit error', err);
  }
}

export async function handlePitchHold(payload: SlackPayload, _res: Response) {
  const pitchId = payload.actions![0].value;
  const slack_ts = payload.message?.ts || '';
  const slack_channel = payload.channel?.id || ENV.CHANNEL_NEWSLETTER;
  log.info(`Pitch Hold: ${pitchId}`);

  try {
    const pitch = await getPitch(pitchId);
    await updatePitch(pitchId, { status: 'held' });

    // Set articles to queued_next
    for (const articleId of pitch.article_ids) {
      await updateArticle(articleId, { queue: 'queued_next' });
    }

    if (slack_ts) await deleteMessage(slack_channel, slack_ts);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `🗂️ Pitch held — ${pitch.article_ids.length} articles queued for next run.`);
  } catch (err) {
    log.error('handlePitchHold error', err);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `❌ Hold failed: ${(err as Error).message}`);
  }
}

// ─── Pitch Refinement ────────────────────────────────────────────────────────

export async function handlePitchRefine(payload: SlackPayload, _res: Response) {
  const pitchId = payload.actions![0].value;
  const slack_ts = payload.message?.ts || '';
  const slack_channel = payload.channel?.id || ENV.CHANNEL_NEWSLETTER;
  log.info(`Pitch Refine: ${pitchId} — opening modal`);

  try {
    const modal = buildPitchRefineModal(pitchId, slack_ts, slack_channel);
    await openModal(payload.trigger_id, modal);
  } catch (err) {
    log.error('handlePitchRefine error', err);
  }
}

export async function handlePitchRefineSubmit(payload: SlackPayload, _res: Response) {
  const meta = JSON.parse(payload.view!.private_metadata);
  const direction = payload.view!.state.values.direction_block?.direction?.value || '';
  const altTitle = payload.view!.state.values.alt_title_block?.alt_title?.value || '';
  log.info(`Pitch Refine Submit: ${meta.pitch_id}, direction: ${direction}`);

  try {
    const originalPitch = await getPitch(meta.pitch_id);
    const articles = await getArticlesByIds(originalPitch.article_ids);

    await postSimple(ENV.CHANNEL_NEWSLETTER, `🔀 Regenerating pitch with new angle — hang tight...`);

    const refined = await refinePitch(originalPitch, articles, direction, altTitle || undefined);

    // Save as new pitch
    const saved = await savePitch({
      headline: refined.headline,
      summary: refined.summary,
      article_ids: originalPitch.article_ids,
      article_rationale: originalPitch.article_rationale,
      suggested_blog_title: refined.suggested_blog_title,
      lens: originalPitch.lens,
      status: 'pending',
    });

    // Mark original as rejected
    await updatePitch(meta.pitch_id, { status: 'rejected' });

    // Delete old card
    if (meta.slack_ts) await deleteMessage(meta.slack_channel, meta.slack_ts);

    // Post new pitch card
    const articleTitles = articles.map(a => a.title);
    const blocks = buildPitchCard(saved, articleTitles);
    await postMessage(ENV.CHANNEL_NEWSLETTER, blocks, refined.headline);
  } catch (err) {
    log.error('handlePitchRefineSubmit error', err);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `❌ Refinement failed: ${(err as Error).message}`);
  }
}
