/**
 * Pushing a chat message to a closed app.
 *
 * Chat had no push at all. Notifications — a job, a payout, a comment — went out
 * through emitNotification, but a message only ever emitted over the socket, so a
 * message to somebody whose app was shut reached them the next time they happened to
 * open it. On a marketplace that is the same as not delivering it: a client asking
 * "are you free Thursday" at 8pm gets an answer on Friday, by which point they have
 * asked somebody else.
 *
 * It also means muting had nothing to suppress, since nothing was being sent.
 *
 * Deliberately not a Notification document. A message is already stored, already has an
 * unread count, and already appears in the inbox — writing a second record of it would
 * put every message in the Updates tab as well, which is not a feed anybody wants.
 */
import ConversationState from '../models/ConversationState.js';
import Profile from '../models/Profile.js';
import { describeAttachments } from '../config/attachments.js';
import { pushToUser } from './push.service.js';
import { isProfileOnline } from '../socket.js';

/**
 * What the notification says.
 *
 * The sender's name and the message, because a push that says "New message" makes
 * somebody open the app to find out whether it mattered. Attachments are named by kind,
 * the same words the conversation list uses.
 */
function preview(message) {
  const text = message.content?.trim();
  if (text) return text.length > 140 ? `${text.slice(0, 137)}...` : text;

  const described = describeAttachments(message.attachments ?? []);
  return described || 'Sent you a message';
}

/**
 * Send it, unless there is a reason not to.
 *
 * Three reasons, in order of cheapness to check:
 *
 *  - they are looking at the app right now, so the socket has already delivered it and
 *    a buzz would be the app interrupting itself
 *  - they have muted this conversation
 *  - we cannot find the account behind the profile, which should not happen and is not
 *    worth throwing over
 *
 * Never throws into the request. A message that saved and failed to buzz is a message.
 */
export async function pushMessage({ message, senderName, receiverProfileId }) {
  try {
    if (isProfileOnline(receiverProfileId)) return { sent: 0, skipped: 'online' };

    const muted = await ConversationState.findOne({
      profileId: receiverProfileId,
      conversationId: message.conversationId,
      mutedUntil: { $gt: new Date() },
    })
      .select('_id')
      .lean();
    if (muted) return { sent: 0, skipped: 'muted' };

    // Push is addressed to an account; presence and chat are keyed by profile.
    const receiver = await Profile.findById(receiverProfileId).select('userId').lean();
    if (!receiver?.userId) return { sent: 0, skipped: 'no account' };

    return pushToUser({
      _id: message._id,
      userId: receiver.userId,
      title: senderName || 'New message',
      body: preview(message),
      type: 'message',
      // Enough for the app to open the right thread on a tap.
      data: { conversationId: message.conversationId },
    });
  } catch (err) {
    console.warn('[messagePush] failed:', err.message);
    return { sent: 0, error: err.message };
  }
}
