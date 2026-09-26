import mongoose from 'mongoose';

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

export const Product = mongoose.model('Product', productSchema);
export default Product;
