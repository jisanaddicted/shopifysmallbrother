import mongoose from 'mongoose';

/**
 * One node of a store's category TREE - the structure Theme 2 browses.
 *
 * WHY A SEPARATE COLLECTION, AND WHY THIS IS NOT `Store.categories`
 *
 * Theme 1's categories are plain strings on the store document, and that is
 * deliberate: a category there is a heading, products carry the heading as a
 * `category` string, and grouping is a fold over products already in memory
 * (see the long note on `Store.categories`).
 *
 * A tree cannot work that way. A node is something a shopper can BE - it has a
 * parent, a position among its siblings, and products filed under it - and the
 * whole point of drilling down is that two nodes may share a name ("Milk" as a
 * top-level category, and "Milk" under "Dairy" are different shelves). A string
 * cannot say which one. So a node is a real document with a real id, and
 * products point at that id.
 *
 * Storing it beside the store rather than inside it keeps Theme 1 completely
 * untouched: switching themes never rewrites, moves or deletes a single one of
 * the existing flat categories, and switching back is instant.
 *
 * SELF-REFERENTIAL `parent`, flattened on purpose. A node stores its parent's
 * id rather than a nested `children` array, which is exactly how `NavMenu`
 * already models the menu's own hierarchy - the tree is assembled at read time
 * by folding on `parent` (see `buildTree` in ThemeBuilder.jsx). Embedding
 * children instead would mean rewriting an entire ancestor chain to insert one
 * node, and no way to query "everything under this branch" without loading it
 * all anyway.
 */
const categoryNodeSchema = new mongoose.Schema(
  {
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'A category needs a name.'],
      trim: true,
      maxlength: 60,
    },
    // null for a top-level category. Indexed because "everything directly
    // under this node" is the single most common read in the whole feature.
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CategoryNode',
      default: null,
    },
    // Order among SIBLINGS only. A node's place in the shop comes from its
    // parent's children sorted by this, not from a global list.
    position: { type: Number, default: 0 },
    // A base64 data URL, the same shape and the same 1MB ceiling as the
    // Theme 1 category pictures (see menuController.setCategoryImage) - the
    // card a shopper taps on the way down is built from it.
    image: { type: String, default: '' },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  },
);

/* The two reads that matter, and the one compound index that serves both:
   "this store's whole tree" and "this store's children of X", which is the
   breadcrumb's and the drill-down's core lookup. */
categoryNodeSchema.index({ store: 1, parent: 1, position: 1 });

categoryNodeSchema.virtual('id').get(function getId() {
  return this._id?.toString();
});

export const CategoryNode = mongoose.model('CategoryNode', categoryNodeSchema);
export default CategoryNode;