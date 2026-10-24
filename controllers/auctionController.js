const PlantAuction = require('../models/PlantAuction');
const PlantBid = require('../models/PlantBid');
const AuctionPayment = require('../models/AuctionPayment');
const User = require('../models/User');
const { asyncHandler, createError } = require('../utils/errorUtils');
const { bidIsValid, minimumNextBid, splitWinningBid } = require('../services/auctionMoney');
const {
  closeDueAuctions,
  quoteFor,
  createWinnerOrder,
  verifyWinnerPayment,
  refundAuctionPayment,
  linkedAccountId,
  notifyOnce,
} = require('../services/auctionPayment');

function publicAuction(auction, extras = {}) {
  return {
    _id: auction._id,
    name: auction.name,
    description: auction.description,
    images: auction.images || [],
    donorName: auction.donorName,
    donorId: auction.donor?._id || auction.donor,
    startingBid: auction.startingBid,
    minIncrement: auction.minIncrement,
    endsAt: auction.endsAt,
    status: auction.status,
    highestBid: auction.highestBid,
    bidCount: auction.bidCount,
    winningAmount: auction.winningAmount,
    paymentStatus: auction.paymentStatus,
    nextBid: auction.status === 'live' ? minimumNextBid(auction) : null,
    ...extras,
  };
}

const listAuctions = asyncHandler(async (req, res) => {
  await closeDueAuctions();
  const status = ['live', 'awaiting_payment', 'paid'].includes(req.query.status) ? req.query.status : 'live';
  const auctions = await PlantAuction.find({ status }).sort({ endsAt: 1 }).limit(60);
  res.json({ success: true, auctions: auctions.map((auction) => publicAuction(auction)) });
});

const getAuction = asyncHandler(async (req, res, next) => {
  await closeDueAuctions({ _id: req.params.id });
  const auction = await PlantAuction.findById(req.params.id);
  if (!auction) return next(createError(404, 'Auction not found.'));
  const bids = await PlantBid.find({ auction: auction._id }).sort({ createdAt: -1 }).limit(20);
  const viewerId = req.user ? String(req.user._id) : '';
  res.json({
    success: true,
    auction: publicAuction(auction, {
      isDonor: viewerId && viewerId === String(auction.donor),
      isHighestBidder: viewerId && viewerId === String(auction.highestBidder || ''),
      canPay: viewerId && auction.status === 'awaiting_payment' && viewerId === String(auction.winner || ''),
    }),
    bids: bids.map((bid) => ({
      _id: bid._id,
      bidderName: bid.bidderName,
      amount: bid.amount,
      status: bid.status,
      createdAt: bid.createdAt,
      mine: viewerId && viewerId === String(bid.bidder),
    })),
  });
});

const createAuction = asyncHandler(async (req, res, next) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const startingBid = Number(req.body.startingBid);
  const minIncrement = Number(req.body.minIncrement);
  const endsAt = new Date(req.body.endsAt);
  const images = Array.isArray(req.body.images) ? req.body.images.filter((item) => item?.url).slice(0, 6) : [];
  if (!name || !description) return next(createError(400, 'Plant name and description are required.'));
  if (!Number.isFinite(startingBid) || startingBid < 1) return next(createError(400, 'Starting bid must be at least ₹1.'));
  if (!Number.isFinite(minIncrement) || minIncrement < 1) return next(createError(400, 'Minimum bid increment must be at least ₹1.'));
  if (Number.isNaN(endsAt.getTime())) return next(createError(400, 'Choose an auction end date and time.'));
  const hour = 60 * 60 * 1000;
  if (endsAt.getTime() < Date.now() + hour) return next(createError(400, 'The auction must end at least one hour from now.'));
  if (endsAt.getTime() > Date.now() + 30 * 24 * hour) return next(createError(400, 'The auction cannot run longer than 30 days.'));
  if (!images.length) return next(createError(400, 'Add at least one plant image.'));

  const accountId = String(req.body.razorpayAccountId || '').trim();
  if (accountId) {
    if (!/^acc_[A-Za-z0-9]+$/.test(accountId)) return next(createError(400, 'Razorpay Route account ids look like acc_ followed by letters and numbers.'));
    await User.updateOne({ _id: req.user._id }, { razorpayAccountId: accountId });
  }

  const auction = await PlantAuction.create({
    donor: req.user._id,
    donorName: req.user.name,
    name,
    description,
    images,
    startingBid,
    minIncrement,
    endsAt,
  });
  res.status(201).json({ success: true, auction: publicAuction(auction) });
});

const placeBid = asyncHandler(async (req, res, next) => {
  await closeDueAuctions({ _id: req.params.id });
  const amount = Number(req.body.amount);
  const auction = await PlantAuction.findById(req.params.id);
  if (!auction) return next(createError(404, 'Auction not found.'));
  if (String(auction.donor) === String(req.user._id)) return next(createError(403, 'You cannot bid on your own plant.'));
  const problem = bidIsValid(auction, amount);
  if (problem) return next(createError(400, problem));

  const previousBidder = auction.highestBidder;
  const previousAmount = auction.highestBid;
  const updated = await PlantAuction.findOneAndUpdate(
    {
      _id: auction._id,
      status: 'live',
      endsAt: { $gt: new Date() },
      highestBid: auction.highestBid,
      bidCount: auction.bidCount,
    },
    { $set: { highestBid: amount, highestBidder: req.user._id }, $inc: { bidCount: 1 } },
    { new: true }
  );
  if (!updated) return next(createError(409, 'Another bid landed first. Refresh and try the new amount.'));

  await PlantBid.updateMany({ auction: auction._id, status: 'active' }, { status: 'outbid' });
  await PlantBid.create({
    auction: auction._id,
    bidder: req.user._id,
    bidderName: req.user.name,
    amount,
    status: 'active',
  });

  if (previousBidder && String(previousBidder) !== String(req.user._id)) {
    await notifyOnce(
      previousBidder,
      `auction.outbid:${auction._id}:${previousBidder}:${amount}`,
      'You have been outbid',
      `${auction.name} now has a higher bid of ₹${amount}. Your bid was ₹${previousAmount}.`,
      `/auctions/${auction._id}`
    );
  }

  res.status(201).json({ success: true, auction: publicAuction(updated), nextBid: minimumNextBid(updated) });
});

const checkoutQuote = asyncHandler(async (req, res, next) => {
  await closeDueAuctions({ _id: req.params.id });
  const auction = await PlantAuction.findById(req.params.id);
  if (!auction) return next(createError(404, 'Auction not found.'));
  if (String(auction.winner) !== String(req.user._id)) return next(createError(403, 'Only the winning bidder can open checkout.'));
  if (auction.paymentStatus === 'paid') return next(createError(409, 'This auction has already been paid.'));
  const donor = await User.findById(auction.donor).select('name razorpayAccountId');
  const quote = quoteFor(auction, donor);
  if (!quote) return next(createError(400, 'This auction has no winning bid.'));
  res.json({
    success: true,
    auction: publicAuction(auction),
    quote,
    keyId: process.env.RAZORPAY_KEY_ID && !String(process.env.RAZORPAY_KEY_ID).includes('xxxx') ? process.env.RAZORPAY_KEY_ID : '',
  });
});

const payAuction = asyncHandler(async (req, res, next) => {
  await closeDueAuctions({ _id: req.params.id });
  const auction = await PlantAuction.findById(req.params.id);
  if (!auction) return next(createError(404, 'Auction not found.'));
  const donor = await User.findById(auction.donor).select('name razorpayAccountId');
  try {
    const { order, record, split, routeAttached } = await createWinnerOrder(auction, req.user, donor);
    res.json({
      success: true,
      keyId: process.env.RAZORPAY_KEY_ID,
      razorpayOrder: { id: order.id, amount: order.amount, currency: order.currency },
      paymentId: record._id,
      quote: { ...split, routeReady: routeAttached, routeNote: routeAttached
        ? 'Razorpay Route will transfer 80% to the donor when this payment succeeds.'
        : '80% is recorded as the donor settlement. Thottam keeps 20%.' },
    });
  } catch (err) {
    next(err);
  }
});

const verifyAuction = asyncHandler(async (req, res, next) => {
  const auction = await PlantAuction.findById(req.params.id);
  if (!auction) return next(createError(404, 'Auction not found.'));
  if (String(auction.winner) !== String(req.user._id) && String(auction.highestBidder) !== String(req.user._id)) {
    return next(createError(403, 'Only the winning bidder can confirm this payment.'));
  }
  try {
    const record = await verifyWinnerPayment({
      orderId: req.body.razorpay_order_id,
      paymentId: req.body.razorpay_payment_id,
      signature: req.body.razorpay_signature,
    });
    res.json({
      success: true,
      payment: {
        status: record.status,
        donorShare: record.donorSharePaise / 100,
        platformShare: record.platformSharePaise / 100,
        transferStatus: record.transferStatus,
      },
    });
  } catch (err) {
    next(err);
  }
});

const myAuctions = asyncHandler(async (req, res) => {
  await closeDueAuctions({ donor: req.user._id });
  const listed = await PlantAuction.find({ donor: req.user._id }).sort({ createdAt: -1 }).limit(50);
  const won = await PlantAuction.find({ winner: req.user._id }).sort({ updatedAt: -1 }).limit(50);
  const payments = await AuctionPayment.find({
    $or: [{ donor: req.user._id }, { payer: req.user._id }],
    status: { $in: ['paid', 'refunded', 'failed'] },
  }).sort({ createdAt: -1 }).limit(50).populate('auction', 'name');
  res.json({
    success: true,
    razorpayAccountId: linkedAccountId(req.user),
    listed: listed.map((auction) => publicAuction(auction)),
    won: won.map((auction) => publicAuction(auction)),
    payments: payments.map((payment) => ({
      _id: payment._id,
      auctionName: payment.auction?.name || 'Plant auction',
      role: String(payment.donor) === String(req.user._id) ? 'donor' : 'winner',
      amount: payment.amountPaise / 100,
      donorShare: payment.donorSharePaise / 100,
      platformShare: payment.platformSharePaise / 100,
      status: payment.status,
      transferStatus: payment.transferStatus,
      createdAt: payment.createdAt,
    })),
  });
});

const adminAuctions = asyncHandler(async (req, res) => {
  await closeDueAuctions();
  const payments = await AuctionPayment.find({ status: { $in: ['paid', 'refunded', 'failed', 'created'] } })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('auction', 'name status')
    .populate('donor', 'name email')
    .populate('payer', 'name email');
  const totals = payments.filter((payment) => payment.status === 'paid').reduce((sum, payment) => ({
    collected: sum.collected + payment.amountPaise,
    donor: sum.donor + payment.donorSharePaise,
    platform: sum.platform + payment.platformSharePaise,
  }), { collected: 0, donor: 0, platform: 0 });
  res.json({
    success: true,
    totals: {
      collected: totals.collected / 100,
      donor: totals.donor / 100,
      platform: totals.platform / 100,
    },
    payments: payments.map((payment) => ({
      _id: payment._id,
      auctionId: payment.auction?._id,
      auctionName: payment.auction?.name || 'Plant auction',
      donorName: payment.donor?.name || '',
      payerName: payment.payer?.name || '',
      amount: payment.amountPaise / 100,
      donorShare: payment.donorSharePaise / 100,
      platformShare: payment.platformSharePaise / 100,
      status: payment.status,
      transferStatus: payment.transferStatus,
      transferId: payment.transferId,
      refundId: payment.refundId,
      createdAt: payment.createdAt,
    })),
  });
});

const adminRefund = asyncHandler(async (req, res, next) => {
  const record = await AuctionPayment.findById(req.params.id);
  if (!record) return next(createError(404, 'Auction payment not found.'));
  const updated = await refundAuctionPayment(record, req.body.reason || 'Refunded by Thottam');
  const split = splitWinningBid(updated.amountPaise / 100);
  res.json({ success: true, payment: { status: updated.status, refundId: updated.refundId, ...split } });
});

module.exports = {
  listAuctions, getAuction, createAuction, placeBid, checkoutQuote, payAuction, verifyAuction, myAuctions, adminAuctions, adminRefund,
};
