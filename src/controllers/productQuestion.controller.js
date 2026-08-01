import Product from '../models/Product.js';
import ProductQuestion from '../models/ProductQuestion.js';
import Profile from '../models/Profile.js';
import Notification from '../models/Notification.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { emitNotification } from '../utils/emitNotification.js';
import { refId } from '../utils/refId.js';

// ── GET /api/v1/products/:id/questions ───────────────────────────────────────
export const listQuestions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const [questions, total] = await Promise.all([
    ProductQuestion.find({ productId: req.params.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('askedBy', 'fullName avatarUrl')
      .populate('answers.answeredBy', 'fullName avatarUrl')
      .lean(),
    ProductQuestion.countDocuments({ productId: req.params.id }),
  ]);

  // Answered first. An unanswered question is a worse advertisement than none,
  // and the useful ones should not be buried under it.
  questions.sort((a, b) => (b.answers?.length ? 1 : 0) - (a.answers?.length ? 1 : 0));

  sendPaginated(res, questions, buildPaginationMeta(total, page, limit), 'Questions retrieved.');
});

// ── POST /api/v1/products/:id/questions ──────────────────────────────────────
export const askQuestion = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id fullName');
  if (!profile) throw new AppError('Profile not found.', 404);

  const product = await Product.findById(req.params.id).select('_id name supplierId isActive');
  if (!product || !product.isActive) throw new AppError('Product not found.', 404);

  const question = await ProductQuestion.create({
    productId: product._id,
    askedBy: profile._id,
    body: req.body.body,
  });

  // The supplier is the only person who can answer, so they are the only person
  // told. A question nobody hears about is the reason Q&A sections die.
  const seller = await Profile.findById(refId(product.supplierId)).select('userId');
  if (seller?.userId) {
    const notification = await Notification.create({
      userId: seller.userId,
      title: 'A question about your listing',
      body: `${profile.fullName} asked about "${product.name}": ${question.body.slice(0, 120)}`,
      type: 'product',
      data: { productId: product._id, questionId: question._id },
    });
    emitNotification(req, notification);
  }

  sendSuccess(res, { question }, 'Question posted.', 201);
});

// ── POST /api/v1/products/:id/questions/:questionId/answers ──────────────────
export const answerQuestion = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id fullName');
  if (!profile) throw new AppError('Profile not found.', 404);

  const product = await Product.findById(req.params.id).select('_id name supplierId');
  if (!product) throw new AppError('Product not found.', 404);

  const question = await ProductQuestion.findOne({
    _id: req.params.questionId,
    productId: product._id,
  });
  if (!question) throw new AppError('Question not found.', 404);

  /*
   * Anyone may answer, not only the seller.
   *
   * A buyer who already owns the thing often gives the better answer, and
   * shutting them out is how a Q&A section becomes a second product
   * description. The seller's replies are badged instead, so the reader can
   * weigh who is speaking rather than being shown only one voice.
   */
  const fromSeller = refId(product.supplierId) === refId(profile._id);

  question.answers.push({
    body: req.body.body,
    answeredBy: profile._id,
    fromSeller,
  });
  await question.save();

  // Tell whoever asked — unless they answered their own question.
  if (refId(question.askedBy) !== refId(profile._id)) {
    const asker = await Profile.findById(question.askedBy).select('userId');
    if (asker?.userId) {
      const notification = await Notification.create({
        userId: asker.userId,
        title: fromSeller ? 'The supplier answered you' : 'Someone answered your question',
        body: `About "${product.name}": ${req.body.body.slice(0, 120)}`,
        type: 'product',
        data: { productId: product._id, questionId: question._id },
      });
      emitNotification(req, notification);
    }
  }

  sendSuccess(res, { question }, 'Answer posted.', 201);
});

// ── DELETE /api/v1/products/:id/questions/:questionId ─────────────────────────
export const deleteQuestion = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);

  const question = await ProductQuestion.findById(req.params.questionId);
  if (!question) throw new AppError('Question not found.', 404);

  const mine = refId(question.askedBy) === refId(profile._id);
  if (!mine && req.user.role !== 'admin') {
    throw new AppError('You can only remove your own question.', 403);
  }

  await question.deleteOne();
  sendSuccess(res, null, 'Question removed.');
});
