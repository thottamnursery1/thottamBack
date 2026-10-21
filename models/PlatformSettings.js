const mongoose = require('mongoose');

const platformSettingsSchema = new mongoose.Schema({
  key: { type: String, default: 'platform', unique: true },
  commissionPercent: { type: Number, default: 10, min: 0, max: 40 },
  communityCommissionPercent: { type: Number, default: 10, min: 0, max: 40 },
  communityLocalDeliveryFee: { type: Number, default: 40, min: 0 },
  communityReturnWindowHours: { type: Number, default: 48, min: 0, max: 720 },
  payoutPolicy: {
    type: String,
    default: 'Community seller earnings stay accrued until the order is delivered and the return window closes. A payout is marked paid only after the finance user confirms the provider reference. Razorpay checkout does not split funds to sellers.',
  },
  settlementMode: { type: String, enum: ['manual_ledger'], default: 'manual_ledger' },
  plantListingExpiryDays: { type: Number, default: 30, min: 1, max: 180 },
  plantRequestExpiryHours: { type: Number, default: 72, min: 1, max: 720 },
  plantMaxActiveListings: { type: Number, default: 12, min: 1, max: 100 },
  plantRequireModeration: { type: Boolean, default: false },
  deliveryCharge: { type: Number, default: 40, min: 0 },
  freeDeliveryThreshold: { type: Number, default: 999, min: 0 },
  taxPercent: { type: Number, default: 0, min: 0, max: 28 },
  serviceablePins: [{ type: String, trim: true }],
  allowUnlistedPins: { type: Boolean, default: true },
  announcement: {
    type: String,
    default: 'Free delivery on orders above ₹999. Plants are packed by the nursery that grows them.',
  },
  supportEmail: { type: String, default: 'hello@rootandbloom.test' },
  supportPhone: { type: String, default: '1800-200-3344' },
  returnPolicy: {
    type: String,
    default: 'Healthy plants can be reported within 48 hours of delivery with photos. Refunds are reviewed by Root & Bloom and issued through Razorpay when a captured payment exists.',
  },
  cancellationPolicy: {
    type: String,
    default: 'Orders can be cancelled before a nursery marks them as dispatched. Paid cancellations are refunded by the platform after review.',
  },
  settlementNote: {
    type: String,
    default: 'Seller payouts are recorded for manual settlement. This build does not transfer funds through Razorpay Route.',
  },
  demoMode: { type: Boolean, default: true },
}, { timestamps: true });

platformSettingsSchema.statics.getSettings = async function getSettings() {
  let settings = await this.findOne({ key: 'platform' });
  if (!settings) settings = await this.create({ key: 'platform' });
  return settings;
};

module.exports = mongoose.model('PlatformSettings', platformSettingsSchema);
