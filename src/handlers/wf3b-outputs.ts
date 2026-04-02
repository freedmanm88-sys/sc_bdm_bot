import { Response } from 'express';
import { SlackPayload } from '../slack/router';
import {
  getBlogPost, updateBlogPost, getRecentVoiceFeedback,
  savePendingSend, supabase
} from '../lib/supabase';
import { generateOutputs } from '../lib/claude';
import { postMessage, buildOutputCard, buildSnippetEditModal, openModal, postSimple, deleteMessage } from '../slack/blocks';
import { ENV } from '../lib/env';
import { log } from '../lib/logger';

// Blog URL base — update when site is live
const BLOG_BASE = 'https://stonefieldcapital.ca/blog';

// ─── WF3b Core ────────────────────────────────────────────────────────────────

export async function runWF3b(blogPostId: string) {
  log.info(`WF3b: generating outputs for blog ${blogPostId}`);

  const post = await getBlogPost(blogPostId);
  const blogUrl = `${BLOG_BASE}/${post.slug}`;

  // Pull voice feedback for all output types in parallel
  const [newsletterFb, linkedinFb, brokerTemplateFb, brokerAiFb] = await Promise.all([
    getRecentVoiceFeedback('newsletter', 10),
    getRecentVoiceFeedback('linkedin', 10),
    getRecentVoiceFeedback('broker_template', 10),
    getRecentVoiceFeedback('broker_ai', 10),
  ]);

  const kit = await generateOutputs(post.title, blogUrl, post.body_html, {
    newsletter: newsletterFb,
    linkedin: linkedinFb,
    broker_template: brokerTemplateFb,
    broker_ai: brokerAiFb,
  });

  // Save kit to Supabase
  await supabase.from('broker_kits').upsert({
    blog_post_id: blogPostId,
    newsletter_snippet: kit.newsletter_snippet,
    linkedin_post: kit.linkedin_post,
    broker_template: kit.broker_template,
    broker_ai_prompt: kit.broker_ai_prompt,
    broker_ai_url: kit.broker_ai_url,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'blog_post_id' });

  // Post output review card
  const blocks = buildOutputCard(post, kit);
  await postMessage(ENV.CHANNEL_NEWSLETTER, blocks, `Output kit: ${post.title}`);

  log.info(`WF3b: output kit posted for ${blogPostId}`);
  return kit;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getKit(blogPostId: string) {
  const { data, error } = await supabase.from('broker_kits').select('*').eq('blog_post_id', blogPostId).single();
  if (error) throw error;
  return data;
}

function nextSendDate(): string {
  // Returns the next Tue or Thu
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 2=Tue, 4=Thu
  let daysAhead = 0;
  if (day < 2) daysAhead = 2 - day;
  else if (day < 4) daysAhead = 4 - day;
  else daysAhead = 9 - day; // next Tue
  const sendDate = new Date(now);
  sendDate.setDate(now.getDate() + daysAhead);
  return sendDate.toDateString();
}

// ─── Slack Handlers ───────────────────────────────────────────────────────────

export async function handleOutputApprove(payload: SlackPayload, _res: Response) {
  const blogPostId = payload.actions![0].value;
  const slack_ts = payload.message?.ts || '';
  const slack_channel = payload.channel?.id || ENV.CHANNEL_NEWSLETTER;
  log.info(`Output Approve: ${blogPostId}`);

  try {
    const post = await getBlogPost(blogPostId);
    const kit = await getKit(blogPostId);

    // Build newsletter HTML
    const blogUrl = `${BLOG_BASE}/${post.slug}`;
    const emailHtml = `
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;color:#333;">
  <h2 style="color:#1a1a1a;">${post.title}</h2>
  <p>${kit.newsletter_snippet}</p>
  <p><a href="${blogUrl}" style="color:#c8a96e;">Read the full article →</a></p>
  <hr style="border:none;border-top:1px solid #eee;margin:32px 0;">
  <p style="font-size:12px;color:#999;">
    Stonefield Capital · Richmond Hill, ON · 
    <a href="{{unsubscribe_url}}" style="color:#999;">Unsubscribe</a>
  </p>
</div>`;

    await savePendingSend({
      blog_post_id: blogPostId,
      email_html: emailHtml,
      subject_a: `${post.title}`,
      subject_b: `Have you read this? ${post.title}`,
      article_ids: post.article_ids,
      status: 'pending',
    });

    await updateBlogPost(blogPostId, { status: 'approved' });
    if (slack_ts) await deleteMessage(slack_channel, slack_ts);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `✅ *Output kit approved!* Newsletter scheduled for ${nextSendDate()}.`);
  } catch (err) {
    log.error('handleOutputApprove error', err);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `❌ Approve failed: ${(err as Error).message}`);
  }
}

export async function handleEditSnippet(payload: SlackPayload, _res: Response) {
  const blogPostId = payload.actions![0].value;
  log.info(`Edit Snippet modal: ${blogPostId}`);
  try {
    const kit = await getKit(blogPostId);
    const modal = buildSnippetEditModal(blogPostId, kit.newsletter_snippet);
    await openModal(payload.trigger_id, modal);
  } catch (err) {
    log.error('handleEditSnippet error', err);
  }
}

export async function handleEditSnippetSubmit(payload: SlackPayload, _res: Response) {
  const meta = JSON.parse(payload.view!.private_metadata);
  const snippet = payload.view!.state.values.snippet_block?.snippet?.value || '';
  log.info(`Edit Snippet Submit: ${meta.blog_post_id}`);

  try {
    await supabase.from('broker_kits').update({ newsletter_snippet: snippet }).eq('blog_post_id', meta.blog_post_id);
    await postSimple(ENV.CHANNEL_NEWSLETTER, `✏️ Newsletter snippet updated.`);
  } catch (err) {
    log.error('handleEditSnippetSubmit error', err);
  }
}

export async function handleEditLinkedin(payload: SlackPayload, _res: Response) {
  const blogPostId = payload.actions![0].value;
  log.info(`Edit LinkedIn modal: ${blogPostId}`);
  try {
    const kit = await getKit(blogPostId);
    const modal = {
      type: 'modal',
      callback_id: 'scbdm_edit_linkedin_submit',
      private_metadata: JSON.stringify({ blog_post_id: blogPostId }),
      title: { type: 'plain_text', text: 'Edit LinkedIn Post' },
      submit: { type: 'plain_text', text: 'Save' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [{
        type: 'input',
        block_id: 'linkedin_block',
        element: { type: 'plain_text_input', action_id: 'linkedin', multiline: true, initial_value: kit.linkedin_post },
        label: { type: 'plain_text', text: 'LinkedIn Post' },
      }],
    };
    await openModal(payload.trigger_id, modal);
  } catch (err) {
    log.error('handleEditLinkedin error', err);
  }
}

export async function handleEditBrokerKit(payload: SlackPayload, _res: Response) {
  const blogPostId = payload.actions![0].value;
  log.info(`Edit Broker Kit modal: ${blogPostId}`);
  try {
    const kit = await getKit(blogPostId);
    const modal = {
      type: 'modal',
      callback_id: 'scbdm_edit_brokerkit_submit',
      private_metadata: JSON.stringify({ blog_post_id: blogPostId }),
      title: { type: 'plain_text', text: 'Edit Broker Template' },
      submit: { type: 'plain_text', text: 'Save' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [{
        type: 'input',
        block_id: 'template_block',
        element: { type: 'plain_text_input', action_id: 'template', multiline: true, initial_value: kit.broker_template },
        label: { type: 'plain_text', text: 'Broker Template' },
      }],
    };
    await openModal(payload.trigger_id, modal);
  } catch (err) {
    log.error('handleEditBrokerKit error', err);
  }
}
