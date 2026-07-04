/**
 * List all users — READ ONLY. Makes no writes.
 *
 * Usage (dev):  node --env-file=.env.local      src/scripts/listUsers.js
 * Usage (prod): node --env-file=.env.production  src/scripts/listUsers.js
 *
 * Prints which DB it connected to, a table of users, summary counts by role,
 * and flags likely cleanup candidates (unverified + never logged in, or banned).
 */
import mongoose from 'mongoose';
import config from '../config/env.js';
import User from '../models/User.js';

function host(uri) {
  return (uri.match(/@([^/?]+)/) || uri.match(/\/\/([^/?]+)/) || [])[1] || '?';
}
function dbName(uri) {
  return (uri.match(/\/([^/?]+)\?/) || uri.match(/[^/]\/([^/?]+)$/) || [])[1] || '?';
}

async function run() {
  await mongoose.connect(config.MONGO_URI);
  console.log(
    `[listUsers] Connected to ${host(config.MONGO_URI)} / db "${dbName(config.MONGO_URI)}" (NODE_ENV=${config.NODE_ENV || 'unset'})\n`
  );

  // passwordHash & token fields are select:false, so they are NOT pulled here.
  const users = await User.find({})
    .select('email role isEmailVerified isBanned lastLogin createdAt')
    .sort({ createdAt: 1 })
    .lean();

  const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
  console.table(
    users.map((u) => ({
      email: u.email,
      role: u.role,
      verified: u.isEmailVerified ? 'yes' : 'NO',
      banned: u.isBanned ? 'YES' : '',
      lastLogin: fmt(u.lastLogin),
      created: fmt(u.createdAt),
    }))
  );

  const byRole = users.reduce((acc, u) => ((acc[u.role] = (acc[u.role] || 0) + 1), acc), {});
  const candidates = users.filter((u) => u.isBanned || (!u.isEmailVerified && !u.lastLogin));

  console.log(`\nTotal: ${users.length}`);
  console.log('By role:', byRole);
  console.log(`\nLikely cleanup candidates (banned, or unverified & never logged in): ${candidates.length}`);
  candidates.forEach((u) => console.log(`  - ${u.email} (${u.role}) created ${fmt(u.createdAt)}`));

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[listUsers] Error:', err);
  process.exit(1);
});
