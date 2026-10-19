const Review = require('../models/Review');
const Order = require('../models/Order');
const { asyncHandler, createError } = require('../utils/errorUtils');

// @desc    Get product reviews
// @route   GET /api/reviews/:productId
// @access  Public
const getProductReviews = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);
  const [reviews, total] = await Promise.all([
    Review.find({ product: req.params.productId, isApproved: true })
      .populate('user', 'name avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Review.countDocuments({ product: req.params.productId, isApproved: true }),
  ]);
  res.json({ success: true, reviews, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) } });
});

// @desc    Add review
// @route   POST /api/reviews/:productId
// @access  Private
const addReview = asyncHandler(async (req, res, next) => {
  const { rating, title, comment } = req.body;
  const productId = req.params.productId;

  const existing = await Review.findOne({ product: productId, user: req.user._id });
  if (existing) return next(createError(409, 'You have already reviewed this product.'));

  // Check verified purchase
  const order = await Order.findOne({
    user: req.user._id,
    'items.product': productId,
    paymentStatus: 'paid',
  });

  const review = await Review.create({
    product: productId,
    user: req.user._id,
    order: order?._id,
    rating,
    title,
    comment,
    isVerifiedPurchase: !!order,
  });

  const populated = await review.populate('user', 'name avatar');
  res.status(201).json({ success: true, review: populated });
});

// @desc    Delete review (admin or owner)
// @route   DELETE /api/reviews/:id
// @access  Private
const deleteReview = asyncHandler(async (req, res, next) => {
  const review = await Review.findById(req.params.id);
  if (!review) return next(createError(404, 'Review not found.'));
  if (review.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return next(createError(403, 'Not authorized.'));
  }
  await review.deleteOne();
  res.json({ success: true, message: 'Review deleted.' });
});

const getRecentReviews = asyncHandler(async (req, res) => {
  const reviews = await Review.find({ isApproved: true })
    .populate('user', 'name')
    .populate('product', 'name slug')
    .sort({ createdAt: -1 })
    .limit(6);
  res.json({ success: true, reviews });
});

module.exports = { getProductReviews, addReview, deleteReview, getRecentReviews };
