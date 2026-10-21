const Product = require('../models/Product');
const { stockListingPatch } = require('./listingStatus');
const InventoryLog = require('../models/InventoryLog');
const Settlement = require('../models/Settlement');
const SellerSettlement = require('../models/SellerSettlement');
const { settlementKey } = require('./communityCommerce');
const logger = require('../utils/logger');

async function decrementItemStock(item, order, performedBy, mode = 'sale') {
  if (item.variantId) {
    const product = await Product.findOneAndUpdate(
      { _id: item.product, 'variants._id': item.variantId, 'variants.stock': { $gte: item.quantity } },
      { $inc: mode === 'sale' ? { 'variants.$.stock': -item.quantity, soldCount: item.quantity } : { 'variants.$.stock': -item.quantity } },
      { new: true }
    );
    if (!product) return false;
    const variant = product.variants.id(item.variantId);
    await InventoryLog.create({
      product: item.product,
      variantId: item.variantId,
      changeType: mode === 'sale' ? 'sale' : 'reservation',
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
    { $inc: mode === 'sale' ? { stock: -item.quantity, soldCount: item.quantity } : { stock: -item.quantity } },
    { new: true }
  );
  if (!product) return false;
  await InventoryLog.create({
    product: item.product,
    changeType: mode === 'sale' ? 'sale' : 'reservation',
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

async function restoreItemStock(item, { adjustSoldCount = true } = {}) {
  const sold = adjustSoldCount ? { soldCount: -item.quantity } : {};
  if (item.variantId) {
    await Product.updateOne(
      { _id: item.product, 'variants._id': item.variantId },
      { $inc: { 'variants.$.stock': item.quantity, ...sold } }
    );
    return;
  }
  await Product.updateOne(
    { _id: item.product },
    { $inc: { stock: item.quantity, ...sold } }
  );
  await syncStockListing(item.product);
}

async function countSale(item) {
  await Product.updateOne({ _id: item.product }, { $inc: { soldCount: item.quantity } });
}

async function reserveOrderInventory(order, performedBy) {
  if (order.inventoryReserved || order.inventoryCommitted) return true;
  const reserved = [];
  for (const item of order.items) {
    const ok = await decrementItemStock(item, order, performedBy, 'reserve');
    if (!ok) {
      for (const done of reserved) await restoreItemStock(done, { adjustSoldCount: false });
      order.inventoryIssue = true;
      await order.save();
      return false;
    }
    reserved.push(item);
  }
  order.inventoryReserved = true;
  await order.save();
  return true;
}

async function releaseReservedInventory(order) {
  if (!order?.inventoryReserved || order.inventoryCommitted) return;
  for (const item of order.items) await restoreItemStock(item, { adjustSoldCount: false });
  order.inventoryReserved = false;
  await order.save();
}

async function commitPaidInventory(order, performedBy) {
  if (order.inventoryCommitted) return true;
  if (order.inventoryReserved) {
    for (const item of order.items) await countSale(item);
    order.inventoryCommitted = true;
    await order.save();
    return true;
  }
  const committed = [];
  for (const item of order.items) {
    const ok = await decrementItemStock(item, order, performedBy, 'sale');
    if (!ok) {
      for (const done of committed) await restoreItemStock(done);
      order.inventoryIssue = true;
      await order.save();
      logger.error(`Inventory could not be reserved for order ${order.orderNumber}`);
      return false;
    }
    committed.push(item);
  }
  order.inventoryCommitted = true;
  await order.save();
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
  for (const group of groups) {
    if (group.sellerKind !== 'community' || !group.communitySeller) continue;
    const payable = Math.max(0, Number(group.sellerAmount) || 0);
    try {
      await SellerSettlement.updateOne(
        { order: order._id, communitySeller: group.communitySeller },
        {
          $setOnInsert: {
            order: order._id,
            communitySeller: group.communitySeller,
            orderNumber: order.orderNumber,
            idempotencyKey: settlementKey(order._id, group.communitySeller),
            productSubtotal: group.subtotal,
            deliveryAllocation: group.deliveryAllocation || 0,
            commissionPercent: group.commissionPercent || 0,
            commissionAmount: group.commissionAmount || 0,
            sellerProductProceeds: group.sellerProductProceeds ?? (group.subtotal - (group.commissionAmount || 0)),
            sellerPayable: payable,
            status: 'accrued',
            provider: 'manual_ledger',
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

module.exports = {
  commitPaidInventory,
  recordSettlements,
  restoreItemStock,
  reserveOrderInventory,
  releaseReservedInventory,
};
