import express from 'express';
import { json, urlencoded } from 'express';
import { slackRouter } from './slack/router';
import { webhookRouter } from './slack/webhook';
import { startCronJobs } from './jobs/cron';
import { log } from './lib/logger';

const app = express();
const PORT = process.env.PORT || 3000;

// Raw body needed for Slack signature verification
app.use('/slack/events', urlencoded({ extended: true }));
app.use('/slack/actions', urlencoded({ extended: true }));
app.use('/slack/commands', urlencoded({ extended: true }));
app.use(json());

app.use('/slack', slackRouter);
app.use('/webhook', webhookRouter);

app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Temporary debug: test a single Slack post and return the raw result
app.get('/debug/slack-post', async (_, res) => {
  try {
    const { postMessage } = await import('./slack/blocks');
    const { ENV } = await import('./lib/env');
    const ts = await postMessage(ENV.CHANNEL_NEWSLETTER, [
      { type: 'section', text: { type: 'mrkdwn', text: '*Debug test* — if you see this, postMessage works from Railway.' } },
    ], 'debug test');
    res.json({ success: true, ts, node_version: process.version });
  } catch (err) {
    res.json({ success: false, error: (err as Error).message, stack: (err as Error).stack, node_version: process.version });
  }
});

app.listen(PORT, () => {
  log.info(`🚀 Stonefield BDM service running on port ${PORT}`);
  startCronJobs();
});
