const mongoose = require('mongoose');

const auctionPaymentSchema = new mongoose.Schema({
  auction: { type: mongoose.Schema.Types.ObjectId, ref: 'PlantAuction', required: true, index: true },
  payer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  donor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  razorpayOrderId: { type: String, required: true, unique: true },
  razorpayPaymentId: { type: String, default: '' },
  razorpaySignature: { type: String, default: '' },
  amountPaise: { type: Number, required: true, min: 100 },
  donorSharePaise: { type: Number, required: true, min: 0 },
  platformSharePaise: { type: Number, required: true, min: 0 },
  donorAccountId: { type: String, default: '' },
  routeAttached: { type: Boolean, default: false },
  transferId: { type: String, default: '' },
  transferStatus: {
    type: String,
    enum: ['not_configured', 'route_attached', 'processed', 'failed', 'reversed'],
    default: 'not_configured',
  },
  transferError: { type: String, default: '' },
  status: {
    type: String,
    enum: ['created', 'processing', 'paid', 'failed', 'superseded', 'refunded'],
    default: 'created',
    index: true,
  },
  refundId: { type: String, default: '' },
  failureReason: { type: String, default: '' },
  paidAt: Date,
  refundedAt: Date,
}, { timestamps: true });

auctionPaymentSchema.index(
  { auction: 1 },
  { unique: true, partialFilterExpression: { status: 'paid' } }
);
auctionPaymentSchema.index({ razorpayPaymentId: 1 }, { sparse: true });

module.exports = mongoose.model('AuctionPayment', auctionPaymentSchema);
