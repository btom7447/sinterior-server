/**
 * Deleting an account.
 *
 * Apple and Google both require an in-app path to delete an account in any app
 * that lets you create one, so this is not optional. NDPR wants the same thing
 * from the other direction.
 *
 * The shape of it is a genuine tension. "Delete everything" is what a user
 * means, but an order is a record of a transaction between two parties, and
 * erasing the buyer would corrupt the seller's books and the platform's ledger.
 * So: personal data is destroyed, commercial records survive with the person
 * scrubbed out of them.
 *
 * What is destroyed
 *   - the login itself: email, password hash, sessions, reset tokens
 *   - the profile's identifying fields: name, phone, avatar, bio, location
 *   - what the person chose to publish or collect: pins, boards, comments,
 *     likes, follows, saves, notifications
 *
 * What survives, anonymised
 *   - orders, jobs, quotes, payments, wallet and ledger entries. These are one
 *     half of somebody else's record and are legally retained.
 *   - chat messages. The other party has a right to their own conversation; the
 *     sender simply becomes an anonymised profile.
 *   - reviews they wrote. Removing them would silently move an artisan's rating.
 *
 * What blocks deletion entirely
 *   - money in flight. You cannot walk away from an order somebody is shipping
 *     or a job somebody is working. The caller is told exactly what to finish.
 */
import Board from '../models/Board.js';
import BoardFollow from '../models/BoardFollow.js';
import BoardPin from '../models/BoardPin.js';
import Bookmark from '../models/Bookmark.js';
import Follow from '../models/Follow.js';
import Job from '../models/Job.js';
import Notification from '../models/Notification.js';
import Order from '../models/Order.js';
import PayoutRequest from '../models/PayoutRequest.js';
import Pin from '../models/Pin.js';
import PinComment from '../models/PinComment.js';
import PinLike from '../models/PinLike.js';
import Profile from '../models/Profile.js';
import User from '../models/User.js';
import Wallet from '../models/Wallet.js';

/** Order and job states that mean somebody is still owed something. */
const LIVE_ORDER_STATES = ['pending', 'confirmed', 'shipped'];
const LIVE_JOB_STATES = ['pending', 'quote_pending', 'accepted', 'in_progress'];
const LIVE_PAYOUT_STATES = ['pending', 'processing'];

/**
 * Everything standing between this account and deletion, in the user's words.
 * Returns an empty array when the account is free to go.
 */
export async function deletionBlockers(profileId) {
  const [buying, selling, hiring, working, payouts, wallet] = await Promise.all([
    Order.countDocuments({ buyerId: profileId, status: { $in: LIVE_ORDER_STATES } }),
    Order.countDocuments({ 'items.supplierId': profileId, status: { $in: LIVE_ORDER_STATES } }),
    Job.countDocuments({ clientId: profileId, status: { $in: LIVE_JOB_STATES } }),
    Job.countDocuments({ artisanId: profileId, status: { $in: LIVE_JOB_STATES } }),
    PayoutRequest.countDocuments({ profileId, status: { $in: LIVE_PAYOUT_STATES } }),
    Wallet.findOne({ profileId }).select('pendingBalance holdingBalance availableBalance').lean(),
  ]);

  const blockers = [];
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  if (buying) blockers.push(`${plural(buying, 'order')} you placed still on the way`);
  if (selling) blockers.push(`${plural(selling, 'order')} you need to fulfil`);
  if (hiring) blockers.push(`${plural(hiring, 'job')} you have open with an artisan`);
  if (working) blockers.push(`${plural(working, 'job')} you are booked for`);
  if (payouts) blockers.push(`${plural(payouts, 'payout')} still being processed`);

  // Money we are holding for them, or that they owe us. Either way, deleting
  // the account would strand it.
  const held =
    (wallet?.pendingBalance ?? 0) + (wallet?.holdingBalance ?? 0) + (wallet?.availableBalance ?? 0);
  if (held > 0) {
    blockers.push(`a wallet balance of ₦${(held / 100).toLocaleString()} to withdraw first`);
  }
  if (held < 0) {
    blockers.push('an outstanding balance on your wallet to settle first');
  }

  return blockers;
}

/**
 * Carry it out.
 *
 * Deliberately not wrapped in a transaction: it spans a dozen collections, most
 * steps are independent, and a partial run leaves an account that is *more*
 * deleted rather than corrupted. Re-running finishes the job.
 */
export async function deleteAccount({ userId, profileId }) {
  const stamp = Date.now();
  const anonName = 'Deleted user';

  // 1. Things the person published or collected. These are theirs alone, and
  //    "delete my account" plainly includes them.
  const boards = await Board.find({ owner: profileId }).select('_id').lean();
  const boardIds = boards.map((b) => b._id);

  await Promise.all([
    // Pins are soft-deleted, matching how moderation removal already works, so
    // save counters on other people's boards do not go negative.
    Pin.updateMany({ author: profileId }, { $set: { status: 'removed' } }),
    PinComment.updateMany({ author: profileId }, { $set: { status: 'removed' } }),
    PinLike.deleteMany({ owner: profileId }),
    BoardPin.deleteMany({ owner: profileId }),
    boardIds.length ? BoardPin.deleteMany({ boardId: { $in: boardIds } }) : Promise.resolve(),
    Board.deleteMany({ owner: profileId }),
    BoardFollow.deleteMany({ $or: [{ follower: profileId }, { board: { $in: boardIds } }] }),
    Follow.deleteMany({ $or: [{ follower: profileId }, { followed: profileId }] }),
    Bookmark.deleteMany({ userId: profileId }),
    // Notification.userId references User, not Profile.
    Notification.deleteMany({ userId }),
  ]);

  // 2. The profile is kept, emptied. Orders, jobs and messages reference it,
  //    and dangling references would break the other party's history.
  await Profile.updateOne(
    { _id: profileId },
    {
      $set: {
        fullName: anonName,
        phone: '',
        avatarUrl: '',
        bio: '',
        city: '',
        state: '',
        isDeleted: true,
        deletedAt: new Date(),
      },
    }
  );

  // 3. The login is destroyed. The email is scrambled rather than cleared so
  //    the unique index still holds and the address can be reused for a new
  //    account, which is what someone deleting and starting over expects.
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        email: `deleted+${stamp}.${String(userId).slice(-6)}@deleted.sintherior.com`,
        passwordHash: `deleted-${stamp}`,
        isDeleted: true,
        deletedAt: new Date(),
      },
      $unset: {
        refreshTokenHash: '',
        resetPasswordToken: '',
        resetPasswordExpires: '',
        emailVerificationToken: '',
        emailVerificationExpires: '',
      },
    }
  );

  return { anonymisedAs: anonName };
}
