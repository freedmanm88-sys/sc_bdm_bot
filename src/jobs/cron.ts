import cron from 'node-cron';
import { log } from '../lib/logger';
import { runWF1 } from './wf1-scan';
import { runWF2 } from './wf2-threading';
import { runWF4 } from './wf4-send';

export function startCronJobs() {
  // WF1 — Mon–Fri 8am ET (UTC-5 = 13:00 UTC in EST, 12:00 UTC in EDT)
  // Use 13:00 UTC to cover EST, adjust if on EDT
  cron.schedule('0 13 * * 1-5', async () => {
    log.info('⏰ CRON: WF1 triggered');
    try {
      await runWF1('cron');
    } catch (err) {
      log.error('CRON WF1 fatal error', err);
    }
  });

  // WF2 — Mon & Wed 9am ET (14:00 UTC)
  cron.schedule('0 14 * * 1,3', async () => {
    log.info('⏰ CRON: WF2 triggered');
    try {
      await runWF2('cron');
    } catch (err) {
      log.error('CRON WF2 fatal error', err);
    }
  });

  // WF4 — Tue & Thu 10am ET (15:00 UTC)
  cron.schedule('0 15 * * 2,4', async () => {
    log.info('⏰ CRON: WF4 triggered');
    try {
      await runWF4('cron');
    } catch (err) {
      log.error('CRON WF4 fatal error', err);
    }
  });

  log.info('✅ Cron jobs scheduled: WF1 (Mon–Fri 8am ET), WF2 (Mon/Wed 9am ET), WF4 (Tue/Thu 10am ET)');
}
