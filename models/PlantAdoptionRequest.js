const mongoose = require('mongoose');

const plantAdoptionRequestSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'PlantCommunityListing', required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  message: { type: String, maxlength: 500, default: '' },
  status: {
    type: String,
    enum: ['Pending', 'Accepted', 'Rejected', 'Withdrawn', 'Expired', 'AwaitingHandover', 'Completed', 'Disputed'],
    default: 'Pending',
    index: true,
  },
  decisionReason: { type: String, maxlength: 400, default: '' },
  ownerConfirmed: { type: Boolean, default: false },
  counterpartConfirmed: { type: Boolean, default: false },
  expiresAt: Date,
  completedAt: Date,
}, { timestamps: true });

plantAdoptionRequestSchema.index(
  { listing: 1, requester: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['Pending', 'Accepted', 'AwaitingHandover', 'Disputed'] } } },
);

module.exports = mongoose.model('PlantAdoptionRequest', plantAdoptionRequestSchema);
