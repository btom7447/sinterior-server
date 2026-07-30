import mongoose from 'mongoose';
import { resolveImageUrls } from '../utils/resolveUrl.js';

/**
 * One attached file, with everything needed to draw it before it is fetched.
 *
 * media[] was a bare array of URLs, which is enough to show a photograph and
 * nothing else. A document has to be introduced by name and size — nobody taps
 * an unnamed 4MB download on mobile data — and a video needs a still to sit
 * behind its play button. Guessing any of that from the URL is how you end up
 * showing "1758912.pdf" where "Kitchen quote.pdf" belongs.
 */
const attachmentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    /** Cloudinary's handle, so the asset can be deleted with the message. */
    publicId: { type: String, default: null },
    /** How Cloudinary stores it, which is needed to build a delete or a poster. */
    resourceType: { type: String, enum: ['image', 'video', 'raw'], default: 'image' },

    /**
     * What the app draws: a photo tile, a video tile, a voice note, or a
     * document row. `voice` is stored as a video resource because that is how
     * Cloudinary handles audio, so kind and resourceType deliberately differ.
     */
    kind: { type: String, enum: ['image', 'video', 'voice', 'file'], required: true },
    mime: { type: String, default: null },

    /** The name is most of what tells somebody whether to open the thing. */
    name: { type: String, default: null, maxlength: 200 },
    size: { type: Number, default: 0 },

    /**
     * Known dimensions let the grid reserve the right space before the bytes
     * land, which is the difference between a thread that settles and one that
     * jumps under the reader's thumb.
     */
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    durationMs: { type: Number, default: null },
    thumbnailUrl: { type: String, default: null },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    // conversationId is a deterministic string built from two sorted profile IDs
    // e.g. `${profileIdA}_${profileIdB}` (smaller id first alphabetically)
    conversationId: {
      type: String,
      required: [true, 'conversationId is required'],
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: [true, 'senderId is required'],
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: [true, 'receiverId is required'],
    },
    content: {
      type: String,
      trim: true,
      maxlength: [2000, 'Message cannot exceed 2000 characters'],
      default: '',
    },
    /**
     * Kept as it was, holding image and video URLs only.
     *
     * The web client reads media[] directly and there is no reason to break it
     * for a mobile feature. Both are written on send; attachments[] is the one
     * that carries meaning, media[] is the compatible shadow of it.
     */
    media: [{
      type: String, // relative URL to uploaded image
    }],

    /** Every attachment, documents included, with its metadata. */
    attachments: { type: [attachmentSchema], default: [] },

    /**
     * The message this one answers.
     *
     * On a marketplace "this one" needs a referent far more than it does in a
     * social chat: a thread carries several quotes, several photographs and
     * several dates, and "no, the other one" is how a job gets done wrong. A
     * reference rather than a copy, so an edit or a removal upstream is reflected
     * rather than frozen — and populated on read, since a quote strip that costs a
     * second request per bubble is a quote strip nobody draws.
     */
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },

    /**
     * Who has removed this from their own view.
     *
     * "Delete for me" is per-person, so it cannot be a flag — the same message is
     * removed for one participant and untouched for the other.
     *
     * NOT filtered on read. The row is still returned to whoever deleted it, as a
     * marker saying they did: a message that simply disappears leaves a hole where
     * the reply underneath it still refers to something, and on a platform where a
     * thread is the record of a job, silent gaps are the last thing anybody wants.
     * The other participant is never told this happened.
     */
    hiddenFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Profile' }],

    /**
     * Withdrawn by its sender for everybody.
     *
     * The row stays. A hole in a conversation is worse than a marker: the reply
     * underneath it still refers to something, and a thread that silently loses a
     * message is a thread nobody can reason about in a dispute. WhatsApp shows
     * "this message was deleted" for the same reason.
     */
    deletedForEveryone: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    isRead: {
      type: Boolean,
      default: false,
    },

    /**
     * How far along a message has got, for the tick beside it.
     *
     * sent      — accepted by the server. One tick.
     * delivered — reached the recipient's device. Two ticks.
     * read      — they opened the thread. Two ticks, coloured.
     *
     * A boolean cannot express this: "not read" covers both "still in the air"
     * and "sitting on their phone unopened", and those are the two states a
     * sender most wants told apart. isRead stays as the source of truth for
     * unread counts, which are counted by query all over the app.
     */
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
      index: true,
    },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        if (ret.media?.length) ret.media = resolveImageUrls(ret.media);
        if (ret.attachments?.length) ret.attachments = resolveAttachments(ret.attachments);
        return ret;
      },
    },
    toObject: {
      transform(_doc, ret) {
        if (ret.media?.length) ret.media = resolveImageUrls(ret.media);
        if (ret.attachments?.length) ret.attachments = resolveAttachments(ret.attachments);
        return ret;
      },
    },
  }
);

/**
 * Attachments are stored as absolute Cloudinary URLs today, but media[] holds
 * relative paths from older messages, so both go through the resolver.
 */
function resolveAttachments(attachments) {
  if (!Array.isArray(attachments)) return attachments;
  return attachments.map((a) => {
    const [url] = resolveImageUrls([a?.url]);
    const [thumbnailUrl] = resolveImageUrls([a?.thumbnailUrl]);
    return { ...a, url, thumbnailUrl };
  });
}

// At least content or something attached must be present.
messageSchema.pre('validate', function (next) {
  const hasFiles = this.media?.length > 0 || this.attachments?.length > 0;
  if (!this.content?.trim() && !hasFiles) {
    return next(new Error('Message must have content or media.'));
  }
  next();
});

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ receiverId: 1, isRead: 1 });
// Finding what to mark delivered the moment a recipient reconnects.
messageSchema.index({ receiverId: 1, status: 1 });

const Message = mongoose.model('Message', messageSchema);

export default Message;
