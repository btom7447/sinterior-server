import mongoose from 'mongoose';

/**
 * One person deciding they want nothing to do with another.
 *
 * Both stores require this of any app carrying user-generated content — Apple
 * spells it out in Guideline 1.2, alongside reporting and a way to reach
 * support. Sintherior had reporting and no blocking, which is the usual reason
 * a marketplace gets bounced on its first submission.
 *
 * Deliberately one-directional and not mutual: `blocker` no longer sees or
 * hears from `blocked`, and `blocked` cannot open a conversation with them. The
 * blocked party is never told, because telling them is how a block becomes an
 * escalation.
 *
 * Shaped like Follow — the same profile-to-profile pair with a unique compound
 * index — so the enforcement queries read the same way.
 */
const blockSchema = new mongoose.Schema(
  {
    blocker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    blocked: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    /**
     * Why, when they said.
     *
     * Optional: a block must never be gated behind a form, because the moment
     * somebody wants one is the moment they least want to explain themselves.
     * It is kept for moderation — a pattern of blocks against one account with
     * the same reason attached is the signal an admin actually needs.
     */
    reason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

// The pair, for "has A blocked B" — the question every enforcement point asks.
blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
// The reverse, for "who has blocked B", which moderation reads.
blockSchema.index({ blocked: 1, createdAt: -1 });

const Block = mongoose.model('Block', blockSchema);
export default Block;
