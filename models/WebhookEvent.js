const mongoose = require('mongoose');

const webhookEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  event: String,
}, { timestamps: true });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
