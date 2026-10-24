const Razorpay = require('razorpay');
const PlantAuction = require('../models/PlantAuction');
const AuctionPayment = require('../models/AuctionPayment');
const Notification = require('../models/Notification');
const { createError } = require('../utils/errorUtils');
const logger = require('../utils/logger');
const { verifyPaymentSignature } = require('./commerce');
const { splitWinningBid } = require('./auctionMoney');

function getRazorpay() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || String(process.env.RAZORPAY_KEY_ID).includes('xxxx')) {
    throw createError(503, 'Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the backend environment.');
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

function linkedAccountId(user) {
  const value = String(user?.razorpayAccountId || '').trim();
  return /^acc_[A-Za-z0-9]+$/.test(value) ? value : '';
}

async function notifyOnce(userId, dedupeKey, title, body, link) {
  if (!userId) return;
  await Notification.updateOne(
    { dedupeKey },
    { $setOnInsert: { user: userId, type: 'plant.auction', title, body, link, dedupeKey, read: false } },
    { upsert: true }
  );
}

async function closeDueAuctions(filter = {}) {
  const now = new Date();
  const due = await PlantAuction.find({ ...filter, status: 'live', endsAt: { $lte: now } });
  for (const auction of due) {
    if (auction.bidCount > 0 && auction.highestBidder) {
      auction.status = 'awaiting_payment';
      auction.paymentStatus = 'unpaid';
      auction.winner = auction.highestBidder;
      auction.winningAmount = auction.highestBid;
      await auction.save();
      await notifyOnce(
        auction.winner,
        `auction.won:${auction._id}`,
        'You won a plant auction',
        `Your bid of ₹${auction.winningAmount} for ${auction.name} is the highest. Complete payment to finish.`,
        `/auctions/${auction._id}/pay`
      );
      await notifyOnce(
        auction.donor,
        `auction.ended:${auction._id}`,
        'Your auction has a winner',
        `${auction.name} ended at ₹${auction.winningAmount}. Payment is waiting on the winner.`,
        `/account/auctions`
      );
    } else {
      auction.status = 'unsold';
      await auction.save();
    }
  }
}

function quoteFor(auction, donor) {
  const split = splitWinningBid(auction.winningAmount || auction.highestBid);
  if (!split) return null;
  const accountId = linkedAccountId(donor);
  return {
    ...split,
    routeReady: Boolean(accountId),
    routeNote: accountId
      ? 'After a successful payment, Razorpay Route transfers 80% to the donor. Thottam keeps 20%.'
      : 'The donor has no linked Razorpay Route account. The full payment is captured by Thottam and the 80% donor share is recorded for settlement.',
  };
}

async function createWinnerOrder(auction, winner, donor) {
  if (String(auction.winner) !== String(winner._id)) {
    throw createError(403, 'Only the highest bidder can pay for this auction.');
  }
  if (auction.status !== 'awaiting_payment') {
    throw createError(400, 'This auction is not waiting for payment.');
  }
  if (auction.paymentStatus === 'paid') {
    throw createError(409, 'This auction has already been paid.');
  }
  const existingPaid = await AuctionPayment.findOne({ auction: auction._id, status: 'paid' });
  if (existingPaid) throw createError(409, 'This auction has already been paid.');

  const split = splitWinningBid(auction.winningAmount);
  if (!split) throw createError(400, 'The winning bid cannot be charged.');
  const accountId = linkedAccountId(donor);

  await AuctionPayment.updateMany(
    { auction: auction._id, status: { $in: ['created', 'failed'] } },
    { status: 'superseded' }
  );

  const razorpay = getRazorpay();
  const payload = {
    amount: split.totalPaise,
    currency: 'INR',
    receipt: `auc_${auction._id.toString().slice(-10)}_${Date.now().toString().slice(-6)}`,
    notes: {
      kind: 'plant_auction',
      auctionId: String(auction._id),
      donorId: String(auction.donor),
      winnerId: String(winner._id),
    },
  };
  let routeAttached = false;
  if (accountId) {
    payload.transfers = [{
      account: accountId,
      amount: split.donorSharePaise,
      currency: 'INR',
      notes: { auctionId: String(auction._id), share: 'donor' },
    }];
  }

  let order;
  try {
    order = await razorpay.orders.create(payload);
    routeAttached = Boolean(accountId);
  } catch (err) {
    if (!accountId) throw createError(502, 'Razorpay could not open this payment.');
    logger.warn(`Auction Route transfer was rejected, charging without it: ${err.message}`);
    delete payload.transfers;
    order = await razorpay.orders.create(payload);
    routeAttached = false;
  }

  const record = await AuctionPayment.create({
    auction: auction._id,
    payer: winner._id,
    donor: auction.donor,
    razorpayOrderId: order.id,
    amountPaise: split.totalPaise,
    donorSharePaise: split.donorSharePaise,
    platformSharePaise: split.platformSharePaise,
    donorAccountId: routeAttached ? accountId : '',
    routeAttached,
    transferStatus: routeAttached ? 'route_attached' : 'not_configured',
    status: 'created',
  });

  auction.paymentStatus = 'pending';
  auction.razorpayOrderId = order.id;
  await auction.save();

  return { order, record, split, routeAttached };
}

async function settleAuctionPayment(payment) {
  const orderId = payment.order_id;
  if (!orderId) return null;
  const record = await AuctionPayment.findOne({ razorpayOrderId: orderId });
  if (!record) return null;
  if (record.status === 'paid' || record.status === 'refunded') return record;
  if (Number(payment.amount) !== record.amountPaise) {
    record.status = 'failed';
    record.failureReason = 'Paid amount did not match the winning bid.';
    await record.save();
    await PlantAuction.updateOne({ _id: record.auction }, { paymentStatus: 'failed' });
    return record;
  }

  const claimed = await AuctionPayment.findOneAndUpdate(
    { _id: record._id, status: { $in: ['created', 'failed', 'processing'] } },
    { $set: { status: 'processing', razorpayPaymentId: payment.id } },
    { new: true }
  );
  if (!claimed) return AuctionPayment.findOne({ razorpayOrderId: orderId });

  let transferStatus = claimed.routeAttached ? 'route_attached' : claimed.transferStatus;
  let transferId = claimed.transferId || '';
  let transferError = '';
  if (!claimed.routeAttached && claimed.donorAccountId) {
    try {
      const transfer = await getRazorpay().payments.transfer(payment.id, {
        transfers: [{
          account: claimed.donorAccountId,
          amount: claimed.donorSharePaise,
          currency: 'INR',
          notes: { auctionId: String(claimed.auction), share: 'donor' },
        }],
      });
      transferId = transfer?.items?.[0]?.id || '';
      transferStatus = 'processed';
    } catch (err) {
      transferStatus = 'failed';
      transferError = err.error?.description || err.message || 'Transfer failed';
      logger.warn(`Auction donor transfer failed: ${transferError}`);
    }
  }

  claimed.status = 'paid';
  claimed.transferStatus = transferStatus;
  claimed.transferId = transferId;
  claimed.transferError = transferError;
  claimed.paidAt = new Date();
  claimed.razorpayPaymentId = payment.id;
  await claimed.save();

  const auction = await PlantAuction.findOneAndUpdate(
    { _id: claimed.auction, paymentStatus: { $ne: 'paid' } },
    { status: 'paid', paymentStatus: 'paid', razorpayPaymentId: payment.id },
    { new: true }
  );
  if (auction) {
    await notifyOnce(claimed.donor, `auction.paid.donor:${claimed._id}`, 'Auction payment received', `${auction.name} was paid. Your 80% share is ₹${claimed.donorSharePaise / 100}.`, '/account/auctions');
    await notifyOnce(claimed.payer, `auction.paid.winner:${claimed._id}`, 'Auction payment successful', `Payment for ${auction.name} is complete.`, `/auctions/${auction._id}`);
  }
  return claimed;
}

async function verifyWinnerPayment({ orderId, paymentId, signature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const valid = verifyPaymentSignature({ orderId, paymentId, signature, secret });
  if (!valid) throw createError(400, 'Payment could not be verified.');
  const razorpay = getRazorpay();
  const payment = await razorpay.payments.fetch(paymentId);
  if (payment.order_id !== orderId) throw createError(400, 'Payment does not match this order.');
  if (!['captured', 'authorized'].includes(payment.status)) throw createError(400, 'Payment is not complete.');
  const record = await AuctionPayment.findOne({ razorpayOrderId: orderId });
  if (!record) throw createError(404, 'Auction payment was not found.');
  record.razorpaySignature = signature;
  await record.save();
  return settleAuctionPayment(payment);
}

async function failAuctionPayment(payment) {
  const record = await AuctionPayment.findOne({ razorpayOrderId: payment.order_id, status: { $in: ['created', 'processing'] } });
  if (!record) return null;
  record.status = 'failed';
  record.failureReason = payment.error_description || 'Payment failed';
  record.razorpayPaymentId = payment.id || record.razorpayPaymentId;
  await record.save();
  await PlantAuction.updateOne({ _id: record.auction, paymentStatus: { $ne: 'paid' } }, { paymentStatus: 'failed' });
  return record;
}

async function refundAuctionPayment(record, reason) {
  if (!record || record.status === 'refunded') return record;
  if (record.status !== 'paid' || !record.razorpayPaymentId) {
    throw createError(400, 'Only a successful auction payment can be refunded.');
  }
  const existing = await AuctionPayment.findOne({ _id: record._id, status: 'paid' });
  if (!existing) return AuctionPayment.findById(record._id);
  const refund = await getRazorpay().payments.refund(existing.razorpayPaymentId, {
    amount: existing.amountPaise,
    notes: { auctionId: String(existing.auction), reason: String(reason || 'Auction refund').slice(0, 180) },
  });
  const updated = await AuctionPayment.findOneAndUpdate(
    { _id: existing._id, status: 'paid' },
    {
      status: 'refunded',
      refundId: refund.id,
      refundedAt: new Date(),
      transferStatus: existing.transferId || existing.routeAttached ? 'reversed' : existing.transferStatus,
    },
    { new: true }
  );
  await PlantAuction.updateOne({ _id: existing.auction }, { status: 'refunded', paymentStatus: 'refunded' });
  return updated || existing;
}

module.exports = {
  getRazorpay,
  linkedAccountId,
  notifyOnce,
  closeDueAuctions,
  quoteFor,
  createWinnerOrder,
  settleAuctionPayment,
  verifyWinnerPayment,
  failAuctionPayment,
  refundAuctionPayment,
};
