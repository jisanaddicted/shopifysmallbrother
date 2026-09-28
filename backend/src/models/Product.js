import mongoose from 'mongoose';

import { PRODUCT_STATUS } from '../utils/constants.js';

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------
// A merchant sells "Cotton T-shirt" in S/M/L and Red/Blue. Rather than making
// six separate products - which would scatter one item across the catalogue,
// break its search ranking and give it six descriptions to keep in sync - the
// sizes and colours hang off the one product as sub-documents.
//
// They are EMBEDDED, not a separate collection, on purpose: a variant is never
// addressed on its own, it only ever loads with its parent, and keeping it in
// the same document means the store-permission check and ORDER_POPULATE keep
// working exactly as they did before. A separate collection would need a join
// everywhere the product is already read.
//
// Everything here is ADDITIVE. A product with no `variants` behaves precisely
// as it did before this existed: it is priced and stocked by its own top-level
// `price`/`stock` and the storefront never shows a picker. That is what keeps
// every existing product, and the whole existing order flow, working untouched.

/**
 * One axis of variation - "Size" or "Colour" - and the values it takes.
 * The cartesian product of every option's values is what the merchant sees as
 * the variant matrix (2 options x (3 + 2) values = 6 rows).
 */
const optionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    values: {
      type: [String],
      default: () => [],
      // Values are trimmed on the way in by the controller; empty ones are
      // dropped there too, so an option left half-typed cannot create a blank
      // row in the matrix.
      validate: {
        validator: (values) => Array.isArray(values) && values.length <= 50,
        message: 'An option cannot have more than 50 values.',
      },
    },
  },
  { _id: false },
);

/**
 * One sellable combination - the "L / Blue" row of the matrix.
 *
 * `price` and `stock` live HERE and not on the product whenever variants exist:
 * two colours of the same shirt have genuinely different prices and genuinely
 * different stock, and collapsing them to one number is the bug this exists to
 * prevent. The product's own price/stock remain as the base that the matrix is
 * seeded from, and are what a variant-less product uses.
 */
const variantSchema = new mongoose.Schema(
  {
    // "L / Blue" - the shopper-facing label, stored rather than derived because
    // an order line has to be able to say what it sold even after the merchant
    // renames the option or deletes the variant.
    title: { type: String, trim: true, maxlength: 120, default: '' },
    sku: { type: String, trim: true, maxlength: 60, default: '' },
    price: { type: Number, required: true, min: 0, default: 0 },
    // Renders as the strikethrough on the storefront. 0 / empty means "none" -
    // a compare-at of 0 would be nonsense money, so the UI treats falsy as off.
    compareAtPrice: { type: Number, min: 0, default: null },
    stock: { type: Number, min: 0, default: 0 },
    // Overrides the product image for this row only, so a shopper can see the
    // blue one on the blue button. Falls back to the product image when empty.
    image: { type: String, trim: true, default: '' },
    // Which value of each option this row is, keyed by option name:
    // { Size: 'L', Colour: 'Blue' }. Mixed rather than a strict sub-schema
    // because its keys are the merchant's own option names, which are free text.
    optionValues: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    // A variant can be switched off without deleting it, keeping its history
    // intact. A disabled variant is hidden from the storefront and refused by
    // the server, so an old cart link or a stale tab cannot still sell it.
    enabled: { type: Boolean, default: true },
  },
  { _id: true },
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'A product needs a name.'],
      trim: true,
      maxlength: 120,
      index: true,
    },
    price: {
      type: Number,
      required: [true, 'A product needs a price.'],
      min: [0, 'Price cannot be negative.'],
      default: 0,
    },
    category: { type: String, trim: true, default: '', index: true },
    // Where the item physically sits in the shop, so staff can find it in a
    // big store: the rack/aisle and the shelf (bin) on it. Both optional and
    // free text - "A3" + "2" and "Chilled" + "Bottom shelf" are both valid
    // answers, and a takeaway menu never needs either.
    rack: { type: String, trim: true, maxlength: 20, default: '', index: true },
    shelf: { type: String, trim: true, maxlength: 20, default: '' },
    // Which merchant this belongs to. Null means a "global" product that only
    // appears on the general /store catalogue, not on any store page.
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      default: null,
      index: true,
    },
    stock: {
      type: Number,
      min: [0, 'Stock cannot be negative.'],
      default: 0,
    },
    image: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, maxlength: 500, default: '' },

    // --- Publishing ---------------------------------------------------------
    // Whether this product is on the shelf, being written, or finished with.
    // `active` is the default, so every product that exists today is on the
    // shelf exactly as it was before this field did.
    status: {
      type: String,
      enum: Object.values(PRODUCT_STATUS),
      default: PRODUCT_STATUS.ACTIVE,
      index: true,
    },

    // "I don't count these." A made-to-order cake, a digital download, a
    // service slot - none of them have a number that goes down when one is
    // bought. With this off, stock is neither shown nor enforced, which is
    // what stops the storefront from permanently greying the item out.
    trackInventory: { type: Boolean, default: true },

    // --- Organisation -------------------------------------------------------
    // Free-text grouping the merchant already thinks in. All optional and all
    // empty by default: a product with none of them set is a normal product,
    // exactly as before.
    //
    // `category` already existed and is what the storefront filters by;
    // `productType` is the finer "what kind of thing is it" (Skincare, Pizza,
    // Spare part) that sits beside it, and `vendor` is who supplies it.
    productType: { type: String, trim: true, maxlength: 60, default: '', index: true },
    vendor: { type: String, trim: true, maxlength: 80, default: '' },
    // Shopify-style collections: a list of labels, not a separate collection of
    // documents, because nothing in this app needs to query a product BY its
    // collection - they are only ever shown as tags on the product itself.
    collections: { type: [String], default: () => [] },

    // The variation axes and the sellable combinations they generate. See the
    // notes above: both default to empty, which is the "this product has no
    // variants" case that the rest of the app already handles.
    options: { type: [optionSchema], default: () => [] },
    variants: { type: [variantSchema], default: () => [] },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  },
);

/**
 * "Rack A3 · Shelf 2" - where to find this product, in one line. Empty when
 * the merchant has not recorded a location, so the UI can just print it.
 */
productSchema.virtual('location').get(function getLocation() {
  const parts = [];
  if (this.rack) parts.push(`Rack ${this.rack}`);
  if (this.shelf) parts.push(`Shelf ${this.shelf}`);
  return parts.join(' · ');
});

productSchema.virtual('id').get(function getId() {
  return this._id?.toString();
});

/**
 * Does this product have a real choice for the shopper to make?
 *
 * A product with options but no generated rows is mid-edit in the merchant's
 * form, and must behave as a plain product until the matrix exists - otherwise
 * saving a half-built matrix would hide the item from the storefront entirely.
 */
productSchema.virtual('hasVariants').get(function getHasVariants() {
  return Array.isArray(this.variants) && this.variants.length > 0;
});

/**
 * The cheapest and dearest sellable price, as `{ min, max }`.
 *
 * A variant product's own top-level price is a seed value for the matrix, not
 * something anyone pays, so the storefront and the product list both read this
 * instead. With no variants it collapses to the product price, which is what
 * keeps every existing display identical.
 */
productSchema.virtual('priceRange').get(function getPriceRange() {
  if (!this.hasVariants) {
    return { min: Number(this.price) || 0, max: Number(this.price) || 0 };
  }

  const sellable = this.variants.filter((variant) => variant.enabled !== false);
  const prices = (sellable.length ? sellable : this.variants).map(
    (variant) => Number(variant.price) || 0,
  );

  if (!prices.length) return { min: 0, max: 0 };
  return { min: Math.min(...prices), max: Math.max(...prices) };
});

/**
 * Units available across the whole matrix, or the product's own stock.
 *
 * Summing rather than taking the max is deliberate: a shopper can buy every
 * colour, so "is this in stock?" is about the sum. Stock is still enforced per
 * row at checkout - this number is only ever for display.
 */
productSchema.virtual('totalStock').get(function getTotalStock() {
  if (!this.hasVariants) return Number(this.stock) || 0;

  return this.variants.reduce(
    (sum, variant) => (variant.enabled === false ? sum : sum + (Number(variant.stock) || 0)),
    0,
  );
});

/**
 * How many variants carry their own image, so the merchant's form can say
 * "2 of 6 have their own photo" instead of making them count by hand.
 */
productSchema.virtual('imageCount').get(function getImageCount() {
  return this.variants.filter((variant) => String(variant.image || '').trim()).length;
});

/**
 * Is this product on the shelf?
 *
 * The single definition of "a shopper can see and buy this". The storefront
 * filters on it, the catalogue list filters on it, and the order controller
 * refuses anything that is not it - all three read this one virtual so they
 * cannot drift into three different answers about the same product.
 */
productSchema.virtual('isPublished').get(function getIsPublished() {
  return this.status === PRODUCT_STATUS.ACTIVE;
});

/**
 * How many sales channels this product is published to.
 *
 * This app has exactly one channel - the public storefront - so an active
 * product is on one and a draft/archived one is on none. Exposed as a number
 * because that is the shape the products table shows, and computing it here
 * rather than in the UI is what keeps the column honest if a second channel
 * (a marketplace, a POS) is ever added.
 */
productSchema.virtual('channelCount').get(function getChannelCount() {
  return this.isPublished ? 1 : 0;
});

/**
 * Price x stock across everything sellable, i.e. what the shelf is worth.
 *
 * Reads the same figures the storefront does - the price RANGE across the
 * matrix, and the summed stock - so this can never disagree with what a
 * customer would be charged. A product that does not track inventory
 * contributes 0: there is no countable stock to value.
 */
productSchema.virtual('inventoryValue').get(function getInventoryValue() {
  if (!this.trackInventory) return 0;
  return this.priceRange.min * (Number(this.totalStock) || 0);
});

export const Product = mongoose.model('Product', productSchema);
export default Product;
