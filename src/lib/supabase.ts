import { createClient } from '@supabase/supabase-js';
import { ENV } from './env';

export const supabase = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────

export type Article = {
  id: string;
  title: string;
  url: string;
  summary: string;
  source: string;
  relevance_score: number;
  broker_angle: string;
  published_at: string;
  collected_at: string;
  queue: 'pending' | 'approved' | 'rejected' | 'queued_next';
  tagged_at: string | null;
  used_in_email: boolean;
  slack_ts: string | null;
  slack_channel: string | null;
};

export type NarrativePitch = {
  id: string;
  headline: string;
  summary: string;
  article_ids: string[];
  article_rationale: Record<string, string>;
  suggested_blog_title: string;
  lens: 'INVESTMENT OPPORTUNITY' | 'PERSONAL FINANCE FOR HOMEOWNERS' | 'HOME BUILDERS & DEVELOPERS' | 'BUY OR SELL NOW?';
  status: 'pending' | 'approved' | 'rejected' | 'held';
  created_at: string;
};

export type BlogPost = {
  id: string;
  pitch_id: string;
  article_ids: string[];
  title: string;
  slug: string;
  body_html: string;
  meta_description: string;
  focus_keyword: string;
  geo_signals: Record<string, unknown>;
  status: 'draft' | 'approved' | 'exported' | 'published';
  wp_post_id: string | null;
  created_at: string;
};

export type PitchFeedback = {
  id: string;
  pitch_id: string;
  article_ids: string[];
  reason: string;
  created_at: string;
};

export type VoiceFeedback = {
  id: string;
  content_type: 'blog' | 'newsletter' | 'linkedin' | 'broker_template' | 'broker_ai';
  note: string;
  blog_post_id: string | null;
  created_at: string;
};

export type PendingSend = {
  id: string;
  blog_post_id: string;
  email_html: string;
  subject_a: string;
  subject_b: string;
  article_ids: string[];
  created_at: string;
  status: 'pending' | 'sent';
};

export type Broker = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  name: string;
  brokerage: string;
  phone: string;
  status: 'active' | 'soft_bounce' | 'hard_bounce' | 'complained' | 'unsubscribed';
  bounce_count: number;
  last_opened_at: string | null;
  last_clicked_at: string | null;
  added_at: string;
  resend_contact_id: string | null;
};

// ─── Query Helpers ─────────────────────────────────────────────────────────────

export async function getArticle(id: string) {
  const { data, error } = await supabase.from('articles').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Article;
}

export async function getPendingArticles(maxAgeDays = 14) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('queue', 'pending')
    .eq('used_in_email', false)
    .gte('collected_at', cutoff.toISOString())
    .order('relevance_score', { ascending: false });
  if (error) throw error;
  return (data || []) as Article[];
}

export async function getArticlesByIds(ids: string[]) {
  const { data, error } = await supabase.from('articles').select('*').in('id', ids);
  if (error) throw error;
  return (data || []) as Article[];
}

export async function upsertArticle(article: Partial<Article> & { url: string }) {
  const { data, error } = await supabase
    .from('articles')
    .upsert(article, { onConflict: 'url' })
    .select()
    .single();
  if (error) throw error;
  return data as Article;
}

export async function updateArticle(id: string, updates: Partial<Article>) {
  const { error } = await supabase.from('articles').update(updates).eq('id', id);
  if (error) throw error;
}

export async function savePitch(pitch: Omit<NarrativePitch, 'id' | 'created_at'>) {
  const { data, error } = await supabase.from('narrative_pitches').insert(pitch).select().single();
  if (error) throw error;
  return data as NarrativePitch;
}

export async function getPitch(id: string) {
  const { data, error } = await supabase.from('narrative_pitches').select('*').eq('id', id).single();
  if (error) throw error;
  return data as NarrativePitch;
}

export async function updatePitch(id: string, updates: Partial<NarrativePitch>) {
  const { error } = await supabase.from('narrative_pitches').update(updates).eq('id', id);
  if (error) throw error;
}

export async function getRecentPitchFeedback(limit = 20) {
  const { data, error } = await supabase
    .from('pitch_feedback')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as PitchFeedback[];
}

export async function savePitchFeedback(fb: Omit<PitchFeedback, 'id' | 'created_at'>) {
  const { error } = await supabase.from('pitch_feedback').insert(fb);
  if (error) throw error;
}

export async function getRecentVoiceFeedback(contentType: VoiceFeedback['content_type'], limit = 15) {
  const { data, error } = await supabase
    .from('voice_feedback')
    .select('*')
    .eq('content_type', contentType)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as VoiceFeedback[];
}

export async function saveVoiceFeedback(fb: Omit<VoiceFeedback, 'id' | 'created_at'>) {
  const { error } = await supabase.from('voice_feedback').insert(fb);
  if (error) throw error;
}

export async function saveBlogPost(post: Omit<BlogPost, 'id' | 'created_at'>) {
  const { data, error } = await supabase.from('blog_posts').insert(post).select().single();
  if (error) throw error;
  return data as BlogPost;
}

export async function getBlogPost(id: string) {
  const { data, error } = await supabase.from('blog_posts').select('*').eq('id', id).single();
  if (error) throw error;
  return data as BlogPost;
}

export async function updateBlogPost(id: string, updates: Partial<BlogPost>) {
  const { error } = await supabase.from('blog_posts').update(updates).eq('id', id);
  if (error) throw error;
}

export async function savePendingSend(send: Omit<PendingSend, 'id' | 'created_at'>) {
  const { data, error } = await supabase.from('pending_sends').insert(send).select().single();
  if (error) throw error;
  return data as PendingSend;
}

export async function getPendingSends() {
  const { data, error } = await supabase
    .from('pending_sends')
    .select('*, blog_posts(*)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function markSendSent(id: string) {
  const { error } = await supabase.from('pending_sends').update({ status: 'sent' }).eq('id', id);
  if (error) throw error;
}

export async function getActiveBrokers() {
  const { data, error } = await supabase.from('brokers').select('*').eq('status', 'active');
  if (error) throw error;
  return (data || []) as Broker[];
}

export async function updateBroker(id: string, updates: Partial<Broker>) {
  const { error } = await supabase.from('brokers').update(updates).eq('id', id);
  if (error) throw error;
}
