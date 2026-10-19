const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  variantId: mongoose.Schema.Types.ObjectId,
  quantity: { type: Number, required: true, min: 1, default: 1 },
  // Snapshot at time of add
  name: String,
  price: Number,
  image: String,
  sku: String,
  variantName: String,
  nursery: { type: mongoose.Schema.Types.ObjectId, ref: 'Nursery' },
  nurseryName: String,
}, { _id: true });

const cartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },
  items: [cartItemSchema],
  couponCode: String,
  couponDiscount: { type: Number, default: 0 },
}, { timestamps: true });

// Virtual for subtotal
cartSchema.virtual('subtotal').get(function () {
  return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
});

cartSchema.index({ user: 1 });

module.exports = mongoose.model('Cart', cartSchema);
