const mongoose = require('mongoose');

const plantBidSchema = new mongoose.Schema({
  auction: { type: mongoose.Schema.Types.ObjectId, ref: 'PlantAuction', required: true, index: true },
  bidder: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  bidderName: { type: String, trim: true, maxlength: 80, default: '' },
  amount: { type: Number, required: true, min: 1 },
  status: {
    type: String,
    enum: ['active', 'outbid', 'won', 'lost'],
    default: 'active',
  },
}, { timestamps: true });

plantBidSchema.index({ auction: 1, createdAt: -1 });

module.exports = mongoose.model('PlantBid', plantBidSchema);
