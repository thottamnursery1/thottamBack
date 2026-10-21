const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'user.login', 'user.logout', 'user.register', 'user.deactivate', 'user.activate',
      'user.role_change', 'user.shop_assign',
      'product.create', 'product.update', 'product.delete',
      'order.status_update', 'order.cancel',
      'payment.refund', 'coupon.create', 'coupon.update', 'coupon.delete',
      'admin.access', 'category.create', 'category.update', 'category.delete',
      'inventory.adjustment',
      'seller.register', 'seller.approve', 'seller.reject', 'seller.suspend', 'seller.reactivate',
      'seller.product.create', 'seller.product.delete',
      'settings.update',
      'payment.capture',
      'community.apply', 'community.approve', 'community.reject', 'community.suspend', 'community.reactivate',
      'community.listing.create', 'community.listing.update', 'community.listing.delete', 'community.listing.moderate',
      'community.payout.initiate', 'community.payout.confirm', 'community.payout.fail',
      'community.report',
      'plant.listing.create', 'plant.listing.update', 'plant.listing.remove', 'plant.listing.moderate',
      'plant.request', 'plant.exchange', 'plant.handover', 'plant.report',
      'plant.user.suspend', 'plant.user.reinstate',
    ],
  },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetId: mongoose.Schema.Types.ObjectId,
  targetModel: String,
  details: mongoose.Schema.Types.Mixed,
  ip: String,
  userAgent: String,
}, { timestamps: true });

auditLogSchema.index({ performedBy: 1, createdAt: -1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
