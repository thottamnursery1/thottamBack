const mongoose = require('mongoose');

const settlementSchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  nursery: { type: mongoose.Schema.Types.ObjectId, ref: 'Nursery', required: true },
  orderNumber: String,
  grossAmount: { type: Number, required: true },
  commissionAmount: { type: Number, required: true },
  sellerAmount: { type: Number, required: true },
  status: { type: String, enum: ['recorded', 'paid', 'reversed'], default: 'recorded' },
  method: { type: String, default: 'manual' },
  note: { type: String, default: 'Manual settlement record. No automatic Razorpay transfer was made.' },
  paidAt: Date,
}, { timestamps: true });

settlementSchema.index({ order: 1, nursery: 1 }, { unique: true });
settlementSchema.index({ nursery: 1, status: 1 });

module.exports = mongoose.model('Settlement', settlementSchema);
