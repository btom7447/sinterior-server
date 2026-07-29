/**
 * Telling makers that something happened to their work.
 *
 * Until now an artisan could be saved, liked and commented on and learn none of
 * it. On a marketplace that is not a missing nicety, it is the entire reason a
 * maker opens the app a second time.
 *
 * Two rules run through all of it:
 *
 *  - never notify someone about their own action. Liking your own pin should
 *    not ping you, and the self-check has to be here rather than at each call
 *    site, because it will be forgotten at one of them.
 *
 *  - never let a notification failure break the thing it is reporting. A save
 *    that succeeded must not 500 because the notify step did. Everything here
 *    swallows its own errors and warns.
 *
 * Notification.userId references User while everything in the feed speaks
 * Profile, so each call resolves one to the other.
 */
import Notification from '../models/Notification.js';
import Profile from '../models/Profile.js';
import { emitNotification } from '../utils/emitNotification.js';

/** Keeps notification copy from repeating a name that is missing. */
const nameOf = (profile) => profile?.fullName?.trim() || 'Someone';

/** Long titles are truncated by the row anyway; do it where it can be read. */
const short = (text, max = 40) =>
  !text ? 'your work' : text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/**
 * @param req          Express request, for the socket handle
 * @param actorId      Profile that did the thing
 * @param recipientId  Profile it happened to
 */
async function notify(req, { actorId, recipientId, type, title, body, data }) {
  try {
    if (!recipientId || !actorId) return;
    // Your own activity is not news.
    if (String(actorId) === String(recipientId)) return;

    const recipient = await Profile.findById(recipientId).select('userId').lean();
    if (!recipient?.userId) return;

    const saved = await Notification.create({
      userId: recipient.userId,
      title,
      body,
      type,
      data: data ?? {},
    });
    emitNotification(req, saved);
  } catch (err) {
    // The action itself already succeeded; this is the postscript.
    console.warn(`[feed notify:${type}] failed:`, err.message);
  }
}

export async function notifyPinSaved(req, { actor, pin, boardName }) {
  await notify(req, {
    actorId: actor?._id,
    recipientId: pin.author,
    type: 'pin_save',
    title: 'Your work was saved',
    body: `${nameOf(actor)} saved "${short(pin.title)}"${boardName ? ` to ${boardName}` : ''}.`,
    data: { pinId: String(pin._id) },
  });
}

export async function notifyPinLiked(req, { actor, pin }) {
  await notify(req, {
    actorId: actor?._id,
    recipientId: pin.author,
    type: 'pin_like',
    title: 'Your work was liked',
    body: `${nameOf(actor)} liked "${short(pin.title)}".`,
    data: { pinId: String(pin._id) },
  });
}

export async function notifyPinCommented(req, { actor, pin, comment }) {
  await notify(req, {
    actorId: actor?._id,
    recipientId: pin.author,
    type: 'pin_comment',
    title: 'New comment on your work',
    // The comment itself, not "someone commented" — the point is to make it
    // answerable from the notification.
    body: `${nameOf(actor)}: ${short(comment, 90)}`,
    data: { pinId: String(pin._id) },
  });
}

export async function notifyFollowed(req, { actor, followedProfileId }) {
  await notify(req, {
    actorId: actor?._id,
    recipientId: followedProfileId,
    type: 'profile_follow',
    title: 'You have a new follower',
    body: `${nameOf(actor)} is now following your work.`,
    data: { profileId: String(actor?._id ?? '') },
  });
}

export async function notifyBoardFollowed(req, { actor, board }) {
  await notify(req, {
    actorId: actor?._id,
    recipientId: board.owner,
    type: 'board_follow',
    title: 'Someone followed your board',
    body: `${nameOf(actor)} is following "${short(board.name)}".`,
    data: { boardId: String(board._id) },
  });
}

export async function notifyBoardLiked(req, { actor, board }) {
  await notify(req, {
    actorId: actor?._id,
    recipientId: board.owner,
    type: 'board_like',
    title: 'Your board was liked',
    body: `${nameOf(actor)} liked "${short(board.name)}".`,
    data: { boardId: String(board._id) },
  });
}
