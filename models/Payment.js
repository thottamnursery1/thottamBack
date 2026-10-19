const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  razorpayOrderId: { type: String, required: true, unique: true },
  razorpayPaymentId: String,
  razorpaySignature: String,
  amount: { type: Number, required: true }, // in paise (INR * 100)
  currency: { type: String, default: 'INR' },
  status: {
    type: String,
    enum: ['created', 'authorized', 'captured', 'refunded', 'failed'],
    default: 'created',
  },
  method: String, // upi, card, netbanking, wallet
  bank: String,
  wallet: String,
  vpa: String, // UPI VPA
  email: String,
  contact: String,
  // Webhook tracking
  webhookEvents: [{
    event: String,
    receivedAt: Date,
    processed: Boolean,
  }],
  errorCode: String,
  errorDescription: String,
  notes: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

paymentSchema.index({ razorpayOrderId: 1 });
paymentSchema.index({ razorpayPaymentId: 1 });
paymentSchema.index({ order: 1 });
paymentSchema.index({ user: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
