const mongoose = require('mongoose');

const sellerSettlementSchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  communitySeller: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunitySeller', required: true },
  orderNumber: String,
  idempotencyKey: { type: String, required: true, unique: true },
  productSubtotal: { type: Number, required: true, min: 0 },
  deliveryAllocation: { type: Number, default: 0, min: 0 },
  commissionPercent: { type: Number, default: 0, min: 0 },
  commissionAmount: { type: Number, required: true, min: 0 },
  sellerProductProceeds: { type: Number, required: true, min: 0 },
  sellerPayable: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'INR' },
  status: {
    type: String,
    enum: ['accrued', 'eligible', 'payout_initiated', 'paid', 'failed', 'reversed'],
    default: 'accrued',
  },
  provider: { type: String, default: 'manual_ledger' },
  payoutReference: { type: String, default: '' },
  note: {
    type: String,
    default: 'Customer payment was captured by Thottam. This ledger records the seller payable. It is not a Razorpay Route transfer.',
  },
  exception: { type: String, default: '' },
  eligibleAt: Date,
  initiatedAt: Date,
  paidAt: Date,
  initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

sellerSettlementSchema.index({ communitySeller: 1, status: 1 });
sellerSettlementSchema.index({ order: 1, communitySeller: 1 }, { unique: true });
sellerSettlementSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('SellerSettlement', sellerSettlementSchema);
