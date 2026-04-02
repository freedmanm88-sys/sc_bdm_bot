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
    const { ENV } = await import('./lib/env');
    const raw = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ENV.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: ENV.CHANNEL_NEWSLETTER,
        text: 'Debug test from Railway',
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '*Debug test* from Railway' } }],
      }),
    });
    const data = await raw.json();
    res.json({ node_version: process.version, slack_response: data, env_check: { bot_token_len: ENV.SLACK_BOT_TOKEN.length, channel: ENV.CHANNEL_NEWSLETTER } });
  } catch (err) {
    res.json({ success: false, error: (err as Error).message, stack: (err as Error).stack, node_version: process.version });
  }
});

app.listen(PORT, () => {
  log.info(`🚀 Stonefield BDM service running on port ${PORT}`);
  startCronJobs();
});
