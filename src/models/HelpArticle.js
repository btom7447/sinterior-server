import mongoose from 'mongoose';

const helpArticleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    category: { type: String, trim: true, maxlength: 80 }, // e.g. "Getting Started", "For Clients"
    emoji: { type: String, trim: true, maxlength: 8 }, // emoji shown next to category
    excerpt: { type: String, trim: true, maxlength: 500 },
    body: { type: String, required: true }, // markdown
    order: { type: Number, default: 0 }, // sort order within a category
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
    },
  },
  { timestamps: true }
);

helpArticleSchema.index({ status: 1, category: 1, order: 1 });

const HelpArticle = mongoose.model('HelpArticle', helpArticleSchema);
export default HelpArticle;
