import { ENV } from '../lib/env';
import { log } from '../lib/logger';
import { Article, NarrativePitch, BlogPost } from '../lib/supabase';
import { BrokerKit } from '../lib/claude';

const BASE = 'https://slack.com/api';

async function slackPost(endpoint: string, body: object, retries = 2): Promise<{ ok: boolean; ts?: string; error?: string }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE}/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ENV.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      // Handle rate limiting
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') || '3');
        log.warn(`Slack rate limited on ${endpoint}, retrying in ${retryAfter}s (attempt ${attempt + 1})`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }

      const data = await res.json() as { ok: boolean; ts?: string; error?: string };
      if (!data.ok) log.error(`Slack ${endpoint} failed`, data);
      return data;
    } catch (err) {
      log.error(`Slack ${endpoint} fetch error (attempt ${attempt + 1})`, { error: (err as Error).message });
      if (attempt === retries) return { ok: false, error: (err as Error).message };
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return { ok: false, error: 'max retries exceeded' };
}

// ─── Core ─────────────────────────────────────────────────────────────────────

export async function postMessage(channel: string, blocks: object[], text = ''): Promise<string | null> {
  const data = await slackPost('chat.postMessage', { channel, blocks, text, unfurl_links: false });
  if (!data.ts) log.warn('postMessage returned no ts', { channel, text: text.slice(0, 80), error: data.error });
  return data.ts || null;
}

export async function postThread(channel: string, thread_ts: string, blocks: object[], text = '') {
  return slackPost('chat.postMessage', { channel, thread_ts, blocks, text, unfurl_links: false });
}

export async function deleteMessage(channel: string, ts: string) {
  return slackPost('chat.delete', { channel, ts });
}

export async function openModal(trigger_id: string, view: object) {
  return slackPost('views.open', { trigger_id, view });
}

export async function postSimple(channel: string, text: string) {
  return slackPost('chat.postMessage', { channel, text, unfurl_links: false });
}

// ─── WF1: Article Card ────────────────────────────────────────────────────────

export function buildArticleCard(article: Article): object[] {
  const score_bar = '█'.repeat(Math.round(article.relevance_score / 2)) + '░'.repeat(5 - Math.round(article.relevance_score / 2));
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${article.url}|${article.title}>*\n_${article.source}_\n\n${article.broker_angle}`,
      },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `Score: \`${score_bar}\` ${article.relevance_score}/10` },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Add to Pool' },
          style: 'primary',
          action_id: 'scbdm_tag_pool',
          value: article.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '⏭️ Skip' },
          action_id: 'scbdm_tag_skip',
          value: article.id,
        },
      ],
    },
    { type: 'divider' },
  ];
}

// ─── WF2: Pitch Card ──────────────────────────────────────────────────────────

const LENS_EMOJI: Record<string, string> = {
  'INVESTMENT OPPORTUNITY': '💰',
  'PERSONAL FINANCE FOR HOMEOWNERS': '🏡',
  'HOME BUILDERS & DEVELOPERS': '🏗️',
  'BUY OR SELL NOW?': '📈',
};

export function buildPitchCard(pitch: NarrativePitch, articleTitles: string[]): object[] {
  const emoji = LENS_EMOJI[pitch.lens] || '📰';
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} ${pitch.lens}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${pitch.headline}*\n\n${pitch.summary}` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Suggested title:* ${pitch.suggested_blog_title}\n\n*Supporting articles:*\n${articleTitles.map(t => `• ${t}`).join('\n')}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✍️ Generate Full Article' },
          style: 'primary',
          action_id: 'scbdm_pitch_approve',
          value: pitch.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🗂️ Use This Later' },
          action_id: 'scbdm_pitch_hold',
          value: pitch.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Not For Us' },
          style: 'danger',
          action_id: 'scbdm_pitch_reject',
          value: pitch.id,
        },
      ],
    },
    { type: 'divider' },
  ];
}

// ─── WF3a: Blog Review Card ───────────────────────────────────────────────────

export function buildBlogReviewCard(post: BlogPost): object[] {
  const preview = post.body_html.replace(/<[^>]+>/g, '').slice(0, 300) + '...';
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📝 Blog Draft Ready for Review' },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${post.title}*\n\n_${preview}_` },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `Keyword: \`${post.focus_keyword}\` · ${post.meta_description.length} char meta` },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Looks Good' },
          style: 'primary',
          action_id: 'scbdm_blog_approve',
          value: post.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '💬 Give Feedback' },
          action_id: 'scbdm_blog_feedback',
          value: post.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '✏️ Edit Directly' },
          action_id: 'scbdm_blog_edit',
          value: post.id,
        },
      ],
    },
    { type: 'divider' },
  ];
}

// ─── WF3b: Output Review Card ─────────────────────────────────────────────────

export function buildOutputCard(post: BlogPost, kit: BrokerKit): object[] {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📦 Output Kit Ready' },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${post.title}*` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*📧 Newsletter Snippet*\n${kit.newsletter_snippet}` },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*💼 LinkedIn Post*\n${kit.linkedin_post.slice(0, 280)}...` },
      ],
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*🤝 Broker Template*\n${kit.broker_template.slice(0, 280)}...` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*🤖 Broker AI Prompt* · <${kit.broker_ai_url}|Open in ChatGPT>` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Approve All & Schedule' },
          style: 'primary',
          action_id: 'scbdm_output_approve',
          value: post.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '✏️ Edit Newsletter Snippet' },
          action_id: 'scbdm_edit_snippet',
          value: post.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '✏️ Edit LinkedIn' },
          action_id: 'scbdm_edit_linkedin',
          value: post.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '✏️ Edit Broker Kit' },
          action_id: 'scbdm_edit_brokerkit',
          value: post.id,
        },
      ],
    },
    { type: 'divider' },
  ];
}

// ─── Modals ───────────────────────────────────────────────────────────────────

export function buildPitchRejectModal(pitch_id: string, slack_ts: string, slack_channel: string): object {
  return {
    type: 'modal',
    callback_id: 'scbdm_pitch_reject_submit',
    private_metadata: JSON.stringify({ pitch_id, slack_ts, slack_channel }),
    title: { type: 'plain_text', text: 'Why not this pitch?' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'reason_block',
        element: {
          type: 'plain_text_input',
          action_id: 'reason',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'e.g. Too similar to last week, wrong audience angle...' },
        },
        label: { type: 'plain_text', text: 'Reason' },
      },
    ],
  };
}

export function buildBlogFeedbackModal(blog_post_id: string): object {
  return {
    type: 'modal',
    callback_id: 'scbdm_blog_feedback_submit',
    private_metadata: JSON.stringify({ blog_post_id }),
    title: { type: 'plain_text', text: 'Blog Feedback' },
    submit: { type: 'plain_text', text: 'Regenerate' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'feedback_block',
        element: {
          type: 'plain_text_input',
          action_id: 'feedback',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'What needs to change? Be specific.' },
        },
        label: { type: 'plain_text', text: 'Feedback for Claude' },
      },
      {
        type: 'input',
        block_id: 'save_voice_block',
        optional: true,
        element: {
          type: 'checkboxes',
          action_id: 'save_voice',
          options: [{ text: { type: 'plain_text', text: 'Save as voice guidance for future posts' }, value: 'yes' }],
        },
        label: { type: 'plain_text', text: 'Voice Library' },
      },
    ],
  };
}

export function buildBlogEditModal(blog_post_id: string, currentHtml: string): object {
  return {
    type: 'modal',
    callback_id: 'scbdm_blog_edit_submit',
    private_metadata: JSON.stringify({ blog_post_id }),
    title: { type: 'plain_text', text: 'Edit Blog Post' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'content_block',
        element: {
          type: 'plain_text_input',
          action_id: 'content',
          multiline: true,
          initial_value: currentHtml.replace(/<[^>]+>/g, '').slice(0, 3000),
        },
        label: { type: 'plain_text', text: 'Blog Content (plain text)' },
      },
    ],
  };
}

export function buildSnippetEditModal(blog_post_id: string, currentSnippet: string): object {
  return {
    type: 'modal',
    callback_id: 'scbdm_edit_snippet_submit',
    private_metadata: JSON.stringify({ blog_post_id }),
    title: { type: 'plain_text', text: 'Edit Newsletter Snippet' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'snippet_block',
        element: {
          type: 'plain_text_input',
          action_id: 'snippet',
          multiline: true,
          initial_value: currentSnippet,
        },
        label: { type: 'plain_text', text: 'Newsletter Snippet' },
      },
    ],
  };
}

// ─── Debug & Status Cards ─────────────────────────────────────────────────────

export function buildDebugCard(title: string, data: object): object[] {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*🔧 DEBUG: ${title}*\n\`\`\`${JSON.stringify(data, null, 2).slice(0, 2800)}\`\`\`` },
    },
  ];
}

export function buildErrorCard(context: string, error: Error): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*❌ Error in ${context}*\n\`\`\`${error.message}\n${error.stack?.slice(0, 800) || ''}\`\`\``,
      },
    },
  ];
}

export function buildStatusCard(rows: Array<{ label: string; value: string }>): object[] {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*📊 System Status*' },
    },
    {
      type: 'section',
      fields: rows.map(r => ({ type: 'mrkdwn', text: `*${r.label}*\n${r.value}` })),
    },
  ];
}
