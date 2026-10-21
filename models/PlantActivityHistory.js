const mongoose = require('mongoose');

const plantActivityHistorySchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'PlantCommunityListing', index: true },
  request: { type: mongoose.Schema.Types.ObjectId },
  requestModel: { type: String, enum: ['PlantAdoptionRequest', 'PlantExchangeProposal', ''], default: '' },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  event: { type: String, required: true, maxlength: 60 },
  fromStatus: { type: String, default: '' },
  toStatus: { type: String, default: '' },
  note: { type: String, maxlength: 500, default: '' },
  enquiryStatus: { type: String, enum: ['open', 'closed', ''], default: '' },
}, { timestamps: true });

plantActivityHistorySchema.index({ listing: 1, createdAt: -1 });
plantActivityHistorySchema.index({ actor: 1, event: 1, createdAt: -1 });

const plantReviewSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'PlantCommunityListing', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, maxlength: 500, default: '' },
}, { timestamps: true });

plantReviewSchema.index({ listing: 1, user: 1 }, { unique: true });

module.exports = {
  PlantActivityHistory: mongoose.model('PlantActivityHistory', plantActivityHistorySchema),
  PlantReview: mongoose.model('PlantReview', plantReviewSchema),
};
