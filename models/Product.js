const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g. "Small Pot", "Large Pot"
  sku: String,
  price: { type: Number, required: true },
  mrp: Number,
  stock: { type: Number, default: 0 },
  weight: String, // e.g. "500g", "1kg"
  size: String,
}, { _id: true });

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [120, 'Product name cannot exceed 120 characters'],
  },
  slug: { type: String, unique: true, lowercase: true },
  description: {
    type: String,
    required: [true, 'Product description is required'],
    maxlength: [2000, 'Description cannot exceed 2000 characters'],
  },
  shortDescription: {
    type: String,
    maxlength: [300, 'Short description cannot exceed 300 characters'],
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Category is required'],
  },
  nursery: { type: mongoose.Schema.Types.ObjectId, ref: 'Nursery', index: true },
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nursery', index: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nursery', index: true },
  subcategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  listingStatus: {
    type: String,
    enum: ['draft', 'pending', 'published', 'rejected', 'out_of_stock'],
    default: 'pending',
  },
  deliveryAvailability: { type: String, maxlength: 180, default: 'Delivered by the nursery that grows this plant.' },
  beginnerFriendly: { type: Boolean, default: false },
  plantType: {
    type: String,
    enum: ['foliage', 'flowering', 'succulent', 'herb', 'fruit', 'seed', 'pot', 'soil', 'kit', 'other'],
    default: 'other',
  },
  seasonalCollection: { type: String, default: '' },
  seasonalTags: {
    type: [{
      type: String,
      enum: ['Monsoon', 'Summer', 'Winter'],
    }],
    default: [],
  },
  isDemo: { type: Boolean, default: false },
  images: [{
    url: { type: String, required: true },
    publicId: String, // Cloudinary public_id for deletion
    alt: String,
  }],
  price: { type: Number, required: [true, 'Price is required'], min: 0 },
  mrp: { type: Number, min: 0 }, // Maximum Retail Price
  discountPercent: { type: Number, default: 0, min: 0, max: 100 },
  variants: [variantSchema],
  sku: { type: String, unique: true, sparse: true },
  stock: { type: Number, default: 0, min: 0 },
  lowStockThreshold: { type: Number, default: 5 },
  isActive: { type: Boolean, default: true },
  isFeatured: { type: Boolean, default: false },
  isBestSeller: { type: Boolean, default: false },
  isNewArrival: { type: Boolean, default: false },
  isOnSale: { type: Boolean, default: false },
  tags: [String],
  // Plant-specific attributes
  plantInfo: {
    sunlightRequirement: {
      type: String,
      enum: ['Full Sun', 'Partial Sun', 'Shade', 'Indirect Light', 'N/A'],
      default: 'N/A',
    },
    wateringFrequency: {
      type: String,
      enum: ['Daily', 'Every 2-3 Days', 'Weekly', 'Bi-weekly', 'Monthly', 'N/A'],
      default: 'N/A',
    },
    careLevel: {
      type: String,
      enum: ['Easy', 'Moderate', 'Expert', 'N/A'],
      default: 'N/A',
    },
    petFriendly: { type: Boolean, default: true },
    airPurifying: { type: Boolean, default: false },
    indoorOutdoor: {
      type: String,
      enum: ['Indoor', 'Outdoor', 'Both', 'N/A'],
      default: 'N/A',
    },
    height: String, // e.g. "30-40 cm"
    potSize: String, // e.g. "4 inch"
    season: String, // flowering season
    soil: { type: String, default: '' },
    maintenance: { type: String, default: '' },
    careInstructions: String,
  },
  ratings: {
    average: { type: Number, default: 0, min: 0, max: 5 },
    count: { type: Number, default: 0 },
  },
  soldCount: { type: Number, default: 0 },
  weight: Number, // in grams, for shipping
  dimensions: {
    length: Number,
    width: Number,
    height: Number,
  },
  deliveryInfo: String,
  listingSource: {
    type: String,
    enum: ['nursery', 'community'],
    default: 'nursery',
    index: true,
  },
  communitySeller: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunitySeller', index: true },
  fulfillmentOptions: [{
    type: String,
    enum: ['pickup', 'local_delivery', 'courier'],
  }],
  dispatchPrepHours: { type: Number, default: 24, min: 0, max: 168 },
  plantForm: {
    type: String,
    enum: ['seedling', 'cutting', 'propagated', 'mature', 'supply', ''],
    default: '',
  },
  localDeliveryFee: { type: Number, min: 0 },
  paused: { type: Boolean, default: false },
  pauseReason: { type: String, default: '' },
  moderationStatus: {
    type: String,
    enum: ['clear', 'flagged', 'removed'],
    default: 'clear',
  },
  moderationNote: { type: String, maxlength: 400, default: '' },
}, { timestamps: true });

const SEASONAL_TAGS = ['Monsoon', 'Summer', 'Winter'];

function canonicalSeason(value) {
  return SEASONAL_TAGS.find((season) => season.toLowerCase() === String(value || '').trim().toLowerCase()) || '';
}

function canonicalSeasonList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(canonicalSeason).filter(Boolean))];
}

function syncSeasonalFields(doc, { tagsModified = false } = {}) {
  const fromTags = canonicalSeasonList(doc.seasonalTags);
  const legacy = canonicalSeason(doc.seasonalCollection);
  if (tagsModified) {
    doc.seasonalTags = fromTags;
    doc.seasonalCollection = fromTags[0] || '';
    return;
  }
  if (fromTags.length) {
    doc.seasonalTags = fromTags;
    if (!legacy || !fromTags.includes(doc.seasonalCollection)) doc.seasonalCollection = fromTags[0];
    return;
  }
  if (legacy) {
    doc.seasonalTags = [legacy];
    doc.seasonalCollection = legacy;
  }
}

productSchema.pre('validate', function (next) {
  syncSeasonalFields(this, { tagsModified: !this.isNew && this.isModified('seasonalTags') });
  next();
});

productSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() || {};
  const target = update.$set || update;
  if (target.seasonalTags !== undefined || target.seasonalCollection !== undefined) {
    const tagsModified = target.seasonalTags !== undefined;
    syncSeasonalFields(target, { tagsModified });
    if (update.$set) update.$set = target;
    this.setUpdate(update);
  }
  next();
});

// Auto-generate slug
productSchema.pre('save', function (next) {
  if (this.nursery) {
    this.sellerId = this.nursery;
    this.shopId = this.nursery;
  }
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') + '-' + Date.now();
  }
  if (this.mrp && this.mrp > this.price) {
    this.discountPercent = Math.round(((this.mrp - this.price) / this.mrp) * 100);
  } else if (!this.mrp || this.mrp <= this.price) {
    this.discountPercent = 0;
  }

  if (this.approvalStatus === 'rejected') {
    this.listingStatus = 'rejected';
    this.isActive = false;
  } else if (this.listingStatus === 'draft') {
    this.isActive = false;
    if (this.approvalStatus === 'approved') this.approvalStatus = 'pending';
  } else if (this.approvalStatus === 'approved') {
    if (this.isActive === false) {
      this.listingStatus = 'draft';
    } else {
      this.listingStatus = this.stock > 0 ? 'published' : 'out_of_stock';
      this.isActive = true;
    }
  } else {
    this.listingStatus = 'pending';
    this.isActive = false;
  }

  if (this.listingSource === 'community' && (this.paused || this.moderationStatus === 'flagged' || this.moderationStatus === 'removed')) {
    this.isActive = false;
    if (this.moderationStatus === 'removed') this.listingStatus = 'rejected';
    else if (this.moderationStatus === 'flagged') this.listingStatus = 'pending';
    else this.listingStatus = 'draft';
  }
  next();
});

// Virtual for effective price (considering variants)
productSchema.virtual('effectivePrice').get(function () {
  return this.price;
});

// Indexes
productSchema.index({ slug: 1 });
productSchema.index({ category: 1 });
productSchema.index({ nursery: 1, isActive: 1 });
productSchema.index({ listingSource: 1, communitySeller: 1, isActive: 1 });
productSchema.index({ moderationStatus: 1, listingSource: 1 });
productSchema.index({ sellerId: 1, listingStatus: 1 });
productSchema.index({ approvalStatus: 1 });
productSchema.index({ listingStatus: 1 });
productSchema.index({ isActive: 1, isFeatured: 1 });
productSchema.index({ beginnerFriendly: 1, isActive: 1, stock: 1 });
productSchema.index({ seasonalTags: 1, isActive: 1, stock: 1 });
productSchema.index({ 'ratings.average': -1 });
productSchema.index({ price: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.model('Product', productSchema);
