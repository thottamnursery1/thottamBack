const mongoose = require('mongoose');

const enquirySchema = new mongoose.Schema({
  nursery: { type: mongoose.Schema.Types.ObjectId, ref: 'Nursery', required: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, trim: true, default: '' },
  message: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: ['open', 'replied', 'closed'], default: 'open' },
  reply: { type: String, maxlength: 1000, default: '' },
  repliedAt: Date,
}, { timestamps: true });

enquirySchema.index({ nursery: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Enquiry', enquirySchema);
