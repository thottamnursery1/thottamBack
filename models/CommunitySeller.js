const mongoose = require('mongoose');

const communitySellerSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  fullName: { type: String, required: true, trim: true, maxlength: 80 },
  phone: { type: String, required: true, trim: true },
  displayName: { type: String, required: true, trim: true, maxlength: 80 },
  slug: { type: String, unique: true, lowercase: true },
  sellerType: {
    type: String,
    enum: ['home_gardener', 'plant_enthusiast', 'small_grower'],
    required: true,
  },
  bio: { type: String, maxlength: 800, default: '' },
  pickupAddress: {
    line1: { type: String, required: true, maxlength: 160 },
    line2: { type: String, maxlength: 160, default: '' },
    city: { type: String, required: true, maxlength: 80 },
    state: { type: String, required: true, maxlength: 80 },
    postalCode: { type: String, required: true },
  },
  serviceablePins: [{ type: String, trim: true }],
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending',
    index: true,
  },
  termsAcceptedAt: { type: Date, required: true },
  policiesAccepted: { type: Boolean, required: true },
  payout: {
    accountHolder: { type: String, maxlength: 80, default: '' },
    bankName: { type: String, maxlength: 80, default: '' },
    ifsc: { type: String, uppercase: true, default: '' },
    accountLast4: { type: String, default: '' },
    accountCipher: { type: String, select: false, default: '' },
    verificationStatus: {
      type: String,
      enum: ['unverified', 'pending', 'verified', 'failed'],
      default: 'unverified',
    },
  },
  ratings: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0 },
  },
  rejectionReason: { type: String, maxlength: 400, default: '' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
}, { timestamps: true });

communitySellerSchema.pre('save', function slugify(next) {
  if (!this.slug) {
    const base = this.displayName.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '').slice(0, 40);
    this.slug = `${base || 'seller'}-${this._id.toString().slice(-6)}`;
  }
  next();
});

communitySellerSchema.index({ status: 1, createdAt: -1 });
communitySellerSchema.index({ slug: 1 });
communitySellerSchema.index({ serviceablePins: 1, status: 1 });

communitySellerSchema.set('toJSON', {
  transform(doc, ret) {
    delete ret.payout?.accountCipher;
    return ret;
  },
});

module.exports = mongoose.model('CommunitySeller', communitySellerSchema);
