import Anthropic from '@anthropic-ai/sdk';
import { ENV } from './env';
import { Article, NarrativePitch, VoiceFeedback, PitchFeedback } from './supabase';

const client = new Anthropic({ apiKey: ENV.CLAUDE_API_KEY });
const MODEL = 'claude-sonnet-4-20250514';

// ─── Core Call ─────────────────────────────────────────────────────────────────

async function call(system: string, user: string, maxTokens = 4096): Promise<string> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const block = res.content.find(b => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('No text block in Claude response');
  return block.text;
}

// ─── WF1: Article Scoring ──────────────────────────────────────────────────────

export async function scoreArticle(title: string, summary: string, source: string): Promise<{
  relevance_score: number;
  broker_angle: string;
}> {
  const system = `You are an editorial AI for Stonefield Capital, a private mortgage lender in Ontario.
Score articles for relevance to Ontario mortgage brokers (1–10) and write a one-sentence broker angle.
Return ONLY valid JSON: {"relevance_score": <int 1-10>, "broker_angle": "<one sentence>"}`;

  const user = `Source: ${source}\nTitle: ${title}\nSummary: ${summary}`;
  const raw = await call(system, user, 256);

  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return { relevance_score: 5, broker_angle: 'Relevant to Ontario mortgage market conditions.' };
  }
}

// ─── WF2: Narrative Pitches ────────────────────────────────────────────────────

const LENSES = [
  'INVESTMENT OPPORTUNITY',
  'PERSONAL FINANCE FOR HOMEOWNERS',
  'HOME BUILDERS & DEVELOPERS',
  'BUY OR SELL NOW?',
] as const;

export async function generatePitches(
  articles: Article[],
  recentFeedback: PitchFeedback[]
): Promise<Array<{
  lens: typeof LENSES[number];
  headline: string;
  summary: string;
  article_ids: string[];
  article_rationale: Record<string, string>;
  suggested_blog_title: string;
}>> {
  const system = `You are a content strategist for Stonefield Capital, a private mortgage lender in Richmond Hill, Ontario.
Generate narrative pitches for Ontario mortgage brokers from a pool of news articles.

Return ONLY valid JSON — an array of pitch objects, one per viable lens. Each object:
{
  "lens": "<one of the 4 lenses>",
  "headline": "<compelling 8-12 word headline>",
  "summary": "<2-3 sentence narrative summary>",
  "article_ids": ["<uuid>", ...],
  "article_rationale": {"<uuid>": "<why this article supports the pitch>"},
  "suggested_blog_title": "<SEO blog title>"
}

Only generate pitches for lenses the current articles genuinely support. Skip lenses with no supporting articles.
Avoid repeating angles that have been rejected before (see feedback below).`;

  const user = `AVAILABLE ARTICLES:\n${JSON.stringify(articles.map(a => ({
    id: a.id, title: a.title, summary: a.summary, source: a.source,
    relevance_score: a.relevance_score, broker_angle: a.broker_angle,
  })), null, 2)}

LENSES TO CONSIDER:\n${LENSES.join('\n')}

RECENT REJECTION FEEDBACK (avoid these angles):\n${
    recentFeedback.length
      ? recentFeedback.map(f => `- ${f.reason}`).join('\n')
      : 'None yet'
  }`;

  const raw = await call(system, user, 2048);
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    throw new Error(`Failed to parse pitches JSON: ${raw.slice(0, 300)}`);
  }
}

// ─── WF3a: Blog Generation ─────────────────────────────────────────────────────

export async function generateBlog(
  pitch: NarrativePitch,
  articles: Article[],
  voiceFeedback: VoiceFeedback[]
): Promise<{
  title: string;
  slug: string;
  body_html: string;
  meta_description: string;
  focus_keyword: string;
  geo_signals: Record<string, string[]>;
}> {
  const voiceNotes = voiceFeedback.length
    ? voiceFeedback.map(f => `- ${f.note}`).join('\n')
    : 'No feedback yet — use default voice: direct, confident, broker-smart. Short paragraphs. No fluff.';

  const system = `You are a content strategist and writer for Stonefield Capital, a private mortgage lender in Richmond Hill, Ontario.
Write full blog posts for Ontario mortgage brokers.

Return ONLY valid JSON:
{
  "title": "<exact title from pitch — do not change>",
  "slug": "<url-friendly slug>",
  "body_html": "<full HTML article>",
  "meta_description": "<150-160 char meta description>",
  "focus_keyword": "<primary SEO keyword>",
  "geo_signals": {"cities": ["..."], "regions": ["..."], "landmarks": ["..."]}
}

HTML requirements:
- H1 for title, H2 for sections
- 800-1200 words
- Cite source articles inline with hyperlinks
- End with a CTA mentioning Stonefield Capital
- No fluff, no passive voice`;

  const user = `PITCH:
Headline: ${pitch.headline}
Lens: ${pitch.lens}
Summary: ${pitch.summary}
Title (use exactly): ${pitch.suggested_blog_title}

SOURCE ARTICLES:
${JSON.stringify(articles.map(a => ({ id: a.id, title: a.title, url: a.url, summary: a.summary })), null, 2)}

ARTICLE RATIONALE:
${JSON.stringify(pitch.article_rationale, null, 2)}

VOICE FEEDBACK:
${voiceNotes}`;

  const raw = await call(system, user, 4096);
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    throw new Error(`Failed to parse blog JSON: ${raw.slice(0, 300)}`);
  }
}

// ─── WF3b: Output Generation ───────────────────────────────────────────────────

export type BrokerKit = {
  newsletter_snippet: string;
  linkedin_post: string;
  broker_template: string;
  broker_ai_prompt: string;
  broker_ai_url: string;
};

export async function generateOutputs(
  blogTitle: string,
  blogUrl: string,
  blogBody: string,
  voiceFeedback: Record<string, VoiceFeedback[]>
): Promise<BrokerKit> {
  const system = `You are a content strategist for Stonefield Capital, Ontario private mortgage lender.
Generate all distribution outputs from a blog post.

Return ONLY valid JSON:
{
  "newsletter_snippet": "<3-4 sentences. Hook + link. Conversational, not a summary.>",
  "linkedin_post": "<Company LinkedIn post. Expert voice. Links to blog. Positions Stonefield as authority.>",
  "broker_template": "<Fill-in-the-blank LinkedIn post brokers can use. [BROKER_NAME], [BROKERAGE]. Cites Stonefield + David Steinfeld. Links to blog.>",
  "broker_ai_prompt": "<Pre-crafted prompt for brokers to paste into ChatGPT/Claude. Includes article context. Cites Stonefield.>",
  "broker_ai_url": "<URL-encoded ChatGPT deep link: https://chat.openai.com/?q=ENCODED_PROMPT>"
}`;

  const user = `BLOG TITLE: ${blogTitle}
BLOG URL: ${blogUrl}
BLOG BODY (first 1500 chars):
${blogBody.slice(0, 1500)}

VOICE NOTES — newsletter: ${(voiceFeedback.newsletter || []).map(f => f.note).join('; ') || 'Default voice'}
VOICE NOTES — linkedin: ${(voiceFeedback.linkedin || []).map(f => f.note).join('; ') || 'Default voice'}
VOICE NOTES — broker_template: ${(voiceFeedback.broker_template || []).map(f => f.note).join('; ') || 'Default voice'}`;

  const raw = await call(system, user, 2048);
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    throw new Error(`Failed to parse outputs JSON: ${raw.slice(0, 300)}`);
  }
}

// ─── Blog Regeneration (from feedback) ────────────────────────────────────────

export async function regenerateBlog(
  existingHtml: string,
  feedback: string,
  voiceFeedback: VoiceFeedback[]
): Promise<string> {
  const system = `You are editing a blog post for Stonefield Capital based on editorial feedback.
Make ONLY the changes requested. Preserve all other content, structure, and voice.
Return ONLY the updated HTML body — no JSON wrapper, no markdown.`;

  const user = `EXISTING CONTENT:\n${existingHtml}

EDITORIAL FEEDBACK:\n${feedback}

VOICE NOTES:\n${voiceFeedback.map(f => `- ${f.note}`).join('\n') || 'None'}`;

  return call(system, user, 4096);
}
