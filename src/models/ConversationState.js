import mongoose from 'mongoose';

/**
 * One person's own arrangement of one conversation.
 *
 * Chat has no conversation document — a thread is just the messages that share a
 * deterministic id — which was the right shape while nothing about a thread belonged
 * to a person rather than to the pair. Pinning breaks that: a thread pinned by a
 * client is not pinned for the artisan, and a thread one of them has cleared is
 * untouched for the other.
 *
 * So this is per profile per conversation, created lazily. Most threads never get a
 * row, which is the point: the absence of one is the default state and costs nothing.
 */
const conversationStateSchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
      index: true,
    },
    conversationId: { type: String, required: true },

    /**
     * When it was pinned, not whether.
     *
     * The timestamp orders several pinned threads among themselves — most recently
     * pinned first, which is what somebody expects after pinning a fourth one and
     * looking for it at the top.
     */
    pinnedAt: { type: Date, default: null },

    /**
     * Muted until this moment. Null is not muted.
     *
     * A time rather than a flag so "mute for 8 hours" is expressible without a
     * scheduled job to unmute it — the comparison happens on read.
     */
    mutedUntil: { type: Date, default: null },

    /**
     * Everything before this is hidden from this person.
     *
     * How "delete chat" works without deleting anybody else's copy: the messages stay
     * for the other participant, and this reader's thread starts after the line. A
     * marker rather than a bulk write over every message, so clearing a thread of
     * four thousand messages is one document.
     */
    clearedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One row per person per thread, and the lookup the conversation list makes.
conversationStateSchema.index({ profileId: 1, conversationId: 1 }, { unique: true });

const ConversationState = mongoose.model('ConversationState', conversationStateSchema);
export default ConversationState;
