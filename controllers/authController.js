const crypto = require('crypto');
const User = require('../models/User');
const { asyncHandler, createError } = require('../utils/errorUtils');
const { sendTokenResponse } = require('../utils/jwtUtils');
const sendEmail = require('../utils/sendEmail');
const logAudit = require('../utils/auditLog');
const { findUserByEmail } = require('../services/identity');
const {
  publicCustomerRegistration,
  accountIsActive,
  normalizeEmail,
  EMAIL_TAKEN_MESSAGE,
  INACTIVE_ACCOUNT_MESSAGE,
  isDuplicateEmailError,
} = require('../services/roles');

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
const register = asyncHandler(async (req, res, next) => {
  // Public registration always creates a customer. Privileged roles are ignored.
  const payload = publicCustomerRegistration(req.body);
  const existingUser = await findUserByEmail(payload.email);
  if (existingUser) {
    return next(createError(409, EMAIL_TAKEN_MESSAGE));
  }

  let user;
  try {
    user = await User.create(payload);
  } catch (err) {
    if (isDuplicateEmailError(err)) return next(createError(409, EMAIL_TAKEN_MESSAGE));
    throw err;
  }

  await logAudit({ action: 'user.register', performedBy: user._id, targetId: user._id, targetModel: 'User', req });

  sendTokenResponse(user, 201, res);
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = asyncHandler(async (req, res, next) => {
  const { password } = req.body;
  const email = normalizeEmail(req.body.email);

  const user = await findUserByEmail(email, { withPassword: true });
  if (!user || !(await user.comparePassword(password))) {
    return next(createError(401, 'Invalid email or password.'));
  }

  if (!accountIsActive(user)) {
    return next(createError(403, INACTIVE_ACCOUNT_MESSAGE));
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  await logAudit({ action: 'user.login', performedBy: user._id, targetId: user._id, targetModel: 'User', req });

  sendTokenResponse(user, 200, res);
});

// @desc    Get current logged-in user
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  const { loadAssignedShop } = require('../middleware/seller');
  const { publicShopStatus } = require('../services/roles');
  const user = await User.findById(req.user._id).populate('wishlist', 'name images price slug');
  const nursery = await loadAssignedShop(user);
  res.json({
    success: true,
    user,
    nursery,
    approvalStatus: nursery ? publicShopStatus(nursery.status) : null,
  });
});

// @desc    Forgot password – send reset email
// @route   POST /api/auth/forgot-password
// @access  Public
const checkEmail = asyncHandler(async (req, res) => {
  const existing = await findUserByEmail(req.body.email);
  if (existing) {
    return res.json({ success: true, available: false, message: EMAIL_TAKEN_MESSAGE });
  }
  res.json({ success: true, available: true });
});

const forgotPassword = asyncHandler(async (req, res, next) => {
  const user = await findUserByEmail(req.body.email);
  if (!user) {
    // Return 200 to not reveal whether email exists
    return res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
  }

  const resetToken = user.getResetPasswordToken();
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

  try {
    await sendEmail({
      to: user.email,
      subject: 'Thottam – Password Reset',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #28623D;">Password Reset Request</h2>
          <p>Hi ${user.name},</p>
          <p>You requested a password reset. Click the button below to set a new password. This link is valid for 30 minutes.</p>
          <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#28623D;color:#fff;border-radius:6px;text-decoration:none;margin:16px 0;">Reset Password</a>
          <p>If you didn't request this, please ignore this email.</p>
          <p>— Thottam Team</p>
        </div>
      `,
    });
  } catch {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });
    return next(createError(500, 'Email could not be sent. Please try again.'));
  }

  res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
});

// @desc    Reset password
// @route   PUT /api/auth/reset-password/:token
// @access  Public
const resetPassword = asyncHandler(async (req, res, next) => {
  const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (!user) {
    return next(createError(400, 'Invalid or expired reset token.'));
  }

  user.password = req.body.password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  if (!accountIsActive(user)) {
    return next(createError(403, INACTIVE_ACCOUNT_MESSAGE));
  }

  sendTokenResponse(user, 200, res);
});

// @desc    Change password (logged in)
// @route   PUT /api/auth/change-password
// @access  Private
const changePassword = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id).select('+password');
  const { currentPassword, newPassword } = req.body;

  if (!(await user.comparePassword(currentPassword))) {
    return next(createError(401, 'Current password is incorrect.'));
  }

  user.password = newPassword;
  await user.save();

  sendTokenResponse(user, 200, res);
});

module.exports = { register, login, getMe, forgotPassword, resetPassword, changePassword, checkEmail };
