const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, required: true, maxlength: 60 },
  title: { type: String, required: true, maxlength: 140 },
  body: { type: String, maxlength: 400, default: '' },
  link: { type: String, maxlength: 200, default: '' },
  dedupeKey: { type: String, required: true, unique: true },
  read: { type: Boolean, default: false },
}, { timestamps: true });

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
