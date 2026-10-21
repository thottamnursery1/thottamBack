const mongoose = require('mongoose');

const plantExchangeProposalSchema = new mongoose.Schema({
  requestedListing: { type: mongoose.Schema.Types.ObjectId, ref: 'PlantCommunityListing', required: true, index: true },
  offeredListing: { type: mongoose.Schema.Types.ObjectId, ref: 'PlantCommunityListing', required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  proposer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  message: { type: String, maxlength: 500, default: '' },
  counterNote: { type: String, maxlength: 500, default: '' },
  status: {
    type: String,
    enum: ['Pending', 'CounterProposed', 'Accepted', 'Rejected', 'Withdrawn', 'Expired', 'AwaitingHandover', 'Completed', 'Disputed'],
    default: 'Pending',
    index: true,
  },
  decisionReason: { type: String, maxlength: 400, default: '' },
  ownerConfirmed: { type: Boolean, default: false },
  counterpartConfirmed: { type: Boolean, default: false },
  expiresAt: Date,
  completedAt: Date,
}, { timestamps: true });

plantExchangeProposalSchema.index(
  { requestedListing: 1, offeredListing: 1, proposer: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['Pending', 'CounterProposed', 'Accepted', 'AwaitingHandover', 'Disputed'] } } },
);

module.exports = mongoose.model('PlantExchangeProposal', plantExchangeProposalSchema);
