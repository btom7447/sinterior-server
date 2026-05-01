import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Quote from '../models/Quote.js';
import Job from '../models/Job.js';
import Profile from '../models/Profile.js';
import ArtisanProfile from '../models/ArtisanProfile.js';
import Notification from '../models/Notification.js';
import { emitNotification } from '../utils/emitNotification.js';

const notifyParty = async ({ req, recipientUserId, title, body, type, data }) => {
  try {
    const n = await Notification.create({ userId: recipientUserId, title, body, type, data });
    emitNotification(req, n);
  } catch (err) {
    console.warn('[quote notify] failed:', err.message);
  }
};

const computeTotals = (labourType, labourRate, labourQty, materials) => {
  const rate = Number(labourRate) || 0;
  const qty  = labourType === 'flat' ? 1 : (Number(labourQty) || 1);
  const labourCost = Number((rate * qty).toFixed(2));

  const rows = (materials || []).map((m) => ({
    ...m,
    lineTotal: Number((m.qty * m.unitPrice).toFixed(2)),
  }));
  const materialTotal = rows.reduce((sum, r) => sum + r.lineTotal, 0);
  const total = Number((labourCost + materialTotal).toFixed(2));
  return { labourCost, rows, materialTotal, total };
};

// POST /api/v1/quotes — artisan sends a new quote for any job in pending/accepted status
export const sendQuote = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { jobId, labourType, labourRate, labourQty, materials, notes } = req.body;

  if (!['flat', 'hourly', 'daily', 'sqm', 'unit'].includes(labourType)) {
    throw new AppError('labourType must be flat, hourly, daily, sqm, or unit.', 400);
  }

  const job = await Job.findById(jobId)
    .populate('clientId', 'userId fullName')
    .populate('artisanId', 'userId fullName');
  if (!job) throw new AppError('Job not found.', 404);
  if (job.artisanId._id.toString() !== profile._id.toString()) {
    throw new AppError('Not authorised to quote on this job.', 403);
  }
  if (!['pending', 'accepted', 'quote_pending'].includes(job.status)) {
    throw new AppError(`Cannot quote a job in status "${job.status}".`, 400);
  }

  const { labourCost, rows, materialTotal, total } = computeTotals(labourType, labourRate, labourQty, materials);

  // Snapshot artisan's business identity at send time.
  const artisanDoc = await ArtisanProfile.findOne({ profileId: profile._id })
    .select('businessName businessTagline')
    .lean();

  // Mark any existing sent quote as superseded.
  const prevVersion = await Quote.findOne({ jobId, status: 'sent' }).sort({ version: -1 });
  if (prevVersion) {
    prevVersion.status = 'superseded';
    await prevVersion.save();
  }
  const version = prevVersion ? prevVersion.version + 1 : 1;

  const quote = await Quote.create({
    jobId,
    artisanId: profile._id,
    clientId: job.clientId._id,
    artisanBusiness: {
      name:    artisanDoc?.businessName    || profile.fullName,
      tagline: artisanDoc?.businessTagline || '',
      logoUrl: profile.avatarUrl           || '',
    },
    labourType,
    labourRate: Number(labourRate) || 0,
    labourQty:  labourType === 'flat' ? 1 : (Number(labourQty) || 1),
    labourCost,
    materials: rows,
    materialTotal,
    total,
    notes: notes?.trim() || '',
    status: 'sent',
    version,
  });

  job.quoteId = quote._id;
  job.status = 'quote_pending';
  await job.save();

  await notifyParty({
    req,
    recipientUserId: job.clientId.userId,
    title: 'Quote received',
    body: `${job.artisanId.fullName} sent a quote for "${job.title}". Review it in your jobs.`,
    type: 'job',
    data: { jobId: job._id, quoteId: quote._id },
  });

  res.status(201).json({ success: true, data: { quote }, message: 'Quote sent.' });
});

// PATCH /api/v1/quotes/:id — artisan edits a sent quote (supersedes old, creates new version)
export const editQuote = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const quote = await Quote.findById(req.params.id);
  if (!quote) throw new AppError('Quote not found.', 404);
  if (quote.artisanId.toString() !== profile._id.toString()) {
    throw new AppError('Not authorised.', 403);
  }
  if (quote.status !== 'sent') {
    throw new AppError('Only a sent quote can be edited.', 400);
  }

  const { labourType, labourRate, labourQty, materials, notes } = req.body;

  const newLabourType = labourType || quote.labourType;
  const newLabourRate = labourRate !== undefined ? Number(labourRate) : quote.labourRate;
  const newLabourQty  = labourQty  !== undefined ? Number(labourQty)  : quote.labourQty;
  const newMaterials  = materials  !== undefined ? materials          : quote.materials;

  const { labourCost, rows, materialTotal, total } = computeTotals(
    newLabourType, newLabourRate, newLabourQty, newMaterials
  );

  // Supersede current, create next version.
  quote.status = 'superseded';
  await quote.save();

  const job = await Job.findById(quote.jobId)
    .populate('clientId', 'userId fullName')
    .populate('artisanId', 'userId');

  const newQuote = await Quote.create({
    jobId:           quote.jobId,
    artisanId:       quote.artisanId,
    clientId:        quote.clientId,
    artisanBusiness: quote.artisanBusiness,
    labourType:      newLabourType,
    labourRate:      newLabourRate,
    labourQty:       newLabourType === 'flat' ? 1 : newLabourQty,
    labourCost,
    materials:       rows,
    materialTotal,
    total,
    notes: notes !== undefined ? notes?.trim() : quote.notes,
    status:  'sent',
    version: quote.version + 1,
  });

  if (job) {
    job.quoteId = newQuote._id;
    job.status = 'quote_pending';
    await job.save();

    await notifyParty({
      req,
      recipientUserId: job.clientId.userId,
      title: 'Quote updated',
      body: `The artisan updated their quote for "${job.title}". Review the new version.`,
      type: 'job',
      data: { jobId: job._id, quoteId: newQuote._id },
    });
  }

  res.json({ success: true, data: { quote: newQuote }, message: 'Quote updated.' });
});

// POST /api/v1/quotes/:id/accept — client accepts quote, locks totalAmount
export const acceptQuote = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const quote = await Quote.findById(req.params.id);
  if (!quote) throw new AppError('Quote not found.', 404);
  if (quote.clientId.toString() !== profile._id.toString()) {
    throw new AppError('Not authorised.', 403);
  }
  if (quote.status !== 'sent') {
    throw new AppError('Only a pending quote can be accepted.', 400);
  }

  quote.status = 'accepted';
  quote.respondedAt = new Date();
  quote.respondedBy = 'client';
  await quote.save();

  const job = await Job.findById(quote.jobId)
    .populate('artisanId', 'userId fullName')
    .populate('clientId', 'userId fullName');
  if (job) {
    job.totalAmount = quote.total;
    job.status = 'accepted';
    await job.save();

    await notifyParty({
      req,
      recipientUserId: job.artisanId.userId,
      title: 'Quote accepted',
      body: `${job.clientId.fullName} accepted your quote for "${job.title}" (₦${quote.total.toLocaleString('en-NG')}). You can now start the job.`,
      type: 'job',
      data: { jobId: job._id, quoteId: quote._id },
    });
  }

  res.json({ success: true, data: { quote, totalAmount: quote.total }, message: 'Quote accepted.' });
});

// POST /api/v1/quotes/:id/reject — client rejects quote; job stays open for new quote
export const rejectQuote = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const quote = await Quote.findById(req.params.id);
  if (!quote) throw new AppError('Quote not found.', 404);
  if (quote.clientId.toString() !== profile._id.toString()) {
    throw new AppError('Not authorised.', 403);
  }
  if (quote.status !== 'sent') {
    throw new AppError('Only a pending quote can be rejected.', 400);
  }

  quote.status = 'rejected';
  quote.respondedAt = new Date();
  quote.respondedBy = 'client';
  await quote.save();

  const job = await Job.findById(quote.jobId)
    .populate('artisanId', 'userId fullName')
    .populate('clientId', 'userId fullName');
  if (job) {
    // Keep job accepted so artisan can send a revised quote.
    job.status = 'accepted';
    job.quoteId = undefined;
    await job.save();

    await notifyParty({
      req,
      recipientUserId: job.artisanId.userId,
      title: 'Quote rejected',
      body: `${job.clientId.fullName} rejected your quote for "${job.title}". You can send a revised quote.`,
      type: 'job',
      data: { jobId: job._id, quoteId: quote._id },
    });
  }

  res.json({ success: true, data: { quote }, message: 'Quote rejected.' });
});

// GET /api/v1/quotes/job/:jobId — all quotes for a job (both parties)
export const getQuotesForJob = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const job = await Job.findById(req.params.jobId).select('artisanId clientId');
  if (!job) throw new AppError('Job not found.', 404);

  const isParty =
    job.artisanId.toString() === profile._id.toString() ||
    job.clientId.toString() === profile._id.toString();
  if (!isParty) throw new AppError('Not authorised.', 403);

  const quotes = await Quote.find({ jobId: req.params.jobId })
    .sort({ version: -1 })
    .lean();

  res.json({ success: true, data: { quotes } });
});
