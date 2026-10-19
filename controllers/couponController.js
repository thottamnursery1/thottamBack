const Coupon = require('../models/Coupon');
const { asyncHandler, createError } = require('../utils/errorUtils');

// @desc    Get all coupons (admin)
// @route   GET /api/admin/coupons
// @access  Admin
const getCoupons = asyncHandler(async (req, res) => {
  const coupons = await Coupon.find().sort({ createdAt: -1 });
  res.json({ success: true, coupons });
});

// @desc    Create coupon (admin)
// @route   POST /api/admin/coupons
// @access  Admin
const createCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.create({ ...req.body, createdBy: req.user._id });
  res.status(201).json({ success: true, coupon });
});

// @desc    Update coupon (admin)
// @route   PUT /api/admin/coupons/:id
// @access  Admin
const updateCoupon = asyncHandler(async (req, res, next) => {
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!coupon) return next(createError(404, 'Coupon not found.'));
  res.json({ success: true, coupon });
});

// @desc    Delete coupon (admin)
// @route   DELETE /api/admin/coupons/:id
// @access  Admin
const deleteCoupon = asyncHandler(async (req, res, next) => {
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) return next(createError(404, 'Coupon not found.'));
  res.json({ success: true, message: 'Coupon deleted.' });
});

// @desc    Validate coupon (public check)
// @route   POST /api/coupons/validate
// @access  Private
const validateCoupon = asyncHandler(async (req, res, next) => {
  const { code, cartSubtotal } = req.body;
  const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true });
  if (!coupon) return next(createError(404, 'Invalid coupon code.'));
  const now = new Date();
  if (now < coupon.validFrom || now > coupon.validUntil) return next(createError(400, 'Coupon is not active.'));
  if (coupon.maxUsageCount !== null && coupon.usedCount >= coupon.maxUsageCount) return next(createError(400, 'Coupon usage limit reached.'));
  if (cartSubtotal < coupon.minOrderAmount) return next(createError(400, `Minimum order amount of ₹${coupon.minOrderAmount} required.`));
  res.json({ success: true, coupon: { code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue, maxDiscountAmount: coupon.maxDiscountAmount, description: coupon.description } });
});

module.exports = { getCoupons, createCoupon, updateCoupon, deleteCoupon, validateCoupon };
