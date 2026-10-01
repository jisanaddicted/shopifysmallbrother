import mongoose from 'mongoose';
import {
  LEGACY_LOGO_SIZES,
  LOGO_SIZE_DEFAULT,
  LOGO_SIZE_MAX,
  LOGO_SIZE_MIN,
} from '../utils/constants.js';

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
    /* Has the merchant claimed this slug as THEIRS?

       False (the default) means "this slug is just the store name spelled out,
       keep deriving it from the name" - so renaming the store moves its public
       URL with it. True means the merchant typed an address they wanted, and a
       later rename must leave it alone.

       A stored flag rather than comparing the slug to slugify(name), because
       that comparison is wrong for every store whose name was ever changed by
       something other than this rule: a store renamed once (Joe's Pizza ->
       Ronex mart) still carries the slug `joes-pizza`, which does not match
       slugify("Ronex mart"), so the comparison reads it as hand-chosen and the
       slug then never moves again - the exact bug this flag exists to fix.

       Defaulting to false is safe in the direction that matters: a store that
       has never been through the dashboard keeps following its name, which is
       what a merchant who never chose an address would expect. Stores whose
       slug was deliberately set by hand (see the `slug` in seed.js) carry
       slugIsCustom: true explicitly. */
    slugIsCustom: {
      type: Boolean,
      default: false,
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

    // -------------------------------------------------------------------------
    // How large the storefront header draws `logo`, in pixels. See
    // LOGO_SIZE_MIN/MAX/DEFAULT in utils/constants.js.
    //
    // A NUMBER rather than a step from a fixed set, because a merchant asking
    // "how big do I want it" wants to type or drag a size, and a menu of four
    // named answers can only offer four. The bounds are what replace the closed
    // list: they are enforced here AND refused by the API with a message, so an
    // out-of-range size is a 400 the merchant can read rather than a header that
    // has pushed its own buttons off the screen.
    //
    // Defaulting to 96 is what makes this safe to ship: every store that exists
    // today has no value here and renders exactly as it did before, and nothing
    // changes until a merchant deliberately sets a size.
    //
    // The setter normalises rather than trusting the caller. It is the last line
    // of defence, and it has to be the forgiving one: the field was briefly a
    // four-value string, so a store saved during that window still carries
    // "lg", and without this its next save would fail validation outright - a
    // logo size the merchant set, taking their storefront's edits down with it.
    // -------------------------------------------------------------------------
    logoSize: {
      type: Number,
      min: LOGO_SIZE_MIN,
      max: LOGO_SIZE_MAX,
      default: LOGO_SIZE_DEFAULT,
      set: (value) => {
        if (value === undefined || value === null || value === '') {
          return LOGO_SIZE_DEFAULT;
        }
        if (typeof value === 'string') {
          const legacy = LEGACY_LOGO_SIZES[value.trim().toLowerCase()];
          if (legacy !== undefined) return legacy;
        }
        const size = Number(value);
        if (!Number.isFinite(size)) return LOGO_SIZE_DEFAULT;
        return Math.min(LOGO_SIZE_MAX, Math.max(LOGO_SIZE_MIN, Math.round(size)));
      },
    },

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