import mongoose from 'mongoose';

/**
 * One row of a store's storefront navigation menu (Shopify-style).
 *
 * A merchant builds top-level nav items ("Shop", "Pizza", "Deals") and nests
 * sub-items under them; the customer sees the result as the storefront navbar
 * with hover dropdowns. Each row links to exactly one target:
 *   - product  -> a single product page anchor on the store page
 *   - category -> filters the store page to that category
 *   - url      -> any internal path (/s/<slug>) or full https URL
 *
 * `parent: null` = top-level item, otherwise a sub-item of another NavMenu.
 * One store owns many rows; deleting the store wipes its menu.
 */
const navMenuSchema = new mongoose.Schema(
  {
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    label: {
      type: String,
      required: [true, 'A menu item needs a label.'],
      trim: true,
      maxlength: 60,
    },
    targetType: {
      type: String,
      enum: {
        values: ['product', 'category', 'url'],
        message: '{VALUE} is not a valid menu target.',
      },
      default: 'category',
      index: true,
    },
    // product -> Product _id; category -> free-text category name;
    // url -> path or full URL. Validated per targetType in the controller.
    target: { type: String, trim: true, default: '' },
    // Null = top-level nav item; otherwise the _id of the parent item.
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NavMenu',
      default: null,
      index: true,
    },
    position: { type: Number, default: 0, index: true },
    isVisible: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  },
);

navMenuSchema.virtual('id').get(function getId() {
  return this._id?.toString();
});

// Siblings sort by position; one store never shows the same label twice at
// the same level (case-insensitive guard lives in the controller).
navMenuSchema.index({ store: 1, parent: 1, position: 1 });

export const NavMenu = mongoose.model('NavMenu', navMenuSchema);
export default NavMenu;
