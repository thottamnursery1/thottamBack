const mongoose = require('mongoose');

const inventoryLogSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  variantId: mongoose.Schema.Types.ObjectId,
  changeType: {
    type: String,
    enum: ['restock', 'sale', 'adjustment', 'return', 'damage', 'initial', 'reservation', 'release'],
    required: true,
  },
  quantityChange: { type: Number, required: true }, // positive = added, negative = removed
  stockBefore: { type: Number, required: true },
  stockAfter: { type: Number, required: true },
  reference: String, // order number or reason
  referenceId: mongoose.Schema.Types.ObjectId,
  notes: String,
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

inventoryLogSchema.index({ product: 1, createdAt: -1 });
inventoryLogSchema.index({ changeType: 1 });

module.exports = mongoose.model('InventoryLog', inventoryLogSchema);
