/**
 * The hire flow, at every stage, between two real accounts.
 *
 * Benjamin Tom (client) hiring Adoram Tom (artisan). Five jobs are created, one
 * parked at each state the job screen renders differently, so every branch can
 * be looked at without playing the whole flow through by hand five times:
 *
 *   1  pending         request sent, artisan has not priced it
 *   2  quote_pending   a quote is waiting on the client
 *   3  accepted        quote taken, money not yet in
 *   4  accepted + paid escrow holding, both sides can confirm
 *   5  completed       both confirmed, escrow released
 *
 * Adoram's trade record is filled in too — skill, day rate, years, working days
 * — because the artisan card and his public profile read those, and an artisan
 * with none of them set shows the empty version of every screen.
 *
 * The paid states are written directly rather than charged. Paystack is not
 * involved: this exists so screens can be looked at, and a script that took a
 * card would be a script nobody could safely run twice.
 *
 * Dev only, and it refuses anywhere else — it writes jobs, quotes and escrow
 * rows that would be indistinguishable from real ones in production.
 *
 * Usage: node src/scripts/seedHireFlow.mjs [--reset]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', override: true });
const reset = process.argv.includes('--reset');

const { default: Profile } = await import('../models/Profile.js');
const { default: ArtisanProfile } = await import('../models/ArtisanProfile.js');
const { default: Job } = await import('../models/Job.js');
const { default: Quote } = await import('../models/Quote.js');
const { default: EscrowEntry } = await import('../models/EscrowEntry.js');

await mongoose.connect(process.env.MONGO_URI);
if (mongoose.connection.name !== 'sinterior-dev') {
  throw new Error(`refusing to seed jobs into "${mongoose.connection.name}"`);
}

const find = async (name) => {
  const profile = await Profile.findOne({ fullName: name });
  if (!profile) throw new Error(`No profile named "${name}" on this database.`);
  return profile;
};

const client = await find('Benjamin Tom');
const artisan = await find('Adoram Tom');

console.log(`\n  database : ${mongoose.connection.name}`);
console.log(`  client   : ${client.fullName} (${client._id})`);
console.log(`  artisan  : ${artisan.fullName} (${artisan._id})\n`);

// ── Adoram's trade record, so the card and profile have something to show ────
const trade = await ArtisanProfile.findOneAndUpdate(
  { profileId: artisan._id },
  {
    $set: {
      skill: 'Exterior Painting',
      skillCategory: 'Painting',
      businessName: 'Adoram Finishes',
      businessTagline: 'Exterior and interior painting, Lagos and Ogun',
      pricePerDay: 35000,
      experienceYears: 9,
      isAvailable: true,
      availableDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      city: 'Ikeja',
      state: 'Lagos',
      serviceRadiusKm: 40,
    },
  },
  { new: true, upsert: true }
);
console.log(`  trade    : ${trade.skill} · ₦${trade.pricePerDay.toLocaleString()}/day · ${trade.experienceYears} yrs`);

// Everything this script has made before, so it can be run repeatedly.
const MARK = '[seed:hire-flow]';

if (reset) {
  const jobs = await Job.find({ clientId: client._id, description: new RegExp(MARK.replace(/[[\]]/g, '\\$&')) }).select('_id');
  const ids = jobs.map((j) => j._id);
  await Quote.deleteMany({ jobId: { $in: ids } });
  await EscrowEntry.deleteMany({ entityType: 'job', entityId: { $in: ids } });
  await Job.deleteMany({ _id: { $in: ids } });
  console.log(`\n  reset    : removed ${ids.length} seeded job(s)\n`);
}

/** One job, parked at the state we want to look at. */
const makeJob = async ({ title, status, paid, clientEnd, artisanEnd, total }) => {
  const job = await Job.create({
    clientId: client._id,
    artisanId: artisan._id,
    title,
    description: `${MARK} Repaint the exterior of a three-bedroom bungalow. Two coats, filler where needed.`,
    bookingType: 'scheduled',
    scheduledDate: new Date(Date.now() + 5 * 86_400_000),
    city: 'Ikeja',
    state: 'Lagos',
    location: '14 Allen Avenue, Ikeja',
    status,
    ...(total ? { totalAmount: total } : {}),
    ...(paid ? { paymentStatus: 'paid' } : {}),
    ...(clientEnd ? { clientEndApproved: true } : {}),
    ...(artisanEnd ? { artisanEndApproved: true } : {}),
    ...(status === 'completed' ? { endedAt: new Date() } : {}),
  });
  return job;
};

/** The quote Adoram would have sent. */
const makeQuote = async (job, status) => {
  const materials = [
    { description: 'Exterior emulsion, 20L', qty: 6, unitPrice: 42000, lineTotal: 252000 },
    { description: 'Filler and primer', qty: 1, unitPrice: 38000, lineTotal: 38000 },
  ];
  const labourCost = 35000 * 6;
  const materialTotal = materials.reduce((s, m) => s + m.lineTotal, 0);
  const quote = await Quote.create({
    jobId: job._id,
    artisanId: artisan._id,
    clientId: client._id,
    artisanBusiness: {
      name: trade.businessName,
      tagline: trade.businessTagline,
      logoUrl: artisan.avatarUrl || '',
    },
    labourType: 'daily',
    labourRate: 35000,
    labourQty: 6,
    labourCost,
    materials,
    materialTotal,
    total: labourCost + materialTotal,
    notes: 'Six working days. Scaffold and cleaning included; client provides water and power.',
    status,
    version: 1,
  });
  job.quoteId = quote._id;
  job.totalAmount = quote.total;
  await job.save();
  return quote;
};

const rows = [];

// 1 — waiting on the artisan to price it
rows.push(['pending', await makeJob({ title: 'Repaint bungalow exterior', status: 'pending' })]);

// 2 — a quote is sitting with the client
const j2 = await makeJob({ title: 'Repaint duplex, Ikeja GRA', status: 'quote_pending' });
await makeQuote(j2, 'sent');
rows.push(['quote_pending', j2]);

// 3 — quote taken, money not in yet
const j3 = await makeJob({ title: 'Paint two-storey shop front', status: 'accepted' });
await makeQuote(j3, 'accepted');
rows.push(['accepted, unpaid', j3]);

// 4 — escrow holding, both sides able to confirm
const j4 = await makeJob({ title: 'Repaint school block', status: 'accepted', paid: true });
const q4 = await makeQuote(j4, 'accepted');
await EscrowEntry.create({
  entityType: 'job',
  entityId: j4._id,
  buyerProfileId: client._id,
  sellerProfileId: artisan._id,
  amount: q4.total,
  status: 'held',
  heldAt: new Date(),
});
rows.push(['paid, in escrow', j4]);

// 5 — both confirmed and the money released
const j5 = await makeJob({
  title: 'Repaint church hall',
  status: 'completed',
  paid: true,
  clientEnd: true,
  artisanEnd: true,
});
const q5 = await makeQuote(j5, 'accepted');
await EscrowEntry.create({
  entityType: 'job',
  entityId: j5._id,
  buyerProfileId: client._id,
  sellerProfileId: artisan._id,
  amount: q5.total,
  status: 'released',
  heldAt: new Date(Date.now() - 3 * 86_400_000),
  releasedAt: new Date(),
});
rows.push(['completed, released', j5]);

console.log('\n  jobs created:');
for (const [state, job] of rows) {
  console.log(`    ${state.padEnd(22)} ${job._id}  ${job.title}`);
}

console.log('\n  sign in as:');
console.log('    client  tombenjamin7447@gmail.com   → You → My hires');
console.log('    artisan adoramjohntom1234@gmail.com → You → My work\n');

await mongoose.disconnect();
