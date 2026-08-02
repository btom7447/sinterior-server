import mongoose from 'mongoose';

/**
 * A shelf in the shop.
 *
 * Categories were a hardcoded array in two repositories — one in the server's
 * config, one in the mobile app — which meant adding a shelf took a deploy of
 * both, and a category could never have a picture of its own. The rail had to
 * borrow whichever product sold best, so "Cement" was really a photograph of
 * one bag of somebody's cement.
 *
 * Subcategories are embedded rather than their own collection. They are always
 * read with their parent, never alone, and a category with forty of them is not
 * a thing that happens on a marketplace this shape.
 */
const subcategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema(
  {
    /**
     * The display name, and the value products are filed under.
     *
     * Products store the category as a string, so renaming one has to carry the
     * listings with it — see the rename handling in the controller. Unique
     * because two shelves with one name is a filter that matches both.
     */
    name: { type: String, required: true, unique: true, trim: true, maxlength: 60 },

    /** The category's own photograph, rather than one borrowed from a listing. */
    image: { type: String, trim: true, default: null },

    subcategories: { type: [subcategorySchema], default: [] },

    /**
     * Where it sits in the rail.
     *
     * Explicit rather than alphabetical: cement and tiles belong near the top of
     * a building-materials shop and "Aggregates" does not deserve first place
     * for beginning with an A.
     */
    order: { type: Number, default: 0 },

    /**
     * Hidden rather than deleted.
     *
     * Deleting a category would orphan every product filed under it. Inactive
     * keeps the listings intact and takes the shelf out of the rail.
     */
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

categorySchema.index({ order: 1, name: 1 });

const Category = mongoose.model('Category', categorySchema);
export default Category;
