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

app.listen(PORT, () => {
  log.info(`🚀 Stonefield BDM service running on port ${PORT}`);
  startCronJobs();
});
