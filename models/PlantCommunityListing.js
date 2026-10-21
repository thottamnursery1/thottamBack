const mongoose = require('mongoose');

const plantCommunityListingSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  ownerName: { type: String, trim: true, maxlength: 80, default: '' },
  listingType: { type: String, enum: ['FreeAdoption', 'Exchange', 'Sale'], required: true, index: true },
  status: {
    type: String,
    enum: ['Draft', 'PendingModeration', 'Active', 'Reserved', 'Completed', 'Paused', 'Expired', 'Rejected', 'Removed'],
    default: 'Draft',
    index: true,
  },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  category: {
    type: String,
    enum: ['herb', 'indoor', 'outdoor', 'seedling', 'flowering', 'succulent', 'gardening'],
    required: true,
  },
  description: { type: String, required: true, maxlength: 2000 },
  careInstructions: { type: String, maxlength: 1000, default: '' },
  images: [{
    url: { type: String, required: true },
    publicId: String,
  }],
  condition: { type: String, enum: ['healthy', 'fair', 'needs_care'], default: 'healthy' },
  size: { type: String, enum: ['small', 'medium', 'large', ''], default: '' },
  potSize: { type: String, maxlength: 40, default: '' },
  quantity: { type: Number, default: 1, min: 1 },
  reason: { type: String, maxlength: 400, default: '' },
  pickupAvailability: { type: String, maxlength: 300, default: '' },
  collectionInstructions: { type: String, maxlength: 500, default: '' },
  desiredPlants: { type: String, maxlength: 400, default: '' },
  exchangeCategories: [{ type: String }],
  exchangeNotes: { type: String, maxlength: 400, default: '' },
  price: { type: Number, min: 0, default: 0 },
  mrp: { type: Number, min: 0 },
  fulfillment: [{ type: String, enum: ['pickup', 'local_delivery', 'courier'] }],
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  city: { type: String, trim: true, maxlength: 80, default: '' },
  postalCode: { type: String, trim: true, default: '' },
  area: { type: String, trim: true, maxlength: 120, default: '' },
  lat: { type: Number },
  lng: { type: Number },
  reservedKind: { type: String, enum: ['adoption', 'exchange', ''], default: '' },
  reservedRef: { type: mongoose.Schema.Types.ObjectId },
  expiresAt: Date,
  moderationNote: { type: String, maxlength: 400, default: '' },
  ratings: {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 },
  },
}, { timestamps: true });

plantCommunityListingSchema.index({ listingType: 1, status: 1, createdAt: -1 });
plantCommunityListingSchema.index({ category: 1, status: 1 });
plantCommunityListingSchema.index({ city: 1, postalCode: 1, status: 1 });
plantCommunityListingSchema.index({ owner: 1, name: 1, status: 1 });

module.exports = mongoose.model('PlantCommunityListing', plantCommunityListingSchema);
