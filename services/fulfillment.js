const Product = require('../models/Product');
const { stockListingPatch } = require('./listingStatus');
const InventoryLog = require('../models/InventoryLog');
const Settlement = require('../models/Settlement');
const logger = require('../utils/logger');

async function decrementItemStock(item, order, performedBy) {
  if (item.variantId) {
    const product = await Product.findOneAndUpdate(
      { _id: item.product, 'variants._id': item.variantId, 'variants.stock': { $gte: item.quantity } },
      { $inc: { 'variants.$.stock': -item.quantity, soldCount: item.quantity } },
      { new: true }
    );
    if (!product) return false;
    const variant = product.variants.id(item.variantId);
    await InventoryLog.create({
      product: item.product,
      variantId: item.variantId,
      changeType: 'sale',
      quantityChange: -item.quantity,
      stockBefore: (variant?.stock || 0) + item.quantity,
      stockAfter: variant?.stock || 0,
      reference: order.orderNumber,
      referenceId: order._id,
      performedBy,
    });
    await syncStockListing(product._id);
    return true;
  }

  const product = await Product.findOneAndUpdate(
    { _id: item.product, stock: { $gte: item.quantity } },
    { $inc: { stock: -item.quantity, soldCount: item.quantity } },
    { new: true }
  );
  if (!product) return false;
  await InventoryLog.create({
    product: item.product,
    changeType: 'sale',
    quantityChange: -item.quantity,
    stockBefore: product.stock + item.quantity,
    stockAfter: product.stock,
    reference: order.orderNumber,
    referenceId: order._id,
    performedBy,
  });
  await syncStockListing(product._id);
  return true;
}

async function syncStockListing(productId) {
  const current = await Product.findById(productId).select('stock listingStatus approvalStatus isActive');
  const patch = stockListingPatch(current);
  if (patch) await Product.updateOne({ _id: productId }, patch);
}

async function restoreItemStock(item) {
  if (item.variantId) {
    await Product.updateOne(
      { _id: item.product, 'variants._id': item.variantId },
      { $inc: { 'variants.$.stock': item.quantity, soldCount: -item.quantity } }
    );
    return;
  }
  await Product.updateOne(
    { _id: item.product },
    { $inc: { stock: item.quantity, soldCount: -item.quantity } }
  );
  await syncStockListing(item.product);
}

async function commitPaidInventory(order, performedBy) {
  const committed = [];
  for (const item of order.items) {
    const ok = await decrementItemStock(item, order, performedBy);
    if (!ok) {
      for (const done of committed) await restoreItemStock(done);
      order.inventoryIssue = true;
      await order.save();
      logger.error(`Inventory could not be reserved for order ${order.orderNumber}`);
      return false;
    }
    committed.push(item);
  }
  return true;
}

async function recordSettlements(order) {
  const groups = order.sellerGroups || [];
  for (const group of groups) {
    if (!group.nursery) continue;
    try {
      await Settlement.updateOne(
        { order: order._id, nursery: group.nursery },
        {
          $setOnInsert: {
            order: order._id,
            nursery: group.nursery,
            orderNumber: order.orderNumber,
            grossAmount: group.subtotal,
            commissionAmount: group.commissionAmount,
            sellerAmount: group.sellerAmount,
            status: 'recorded',
            method: 'manual',
            note: 'Manual settlement record. No automatic Razorpay transfer was made.',
          },
        },
        { upsert: true }
      );
      group.settlementStatus = 'recorded';
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  await order.save();
}

module.exports = { commitPaidInventory, recordSettlements, restoreItemStock };
