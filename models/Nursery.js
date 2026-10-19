const mongoose = require('mongoose');

const nurserySchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  slug: { type: String, unique: true, lowercase: true },
  ownerName: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  description: { type: String, maxlength: 1200, default: '' },
  logo: String,
  coverImage: String,
  address: {
    line1: { type: String, required: true },
    line2: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
  },
  serviceablePins: [{ type: String, trim: true }],
  gstin: { type: String, trim: true, uppercase: true, default: '' },
  businessType: {
    type: String,
    enum: ['proprietorship', 'partnership', 'private_limited', 'other'],
    default: 'proprietorship',
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending',
  },
  sellerCode: { type: String, unique: true, sparse: true, uppercase: true },
  documents: [{
    label: { type: String, trim: true, maxlength: 80 },
    url: { type: String, trim: true, maxlength: 400 },
  }],
  businessHours: { type: String, default: '9:00–18:00', maxlength: 80 },
  deliveryCharge: { type: Number, default: 0, min: 0 },
  shopOpen: { type: Boolean, default: true },
  productAdminEnabled: { type: Boolean, default: false },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
  rejectionReason: String,
  isDemo: { type: Boolean, default: false },
}, { timestamps: true });

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

nurserySchema.statics.uniqueSellerCode = async function uniqueSellerCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let code = 'NSY-';
    for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    const exists = await this.exists({ sellerCode: code });
    if (!exists) return code;
  }
  return `NSY-${Date.now().toString(36).toUpperCase()}`;
};

nurserySchema.pre('save', async function (next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') + '-' + this._id.toString().slice(-6);
  }
  if (!this.sellerCode) {
    this.sellerCode = await this.constructor.uniqueSellerCode();
  }
  next();
});

nurserySchema.index({ status: 1 });
nurserySchema.index({ slug: 1 });
nurserySchema.index({ 'address.city': 1 });

module.exports = mongoose.model('Nursery', nurserySchema);
