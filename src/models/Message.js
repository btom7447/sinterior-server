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

const Message = mongoose.model('Message', messageSchema);

export default Message;
