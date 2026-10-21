const mongoose = require('mongoose');

const listingReportSchema = new mongoose.Schema({
  targetType: { type: String, enum: ['product', 'order', 'plant'], required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  plantListing: { type: mongoose.Schema.Types.ObjectId, ref: 'PlantCommunityListing' },
  communitySeller: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunitySeller' },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: {
    type: String,
    enum: ['suspicious', 'poor_quality', 'damaged', 'incorrect', 'scam', 'unsafe', 'inappropriate', 'restricted_species', 'other'],
    required: true,
  },
  details: { type: String, required: true, maxlength: 1000 },
  status: {
    type: String,
    enum: ['open', 'reviewing', 'resolved', 'dismissed'],
    default: 'open',
  },
  resolution: { type: String, maxlength: 400, default: '' },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

listingReportSchema.index({ status: 1, createdAt: -1 });
listingReportSchema.index({ reporter: 1, product: 1, createdAt: -1 });

module.exports = mongoose.model('ListingReport', listingReportSchema);
