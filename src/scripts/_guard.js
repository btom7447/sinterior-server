/**
 * Say which database a script is about to write to, and make the user agree.
 *
 * Production and development live on the same Atlas cluster and differ only by
 * the database name in the URI. That is one character of difference between
 * "rehearsed safely" and "rewrote live data", and a script that connects
 * silently looks identical in both cases. This makes the target impossible to
 * miss and requires --yes before a write run touches production.
 *
 * Usage, at the top of every script that writes:
 *
 *   const target = await connectGuarded();
 *   if (target.isProduction) ...
 */
import mongoose from 'mongoose';
import config from '../config/env.js';

/** The database name out of a Mongo URI, without printing the credentials. */
const dbNameFrom = (uri) => {
  const withoutQuery = String(uri).split('?')[0];
  const name = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
  return name || '(default)';
};

const PRODUCTION_HINTS = [/prod/i];

export async function connectGuarded({ dryRun = false } = {}) {
  const uri = config.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set. Point --env-file at a real env file.');

  // A placeholder is worse than a missing value: it looks configured and fails
  // halfway through, or worse, connects somewhere unintended.
  if (/<user>|<password>|<username>|changeme/i.test(uri)) {
    throw new Error(
      'MONGO_URI still contains placeholder credentials. Fill in the real value before running this.'
    );
  }

  const database = dbNameFrom(uri);
  const isProduction = PRODUCTION_HINTS.some((re) => re.test(database));

  const banner = isProduction ? 'PRODUCTION' : 'development';
  console.log(`\n  target database : ${database}  [${banner}]`);
  console.log(`  mode            : ${dryRun ? 'dry run, nothing will be written' : 'WRITING'}\n`);

  if (isProduction && !dryRun && !process.argv.includes('--yes')) {
    throw new Error(
      `Refusing to write to ${database} without --yes. Run with --dry-run first, then add --yes.`
    );
  }

  await mongoose.connect(uri);
  return { database, isProduction };
}
