const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const addressSchema = new mongoose.Schema({
  label: { type: String, default: 'Home' },
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  line1: { type: String, required: true },
  line2: String,
  city: { type: String, required: true },
  state: { type: String, required: true },
  postalCode: { type: String, required: true },
  country: { type: String, default: 'India' },
  isDefault: { type: Boolean, default: false },
}, { _id: true });

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [60, 'Name cannot exceed 60 characters'],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,})+$/, 'Please provide a valid email'],
  },
  phone: {
    type: String,
    trim: true,
    match: [/^[6-9]\d{9}$/, 'Please provide a valid Indian mobile number'],
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false,
  },
  role: {
    type: String,
    enum: ['customer', 'seller', 'shop_admin', 'shop_assistant', 'product_admin', 'admin', 'super_admin'],
    default: 'customer',
  },
  shop: { type: mongoose.Schema.Types.ObjectId, ref: 'Nursery', index: true },
  avatar: String,
  addresses: [addressSchema],
  wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  isActive: { type: Boolean, default: true },
  accountStatus: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
  },
  tokenVersion: { type: Number, default: 0 },
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationToken: String,
  emailVerificationExpire: Date,
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  lastLogin: Date,
  plantExchangeSuspended: { type: Boolean, default: false },
  razorpayAccountId: { type: String, trim: true, default: '' },
}, { timestamps: true });

userSchema.pre('save', function syncAccountStatus(next) {
  if (this.isModified('accountStatus')) {
    this.isActive = this.accountStatus !== 'inactive';
  } else if (this.isModified('isActive')) {
    this.accountStatus = this.isActive === false ? 'inactive' : 'active';
  } else if (this.accountStatus !== 'active' && this.accountStatus !== 'inactive') {
    this.accountStatus = this.isActive === false ? 'inactive' : 'active';
  }
  if (this.tokenVersion == null) this.tokenVersion = 0;
  next();
});

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare entered password with hashed
userSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

// Generate password reset token
userSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.resetPasswordExpire = Date.now() + 30 * 60 * 1000; // 30 minutes
  return resetToken;
};

userSchema.set('toJSON', {
  virtuals: true,
  transform(doc, ret) {
    ret.accountStatus = ret.accountStatus === 'inactive' || ret.isActive === false ? 'inactive' : 'active';
    delete ret.password;
    delete ret.tokenVersion;
    delete ret.resetPasswordToken;
    delete ret.resetPasswordExpire;
    delete ret.emailVerificationToken;
    delete ret.emailVerificationExpire;
    return ret;
  },
});

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ resetPasswordToken: 1 });
userSchema.index({ role: 1, accountStatus: 1 });

module.exports = mongoose.model('User', userSchema);
