const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  // Snapshot at time of order (never changes even if product is updated)
  name: { type: String, required: true },
  price: { type: Number, required: true },
  mrp: Number,
  image: String,
  quantity: { type: Number, required: true, min: 1 },
  sku: String,
  variantId: mongoose.Schema.Types.ObjectId,
  variantName: String,
  category: String,
  nursery: { type: mongoose.Schema.Types.ObjectId, ref: 'Nursery' },
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Nursery' },
  nurseryName: String,
}, { _id: true });

const shippingAddressSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  line1: { type: String, required: true },
  line2: String,
  city: { type: String, required: true },
  state: { type: String, required: true },
  postalCode: { type: String, required: true },
  country: { type: String, default: 'India' },
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [orderItemSchema],
  shippingAddress: { type: shippingAddressSchema, required: true },
  pricing: {
    subtotal: { type: Number, required: true },
    shippingCharge: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    taxPercent: { type: Number, default: 0 },
    couponDiscount: { type: Number, default: 0 },
    couponCode: String,
    totalAmount: { type: Number, required: true }, // Final amount charged
  },
  paymentMethod: {
    type: String,
    enum: ['razorpay', 'cod'],
    default: 'razorpay',
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
    default: 'pending',
  },
  orderStatus: {
    type: String,
    enum: ['pending_payment', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned'],
    default: 'pending_payment',
  },
  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String,
  refunds: [{
    refundId: String, // Razorpay refund ID
    amount: Number,
    reason: String,
    status: { type: String, enum: ['initiated', 'processed', 'failed'] },
    initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
  }],
  notes: String,
  trackingNumber: String,
  trackingUrl: String,
  estimatedDelivery: Date,
  deliveredAt: Date,
  cancelledAt: Date,
  cancellationReason: String,
  isGift: { type: Boolean, default: false },
  giftMessage: String,
  needsCartonBox: Boolean,
  essentialPackaging: { type: Boolean, default: true },
  packagingNote: String,
  sellerGroups: [{
    nursery: { type: mongoose.Schema.Types.ObjectId, ref: 'Nursery' },
    nurseryName: String,
    subtotal: Number,
    itemCount: Number,
    commissionPercent: Number,
    commissionAmount: Number,
    sellerAmount: Number,
    fulfillmentStatus: {
      type: String,
      enum: ['pending', 'processing', 'dispatched', 'delivered', 'cancelled'],
      default: 'pending',
    },
    settlementStatus: {
      type: String,
      enum: ['unsettled', 'recorded', 'paid', 'reversed'],
      default: 'unsettled',
    },
    trackingNumber: String,
  }],
  inventoryIssue: { type: Boolean, default: false },
}, { timestamps: true });

// Auto-generate order number
orderSchema.pre('save', async function (next) {
  if (!this.orderNumber) {
    const count = await mongoose.model('Order').countDocuments();
    this.orderNumber = `GRN-${Date.now().toString(36).toUpperCase()}-${(count + 1).toString().padStart(4, '0')}`;
  }
  next();
});

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ razorpayOrderId: 1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ 'sellerGroups.nursery': 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
