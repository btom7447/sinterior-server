// Hourly cron — promotes wallet credits past their hold period from
// `holding` to `available`. Idempotent: each promoted entry writes a paired
// `hold_expire` ledger row that the service uses to dedupe.

import { promoteExpiredHolds } from '../services/wallet.service.js';

export const runExpireHoldPeriod = async () => {
  const promoted = await promoteExpiredHolds();
  if (promoted > 0) {
    console.log(`[cron expireHoldPeriod] promoted ${promoted} entries to available`);
  }
  return promoted;
};
