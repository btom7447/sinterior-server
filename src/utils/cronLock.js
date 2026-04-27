import os from 'os';
import CronLock from '../models/CronLock.js';

const HOSTNAME = `${os.hostname()}#${process.pid}`;

// Try to acquire a lease for `name`. Returns true if we own it.
//
// Uses an upsert + conditional findOneAndUpdate so only one instance can
// claim a free / expired lock at a time. The lease lasts `leaseSeconds` —
// long enough to cover the cron run, short enough that a crashed holder
// frees the lock soon.
const acquire = async (name, leaseSeconds) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseSeconds * 1000);

  // Upsert path — first ever run for this name. Creates the row.
  // Subsequent ticks find the existing row and the conditional update fires.
  try {
    const upserted = await CronLock.findOneAndUpdate(
      { name, expiresAt: { $lte: now } },
      { $set: { name, ownedBy: HOSTNAME, expiresAt } },
      { upsert: true, new: true }
    );
    if (upserted && upserted.ownedBy === HOSTNAME) return true;
    return false;
  } catch (err) {
    // E11000 means another instance just inserted the row at the same time.
    // We didn't get the lease this tick — skip.
    if (err.code === 11000) return false;
    throw err;
  }
};

// Release the lease early so the next tick (or another job sharing the name)
// can pick up immediately. Best-effort — if it fails, the TTL still cleans up.
const release = async (name) => {
  try {
    await CronLock.deleteOne({ name, ownedBy: HOSTNAME });
  } catch {
    // intentional swallow — TTL will sweep it
  }
};

// Wrap a cron handler so only the leader runs it. `leaseSeconds` should be
// generous (e.g. 5 minutes for hourly jobs, 30 minutes for daily/weekly).
export const withLock = (name, leaseSeconds, fn) => async () => {
  const got = await acquire(name, leaseSeconds);
  if (!got) {
    return null;
  }
  try {
    return await fn();
  } finally {
    await release(name);
  }
};
