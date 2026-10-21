const mongoose = require('mongoose');

const refundRecordSchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  communitySeller: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunitySeller' },
  nursery: { type: mongoose.Schema.Types.ObjectId, ref: 'Nursery' },
  razorpayRefundId: { type: String, unique: true, sparse: true },
  amount: { type: Number, required: true, min: 0 },
  reason: { type: String, maxlength: 400, default: '' },
  status: {
    type: String,
    enum: ['requested', 'initiated', 'processed', 'failed'],
    default: 'requested',
  },
  sellerReduction: { type: Number, default: 0, min: 0 },
  commissionReversal: { type: Number, default: 0, min: 0 },
  initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

refundRecordSchema.index({ order: 1, status: 1 });

module.exports = mongoose.model('RefundRecord', refundRecordSchema);
