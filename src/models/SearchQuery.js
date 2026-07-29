import mongoose from 'mongoose';

/**
 * What people search for, counted — not who searched it.
 *
 * There is no user reference here on purpose. Search history is the most
 * sensitive thing an app like this holds: somebody looking for the cheapest
 * plumber, or for work in a neighbourhood they have not told anyone about, has
 * not agreed to have that attached to their name. The device keeps their own
 * history locally; this keeps only the aggregate.
 *
 * What it is for is the content gap. A query with results tells us the corpus
 * is working; a query with none tells us which trade people want and we do not
 * have, which is the only honest input to deciding what to commission.
 */
const searchQuerySchema = new mongoose.Schema(
  {
    /** Normalised — lower-cased and collapsed — so counts actually aggregate. */
    term: { type: String, required: true, unique: true, trim: true },
    count: { type: Number, default: 0, min: 0 },
    /** How many times this returned nothing at all. */
    emptyCount: { type: Number, default: 0, min: 0 },
    lastSearchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// The two questions asked of this collection: what is popular, and what is
// popular and failing.
searchQuerySchema.index({ count: -1 });
searchQuerySchema.index({ emptyCount: -1 });

const SearchQuery = mongoose.model('SearchQuery', searchQuerySchema);
export default SearchQuery;
