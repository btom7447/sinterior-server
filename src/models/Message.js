import mongoose from 'mongoose';

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
      required: [true, 'Message content is required'],
      trim: true,
      maxlength: [2000, 'Message cannot exceed 2000 characters'],
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ receiverId: 1, isRead: 1 });

const Message = mongoose.model('Message', messageSchema);

export default Message;
