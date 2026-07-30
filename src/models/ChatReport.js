import mongoose from 'mongoose';

/**
 * Somebody reporting a conversation.
 *
 * This is the way in to platform staff, and it exists because the alternative is
 * worse: an admin account findable in name search means members open private
 * threads with whoever answers, about jobs nothing is logged against. A report
 * carries the conversation with it, so whoever picks it up can read the thread
 * rather than ask the member to explain it again.
 *
 * One open report per person per conversation. Reporting the same thread three
 * times is one complaint, and three rows in the queue is three people reading
 * the same messages.
 */
const chatReportSchema = new mongoose.Schema(
  {
    conversationId: { type: String, required: true, index: true },

    /** Who complained, and who about. Both by profile, as chat is. */
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
      index: true,
    },
    reported: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },

    /**
     * Deliberately short and fixed. A free-text-only report is a paragraph
     * somebody has to read before they can triage it; the reason sorts the queue
     * and the note explains the case.
     */
    reason: {
      type: String,
      required: true,
      enum: [
        'harassment',
        'scam',
        'off_platform_payment',
        'no_show',
        'impersonation',
        'spam',
        'other',
      ],
    },
    note: { type: String, trim: true, maxlength: 1000, default: '' },

    /**
     * The last message when the report was filed, so staff can see the thread as
     * the reporter saw it even if it grows afterwards.
     */
    lastMessageAt: { type: Date, default: null },

    status: {
      type: String,
      enum: ['open', 'reviewing', 'actioned', 'dismissed'],
      default: 'open',
      index: true,
    },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', default: null },
  },
  { timestamps: true }
);

// One live report per reporter per conversation; a resolved one does not block a
// new complaint about later behaviour.
chatReportSchema.index(
  { conversationId: 1, reporter: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['open', 'reviewing'] } } }
);

// The triage queue: oldest open first.
chatReportSchema.index({ status: 1, createdAt: 1 });

const ChatReport = mongoose.model('ChatReport', chatReportSchema);
export default ChatReport;
