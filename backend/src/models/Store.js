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
    // Which storefront layout this store presents. See THEME_VALUES in
    // utils/constants.js.
    //
    // A single field rather than a bag of booleans, so "one theme is active" is
    // true BY CONSTRUCTION - two layouts can never be half-on at once, which is
    // the failure a `showClassicSections` / `showTreeSections` pair would invite
    // the first time somebody toggled both.
    //
    // Defaulting to theme1 is what makes this safe to ship: every store that
    // exists today has no value here at all, and reads as theme1, so nothing
    // about the current storefront changes until a merchant deliberately picks
    // something else.
    //
    // The two layouts share NOTHING but this field. Theme 1 reads
    // `categories` (below) and each product's `category` string; theme 2 reads
    // the CategoryNode tree and each product's `categoryId`. Switching between
    // them rewrites no data on either side, so a store can go back and forth
    // and lose nothing.
    // -------------------------------------------------------------------------
    theme: {
      type: String,
      enum: ['theme1', 'theme2'],
      default: 'theme1',
    },

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

    // -------------------------------------------------------------------------
    // Category images, keyed by the lowercased category name.
    //
    // Deliberately a separate map rather than a field on the category entry. The
    // `categories` list above is plain strings on purpose - that is what keeps
    // grouping a trivial fold over the products a store already loads, with no
    // join and nothing to migrate. Turning those strings into sub-documents to
    // hang an image off each one would give every existing read, write and
    // comparison in the app a new shape to understand, for the sake of one
    // optional field.
    //
    // So the IMAGE is the side data, keyed by name, and a category is still
    // just a name. The key is lowercased because category matching is
    // case-insensitive everywhere else (see `listCategories`): storing the key
    // as typed would mean "Drinks" and "drinks" each got their own picture and
    // one of them silently lost.
    //
    // A plain object, not a Mongoose Map. A Map serialises to `{}` through
    // `toJSON` unless `flattenMaps` is enabled, and this data has to reach the
    // storefront over JSON - a Map would quietly ship empty and every category
    // would come back imageless with no error anywhere.
    // -------------------------------------------------------------------------
    categoryImages: {
      type: Object,
      default: () => ({}),
      set: (value) => {
        /* Normalise keys to lowercase and drop blanks, for the same reason the
           category list does. Values pass through untouched: the controller is
           what validates that a value is a real image. */
        const out = {};

        for (const [rawKey, rawValue] of Object.entries(value || {})) {
          const key = String(rawKey || '').trim().toLowerCase();
          const image = String(rawValue ?? '').trim();
          if (!key || !image) continue;
          out[key] = image;
        }

        return out;
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