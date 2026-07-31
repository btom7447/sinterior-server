/**
 * Notifications for a closed app.
 *
 * Expo's push service rather than talking to APNs and FCM directly. It is one
 * HTTP endpoint for both platforms, it is what the client SDK already issues
 * tokens for, and the alternative is two sets of credentials and two payload
 * formats for a marketplace that has not shipped yet.
 *
 * Nothing here throws into a request. A notification that failed to push is a
 * notification the person will still see in the app, and losing an order because
 * a push receipt came back oddly would be a far worse outcome than a missed
 * buzz.
 */
import PushToken from '../models/PushToken.js';

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Expo's own documented ceiling for one request. */
const BATCH_SIZE = 100;

/** Anything slower than this and the caller is waiting on somebody else's phone. */
const TIMEOUT_MS = 10_000;

/**
 * Send one notification to every device belonging to a user.
 *
 * @param {object} notification  a saved Notification document
 * @param {object} [options]
 * @param {boolean} [options.skip] true when the person is looking at the app
 *   right now, in which case the socket has already delivered it and a push
 *   would buzz a phone that is in their hand.
 */
export async function pushToUser(notification, { skip = false } = {}) {
  if (skip) return { sent: 0, skipped: true };

  try {
    const tokens = await PushToken.find({ userId: notification.userId })
      .select('token')
      .lean();
    if (!tokens.length) return { sent: 0 };

    const messages = tokens.map(({ token }) => ({
      to: token,
      title: notification.title,
      body: notification.body,
      sound: 'default',
      // Everything the app needs to route the tap without another request.
      data: {
        notificationId: String(notification._id),
        type: notification.type ?? null,
        ...(notification.data ?? {}),
      },
      // Android needs the channel named or the notification arrives silent and
      // without the app's own importance settings.
      channelId: 'default',
    }));

    let sent = 0;
    for (let at = 0; at < messages.length; at += BATCH_SIZE) {
      const batch = messages.slice(at, at + BATCH_SIZE);
      const tickets = await postBatch(batch);
      sent += await reconcile(batch, tickets);
    }
    return { sent };
  } catch (err) {
    console.warn('[push] send failed:', err.message);
    return { sent: 0, error: err.message };
  }
}

async function postBatch(batch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(EXPO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(batch),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`push service returned ${res.status}`);
    const json = await res.json();
    return Array.isArray(json?.data) ? json.data : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the tickets back and drop tokens the service says are dead.
 *
 * This is the part that keeps the table from filling with uninstalled apps.
 * DeviceNotRegistered is Expo saying "this phone is gone" — keeping it means
 * paying for a failed request on every future notification to that account.
 */
async function reconcile(batch, tickets) {
  let sent = 0;
  const dead = [];
  const refused = new Map();

  tickets.forEach((ticket, at) => {
    if (ticket?.status === 'ok') {
      sent += 1;
      return;
    }

    const reason = ticket?.details?.error ?? ticket?.message ?? 'unknown';
    if (reason === 'DeviceNotRegistered') {
      dead.push(batch[at].to);
      return;
    }

    // Everything else was counted as "not sent" and then thrown away, which is
    // how a whole platform can be silently undeliverable. A missing FCM
    // credential comes back here as MismatchSenderId or InvalidCredentials on
    // every single push, and nothing anywhere said so — the tokens looked
    // registered, the send looked like it ran, and no notification arrived.
    //
    // Grouped rather than logged per token: one misconfigured project means one
    // line per batch, not one per phone.
    refused.set(reason, (refused.get(reason) ?? 0) + 1);
  });

  for (const [reason, count] of refused) {
    console.warn(`[push] ${count} refused: ${reason}`);
  }

  if (dead.length) {
    await PushToken.deleteMany({ token: { $in: dead } }).catch(() => {});
  }
  return sent;
}

/** Register or re-point a device's token. */
export async function saveToken({ token, userId, profileId, platform, deviceId }) {
  if (!token) return null;

  // A reinstall issues a new token while the old one keeps working for a while,
  // which would double-deliver to the same phone. Clearing by device first is
  // what stops that.
  if (deviceId) {
    await PushToken.deleteMany({ deviceId, token: { $ne: token } }).catch(() => {});
  }

  return PushToken.findOneAndUpdate(
    { token },
    {
      $set: {
        userId,
        profileId: profileId ?? null,
        platform: platform ?? null,
        deviceId: deviceId ?? null,
        lastSeenAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );
}

/** Forget a device. Called on sign-out, so the next person is not sent their mail. */
export async function forgetToken(token) {
  if (!token) return;
  await PushToken.deleteOne({ token }).catch(() => {});
}
