// Cron registration. Call once at boot from server.js.
//
// We use node-cron for in-process scheduling, BUT every handler is wrapped in
// a Mongo-backed `withLock` lease so only one instance executes per tick on
// multi-instance deploys. Lease TTL is set well above the typical run time
// and auto-expires if the holder crashes mid-run.

import cron from 'node-cron';
import { runExpireHoldPeriod } from './expireHoldPeriod.js';
import { runAutoAcceptJobs } from './autoAcceptJobs.js';
import { runProcessPayoutCooldown } from './processPayoutCooldown.js';
import { runInvoiceScheduledFees } from './invoiceScheduledFees.js';
import { withLock } from '../utils/cronLock.js';

const safeRun = (name, fn) => async () => {
  try {
    await fn();
  } catch (err) {
    console.error(`[cron ${name}] failed:`, err.message);
  }
};

export const startCronJobs = () => {
  // Hourly at :05 — promote `holding` → `available` for entries past their hold.
  // Lease 10 min — generous vs the typical run time.
  cron.schedule(
    '5 * * * *',
    safeRun('expireHoldPeriod', withLock('expireHoldPeriod', 600, runExpireHoldPeriod))
  );

  // Hourly at :15 — fire pending payouts whose cooldown elapsed.
  // Lease 15 min — Paystack transfer initiation can be slow.
  cron.schedule(
    '15 * * * *',
    safeRun('processPayoutCooldown', withLock('processPayoutCooldown', 900, runProcessPayoutCooldown))
  );

  // Daily at 02:00 — auto-accept stale completed jobs.
  // Lease 30 min — could touch many jobs on a busy week.
  cron.schedule(
    '0 2 * * *',
    safeRun('autoAcceptJobs', withLock('autoAcceptJobs', 1800, runAutoAcceptJobs))
  );

  // Weekly Monday 02:00 — invoice scheduled platform fees.
  // Lease 1 hour — can touch every wallet on the platform.
  cron.schedule(
    '0 2 * * 1',
    safeRun('invoiceScheduledFees', withLock('invoiceScheduledFees', 3600, runInvoiceScheduledFees))
  );

  console.log(
    '[cron] scheduled expireHoldPeriod (hourly :05), processPayoutCooldown (hourly :15), autoAcceptJobs (daily 02:00), invoiceScheduledFees (Mon 02:00) — Mongo-backed leases prevent multi-instance double-fires'
  );
};
