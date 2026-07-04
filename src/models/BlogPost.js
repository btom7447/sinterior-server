import mongoose from 'mongoose';

const blogPostSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    excerpt: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    body: {
      type: String,
      required: true,
    },
    coverImage: {
      type: String,
      trim: true,
    },
    tags: [{ type: String, trim: true }],
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
    },
    publishedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

blogPostSchema.index({ status: 1, publishedAt: -1 });

// Auto-set publishedAt when status changes to published
blogPostSchema.pre('save', function (next) {
  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  next();
});

const BlogPost = mongoose.model('BlogPost', blogPostSchema);
export default BlogPost;
