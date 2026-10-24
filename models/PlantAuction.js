const mongoose = require('mongoose');

const plantAuctionSchema = new mongoose.Schema({
  donor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  donorName: { type: String, trim: true, maxlength: 80, default: '' },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, maxlength: 2000 },
  images: [{ url: { type: String, required: true }, publicId: String }],
  startingBid: { type: Number, required: true, min: 1 },
  minIncrement: { type: Number, required: true, min: 1 },
  endsAt: { type: Date, required: true, index: true },
  status: {
    type: String,
    enum: ['live', 'awaiting_payment', 'paid', 'unsold', 'cancelled', 'refunded'],
    default: 'live',
    index: true,
  },
  highestBid: { type: Number, default: 0, min: 0 },
  highestBidder: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  bidCount: { type: Number, default: 0, min: 0 },
  winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  winningAmount: { type: Number, default: 0, min: 0 },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'pending', 'paid', 'failed', 'refunded'],
    default: 'unpaid',
  },
  razorpayOrderId: { type: String, default: '' },
  razorpayPaymentId: { type: String, default: '' },
}, { timestamps: true });

plantAuctionSchema.index({ status: 1, endsAt: 1 });

module.exports = mongoose.model('PlantAuction', plantAuctionSchema);
