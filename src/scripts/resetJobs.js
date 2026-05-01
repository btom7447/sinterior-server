/**
 * One-time cleanup: wipe job/quote/escrow/payout/wallet-ledger data.
 * Safe to run when no real users are in prod.
 *
 * Usage:
 *   node --env-file=.env.local src/scripts/resetJobs.js
 */
import mongoose from 'mongoose';
import config from '../config/env.js';
import Job from '../models/Job.js';
import Quote from '../models/Quote.js';
import EscrowEntry from '../models/EscrowEntry.js';
import PayoutRequest from '../models/PayoutRequest.js';
import WalletTransaction from '../models/WalletTransaction.js';
import Wallet from '../models/Wallet.js';

await mongoose.connect(config.MONGO_URI);
console.log('Connected to MongoDB.');

const [jobs, quotes, escrow, payouts, txns] = await Promise.all([
  Job.deleteMany({}),
  Quote.deleteMany({}),
  EscrowEntry.deleteMany({}),
  PayoutRequest.deleteMany({}),
  WalletTransaction.deleteMany({}),
]);

await Wallet.updateMany(
  {},
  {
    $set: {
      pendingBalance: 0,
      holdingBalance: 0,
      availableBalance: 0,
      feesOwed: 0,
      totalEarned: 0,
      totalPaidOut: 0,
      totalFeesPaid: 0,
      totalRefunded: 0,
      withdrawalsPaused: false,
      pauseReason: undefined,
    },
  }
);

console.log(`Deleted: ${jobs.deletedCount} jobs, ${quotes.deletedCount} quotes, ${escrow.deletedCount} escrow entries, ${payouts.deletedCount} payout requests, ${txns.deletedCount} wallet transactions.`);
console.log('Wallet balances reset to zero.');

await mongoose.disconnect();
console.log('Done.');
