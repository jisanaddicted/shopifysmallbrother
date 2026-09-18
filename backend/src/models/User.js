import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES, ROLE_VALUES } from '../utils/constants.js';

const SALT_ROUNDS = 10;

// A rider's last known position. Updated over the socket connection.
const pointSchema = new mongoose.Schema(
  {
    lat: { type: Number },
    lng: { type: Number },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please tell us your name.'],
      trim: true,
      maxlength: 80,
    },
    email: {
      type: String,
      required: [true, 'An email address is required.'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, trim: true, default: '' },

    // Never returned by a query unless explicitly asked for (+passwordHash).
    passwordHash: { type: String, required: true, select: false },

    role: {
      type: String,
      enum: {
        values: ROLE_VALUES,
        message: '{VALUE} is not a supported role.',
      },
      default: ROLES.CUSTOMER,
    },

    // Riders only: dispatch skips riders who have toggled themselves off.
    isAvailable: { type: Boolean, default: true },

    // Riders only: last position seen from the socket.
    location: { type: pointSchema, default: undefined },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// The client reads `_id || id`, so expose both.
userSchema.virtual('id').get(function getId() {
  return this._id?.toString();
});

// Hash on the way in so a plain password can never be persisted.
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('passwordHash')) return next();

  // Already looks like a bcrypt hash - don't double-hash it.
  if (/^\$2[aby]\$\d{2}\$/.test(this.passwordHash)) return next();

  this.passwordHash = await bcrypt.hash(this.passwordHash, SALT_ROUNDS);
  return next();
});

// Safety net: strip the hash from anything sent to the browser.
userSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

/** Sets a plain-text password, hashing it. */
userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(String(plain), SALT_ROUNDS);
  return this.passwordHash;
};

/** Compares a plain-text password against the stored hash. */
userSchema.methods.verifyPassword = function verifyPassword(plain) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(String(plain), this.passwordHash);
};

userSchema.statics.hashPassword = (plain) =>
  bcrypt.hash(String(plain), SALT_ROUNDS);

export const User = mongoose.model('User', userSchema);
export default User;
