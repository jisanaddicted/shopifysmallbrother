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