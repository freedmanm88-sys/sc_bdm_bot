import { Response } from 'express';
import { SlackPayload } from '../slack/router';
import {
  getPitch, getArticlesByIds, getRecentVoiceFeedback,
  saveBlogPost, getBlogPost, updateBlogPost, saveVoiceFeedback
} from '../lib/supabase';
import { generateBlog, regenerateBlog } from '../lib/claude';
import {
  postMessage, buildBlogReviewCard, postBlogThread,
  buildBlogFeedbackModal, buildBlogEditModal
} from '../slack/blocks';
import { openModal, postSimple, deleteMessage } from '../slack/blocks';
import { ENV } from '../lib/env';
import { log } from '../lib/logger';

// ─── WF3a Core (called by pitch approve handler) ───────────────────────────────

export async function runWF3a(pitchId: string) {
  log.info(`WF3a: generating blog for pitch ${pitchId}`);

  const pitch = await getPitch(pitchId);
  const articles = await getArticlesByIds(pitch.article_ids);
  const voiceFeedback = await getRecentVoiceFeedback('blog', 15);

  const blogData = await generateBlog(pitch, articles, voiceFeedback);

  const post = await saveBlogPost({
    pitch_id: pitchId,
    article_ids: pitch.article_ids,
    title: blogData.title,
    slug: blogData.slug,
    body_html: blogData.body_html,
    meta_description: blogData.meta_description,
    focus_keyword: blogData.focus_keyword,
    geo_signals: blogData.geo_signals,
    status: 'draft',
    wp_post_id: null,
  });

  const blocks = buildBlogReviewCard(post);
  const ts = await postMessage(ENV.CHANNEL_NEWSLETTER, blocks, post.title);

  // Post full article in thread
  if (ts) {
    await postBlogThread(ENV.CHANNEL_NEWSLETTER, ts, post);
  }

  log.info(`WF3a: blog posted for review — ${post.id}`);
  return post;
}

// ─── Slack Action Handlers ────────────────────────────────────────────────────

export async function handleBlogApprove(payload: SlackPayload, _res: Response) {
  const blogPostId = payload.actions![0].value;
  const slack_ts = payload.message?.ts || '';
  const slack_channel = payload.channel?.id || ENV.CHANNEL_NEWSLETTER;
  log.info(`Blog Approve: ${blogPostId}`);

  try {
    await updateBlogPost(blogPostId, { status: 'approved' });
    if (slack_ts) await deleteMessage(slack_channel, slack_ts);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `📦 Blog approved — generating output kit...`);

    const { runWF3b } = await import('./wf3b-outputs');
    runWF3b(blogPostId).catch(err => {
      log.error('WF3b error after blog approve', err);
      postSimple(ENV.CHANNEL_NEWSLETTER, `❌ Output generation failed: ${err.message}`);
    });
  } catch (err) {
    log.error('handleBlogApprove error', err);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `❌ Blog approve failed: ${(err as Error).message}`);
  }
}

export async function handleBlogFeedback(payload: SlackPayload, _res: Response) {
  const blogPostId = payload.actions![0].value;
  log.info(`Blog Feedback modal: ${blogPostId}`);
  try {
    const modal = buildBlogFeedbackModal(blogPostId);
    await openModal(payload.trigger_id, modal);
  } catch (err) {
    log.error('handleBlogFeedback error', err);
  }
}

export async function handleBlogFeedbackSubmit(payload: SlackPayload, _res: Response) {
  const meta = JSON.parse(payload.view!.private_metadata);
  const feedback = payload.view!.state.values.feedback_block?.feedback?.value || '';
  const saveVoice = payload.view!.state.values.save_voice_block?.save_voice?.selected_options?.[0]?.value === 'yes';
  log.info(`Blog Feedback Submit: ${meta.blog_post_id}`);

  try {
    const post = await getBlogPost(meta.blog_post_id);
    const voiceFeedback = await getRecentVoiceFeedback('blog', 15);

    await postSimple(ENV.CHANNEL_NEWSLETTER, `🔄 Regenerating blog with feedback — hang tight...`);

    const updatedHtml = await regenerateBlog(post.body_html, feedback, voiceFeedback);
    await updateBlogPost(meta.blog_post_id, { body_html: updatedHtml });

    if (saveVoice) {
      await saveVoiceFeedback({ content_type: 'blog', note: feedback, blog_post_id: meta.blog_post_id });
    }

    const updatedPost = await getBlogPost(meta.blog_post_id);
    const blocks = buildBlogReviewCard(updatedPost);
    const ts = await postMessage(ENV.CHANNEL_NEWSLETTER, blocks, updatedPost.title);
    if (ts) await postBlogThread(ENV.CHANNEL_NEWSLETTER, ts, updatedPost);
  } catch (err) {
    log.error('handleBlogFeedbackSubmit error', err);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `❌ Regeneration failed: ${(err as Error).message}`);
  }
}

export async function handleBlogEdit(payload: SlackPayload, _res: Response) {
  const blogPostId = payload.actions![0].value;
  log.info(`Blog Edit modal: ${blogPostId}`);
  try {
    const post = await getBlogPost(blogPostId);
    const modal = buildBlogEditModal(blogPostId, post.body_html);
    await openModal(payload.trigger_id, modal);
  } catch (err) {
    log.error('handleBlogEdit error', err);
  }
}

export async function handleBlogEditSubmit(payload: SlackPayload, _res: Response) {
  const meta = JSON.parse(payload.view!.private_metadata);
  const content = payload.view!.state.values.content_block?.content?.value || '';
  log.info(`Blog Edit Submit: ${meta.blog_post_id}`);

  try {
    // Wrap plain text in basic HTML if needed
    const body_html = content.startsWith('<') ? content : `<p>${content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
    await updateBlogPost(meta.blog_post_id, { body_html });

    const updatedPost = await getBlogPost(meta.blog_post_id);
    const blocks = buildBlogReviewCard(updatedPost);
    const ts = await postMessage(ENV.CHANNEL_NEWSLETTER, blocks, updatedPost.title);
    if (ts) await postBlogThread(ENV.CHANNEL_NEWSLETTER, ts, updatedPost);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `✏️ Blog updated and ready for review.`);
  } catch (err) {
    log.error('handleBlogEditSubmit error', err);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `❌ Edit save failed: ${(err as Error).message}`);
  }
}
