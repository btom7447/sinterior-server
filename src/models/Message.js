import mongoose from 'mongoose';
import { resolveImageUrls } from '../utils/resolveUrl.js';

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
    media: [{
      type: String, // relative URL to uploaded image
    }],
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
        return ret;
      },
    },
    toObject: {
      transform(_doc, ret) {
        if (ret.media?.length) ret.media = resolveImageUrls(ret.media);
        return ret;
      },
    },
  }
);

// At least content or media must be present
messageSchema.pre('validate', function (next) {
  if (!this.content?.trim() && (!this.media || this.media.length === 0)) {
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
