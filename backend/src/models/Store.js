import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

/**
 * A merchant account. Every store has a public URL (`/s/<slug>`) that shows
 * only its own products, and owns the orders placed through that page.
 */
const storeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'A store needs a name.'],
      trim: true,
      maxlength: 100,
    },
    // Public URL segment. Kept lowercase and unique.
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    phone: { type: String, trim: true, default: '' },
    address: { type: addressSchema, default: () => ({}) },
    image: { type: String, trim: true, default: '' },
    logo: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },

    // -------------------------------------------------------------------------
    // The categories this store trades in, curated by the merchant.
    //
    // A category is the storefront's section title: every product filed under
    // "Drinks" is shown under a "Drinks" heading, in a rail of cards you swipe
    // sideways on a phone. See pages/customer/ShopPage.jsx.
    //
    // A STORE-SCOPED list rather than a collection, and that is the whole design
    // in one sentence. The things being grouped are products, and products
    // already carry a plain `category` string - so a category is not a new
    // entity with its own id, its own routes and a join to fetch. It is a
    // heading, and the heading is a name. Creating one is a single string
    // appended here, and grouping is then a fold over the products the store
    // already loads. Nothing that exists today has to be migrated: a store
    // with no `categories` simply has none curated, and the storefront falls
    // back to the distinct names on its own products.
    //
    // Both halves matter, and they are why this is a list and not a flag:
    //   - CURATED NAMES come first, so a merchant can create the section before
    //     the first product exists - the section is ready when the stock is.
    //   - PRODUCT NAMES are unioned in, so every product already filed under
    //     something still gets a section even if nobody ever curated the list.
    // `listCategories` in controllers/menuController.js is where those two are
    // merged, and where the matching rule lives.
    // -------------------------------------------------------------------------
    categories: {
      type: [String],
      default: () => [],
      set: (value) => {
        // Normalise on the way in rather than trusting every caller: trim each
        // name, drop the blanks, and keep only the first spelling of any
        // duplicated name. Without this, "Drinks" and " drinks " typed twice
        // would become two sections on the storefront that a shopper reads as
        // one, each holding half the products.
        const names = [];
        const seen = new Set();

        for (const entry of Array.isArray(value) ? value : []) {
          const name = String(entry ?? '').trim();
          if (!name) continue;

          const key = name.toLowerCase();
          if (seen.has(key)) continue;

          seen.add(key);
          names.push(name);
        }

        return names;
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  },
);

storeSchema.virtual('id').get(function getId() {
  return this._id?.toString();
});

/** The public path the client links to, e.g. "/s/joe-s-pizza". */
storeSchema.virtual('publicPath').get(function publicPath() {
  return `/s/${this.slug}`;
});

export const Store = mongoose.model('Store', storeSchema);
export default Store;