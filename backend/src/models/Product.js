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

productSchema.virtual('id').get(function getId() {
  return this._id?.toString();
});

export const Product = mongoose.model('Product', productSchema);
export default Product;
