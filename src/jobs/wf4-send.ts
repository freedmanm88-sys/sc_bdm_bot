import { getPendingSends, markSendSent, getActiveBrokers } from '../lib/supabase';
import { postSimple } from '../slack/blocks';
import { ENV } from '../lib/env';
import { log } from '../lib/logger';

const RESEND_API = 'https://api.resend.com';

export async function runWF4(triggeredBy = 'cron'): Promise<{ sent: number; errors: number }> {
  log.info(`WF4 starting (triggered by: ${triggeredBy})`);
  const stats = { sent: 0, errors: 0 };

  const pendingSends = await getPendingSends();
  if (pendingSends.length === 0) {
    log.info('WF4: no pending sends');
    await postSimple(ENV.CHANNEL_NEWSLETTER, '📭 WF4: No newsletters queued for today.');
    return stats;
  }

  const brokers = await getActiveBrokers();
  log.info(`WF4: ${pendingSends.length} queued sends, ${brokers.length} active brokers`);

  for (const send of pendingSends) {
    try {
      // A/B split 50/50
      const halfIdx = Math.floor(brokers.length / 2);
      const groupA = brokers.slice(0, halfIdx);
      const groupB = brokers.slice(halfIdx);

      const batchA = groupA.map(b => ({
        from: 'Stonefield Capital <info@stonefieldcapital.ca>',
        to: [b.email],
        subject: send.subject_a,
        html: send.email_html,
        tags: [{ name: 'sent_email_id', value: send.id }, { name: 'ab_variant', value: 'a' }],
      }));

      const batchB = groupB.map(b => ({
        from: 'Stonefield Capital <info@stonefieldcapital.ca>',
        to: [b.email],
        subject: send.subject_b,
        html: send.email_html,
        tags: [{ name: 'sent_email_id', value: send.id }, { name: 'ab_variant', value: 'b' }],
      }));

      // Send batches via Resend
      for (const batch of [batchA, batchB]) {
        if (batch.length === 0) continue;
        const res = await fetch(`${RESEND_API}/emails/batch`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ENV.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(batch),
        });
        const data = await res.json() as { data?: unknown[]; error?: { message: string } };
        if (data.error) throw new Error(data.error.message);
        stats.sent += batch.length;
      }

      // Mark as sent
      await markSendSent(send.id);

      // Post confirmation to Slack
      const blog = (send as any).blog_posts;
      await postSimple(
        ENV.CHANNEL_NEWSLETTER,
        `✅ *Newsletter sent!*\n*Blog:* ${blog?.title || send.blog_post_id}\n*Recipients:* ${brokers.length} brokers\n*A subject:* ${send.subject_a}\n*B subject:* ${send.subject_b}`
      );
    } catch (err) {
      log.error('WF4: error sending newsletter', err);
      stats.errors++;
      await postSimple(ENV.CHANNEL_NEWSLETTER, `❌ WF4 send failed: ${(err as Error).message}`);
    }
  }

  log.info('WF4 complete', stats);
  return stats;
}
