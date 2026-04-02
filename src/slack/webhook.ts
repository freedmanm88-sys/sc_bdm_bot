import { Router, Request, Response } from 'express';
import { log } from '../lib/logger';
import { supabase, updateBroker } from '../lib/supabase';

export const webhookRouter = Router();

type ResendEvent = {
  type: 'email.opened' | 'email.clicked' | 'email.bounced' | 'email.complained' | 'email.unsubscribed';
  data: {
    email_id: string;
    to: string[];
    tags?: Record<string, string>;
    bounce?: { type: 'hard' | 'soft' };
  };
};

webhookRouter.post('/resend', async (req: Request, res: Response) => {
  res.status(200).send('ok');

  const event = req.body as ResendEvent;
  log.info(`Resend webhook: ${event.type}`, { to: event.data.to });

  const email = event.data.to?.[0];
  if (!email) return;

  try {
    // Find broker by email
    const { data: brokers } = await supabase.from('brokers').select('id').eq('email', email).limit(1);
    const broker = brokers?.[0];
    if (!broker) return;

    switch (event.type) {
      case 'email.opened':
        await updateBroker(broker.id, { last_opened_at: new Date().toISOString() });
        break;
      case 'email.clicked':
        await updateBroker(broker.id, { last_clicked_at: new Date().toISOString() });
        break;
      case 'email.bounced':
        const bounceType = event.data.bounce?.type;
        if (bounceType === 'hard') {
          await updateBroker(broker.id, { status: 'hard_bounce' });
        } else {
          // Soft bounce — increment counter
          const { data: b } = await supabase.from('brokers').select('bounce_count').eq('id', broker.id).single();
          const newCount = (b?.bounce_count || 0) + 1;
          await updateBroker(broker.id, {
            bounce_count: newCount,
            status: newCount >= 3 ? 'soft_bounce' : undefined,
          });
        }
        break;
      case 'email.complained':
        await updateBroker(broker.id, { status: 'complained' });
        break;
      case 'email.unsubscribed':
        await updateBroker(broker.id, { status: 'unsubscribed' });
        break;
    }

    // Log to sent_emails if email_id tag present
    if (event.data.tags?.sent_email_id) {
      await supabase.from('email_events').insert({
        sent_email_id: event.data.tags.sent_email_id,
        broker_email: email,
        event_type: event.type,
        created_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    log.error('Resend webhook handler error', err);
  }
});
