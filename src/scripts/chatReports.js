/**
 * Read and resolve chat reports — the interim admin queue.
 *
 * There is no admin UI for reports yet (ops-playbook.md, "Chat reports"), so this
 * is how staff read the queue and close an entry. It exists for a second reason
 * too: an open report freezes "delete for everyone" on that conversation, which is
 * correct while somebody is actually reviewing it and a permanent dead end if
 * nothing can ever move the report out of `open`.
 *
 * Usage (dev):  node --env-file=.env.local      src/scripts/chatReports.js
 * Usage (prod): node --env-file=.env.production src/scripts/chatReports.js
 *
 *   --status=open|reviewing|actioned|dismissed   filter (default: open,reviewing)
 *   --resolve=<reportId> --as=dismissed|actioned close one
 *   --conversation=<conversationId>              filter to one thread
 *   --apply                                      actually write. Without it, this
 *                                                only says what it would do.
 *
 * Dry by default, like every other script here: a queue tool that writes on the
 * first run is a queue tool somebody clears by accident.
 */
import mongoose from 'mongoose';
import config from '../config/env.js';
import ChatReport from '../models/ChatReport.js';
import Profile from '../models/Profile.js';

function host(uri) {
  return (uri.match(/@([^/?]+)/) || uri.match(/\/\/([^/?]+)/) || [])[1] || '?';
}
function dbName(uri) {
  return (uri.match(/\/([^/?]+)\?/) || uri.match(/[^/]\/([^/?]+)$/) || [])[1] || '?';
}

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
}

const APPLY = process.argv.includes('--apply');

async function main() {
  // Printed first and always: the single most expensive mistake with a script
  // like this is running it against the wrong database.
  console.log(`\nConnecting to ${host(config.MONGO_URI)} / ${dbName(config.MONGO_URI)}`);
  await mongoose.connect(config.MONGO_URI);
  console.log(APPLY ? 'MODE: apply (will write)\n' : 'MODE: dry run (no writes)\n');

  const resolveId = arg('resolve');
  if (resolveId) return resolve(resolveId);

  const statuses = (arg('status') ?? 'open,reviewing').split(',');
  const conversationId = arg('conversation');

  const reports = await ChatReport.find({
    status: { $in: statuses },
    ...(conversationId ? { conversationId } : {}),
  })
    .sort({ createdAt: 1 })
    .populate('reporter', 'fullName')
    .populate('reported', 'fullName')
    .lean();

  if (!reports.length) {
    console.log('No reports match. Nothing is blocking an unsend on any thread.\n');
    return;
  }

  console.log(`${reports.length} report(s), oldest first:\n`);
  for (const report of reports) {
    console.log(`  id           ${report._id}`);
    console.log(`  status       ${report.status}`);
    console.log(`  reason       ${report.reason}`);
    console.log(`  reporter     ${report.reporter?.fullName ?? '?'}`);
    console.log(`  reported     ${report.reported?.fullName ?? '?'}`);
    console.log(`  conversation ${report.conversationId}`);
    console.log(`  filed        ${new Date(report.createdAt).toISOString()}`);
    if (report.note) console.log(`  note         ${report.note}`);
    console.log('');
  }

  console.log('To close one:  --resolve=<id> --as=dismissed --apply\n');
}

async function resolve(reportId) {
  const as = arg('as') ?? 'dismissed';
  if (!['actioned', 'dismissed'].includes(as)) {
    console.log(`Refusing: --as must be actioned or dismissed, not "${as}".\n`);
    return;
  }

  const report = await ChatReport.findById(reportId).lean();
  if (!report) {
    console.log(`No report with id ${reportId}.\n`);
    return;
  }

  console.log(`Report ${reportId}: ${report.status} -> ${as}`);
  console.log(`Conversation ${report.conversationId}`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write it.\n');
    return;
  }

  await ChatReport.updateOne(
    { _id: reportId },
    { $set: { status: as, resolvedAt: new Date() } }
  );
  console.log('\nDone. Unsend is no longer frozen on that conversation.\n');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

// Referenced so the Profile model is registered before populate runs.
void Profile;
