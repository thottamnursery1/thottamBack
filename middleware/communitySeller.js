const CommunitySeller = require('../models/CommunitySeller');
const { createError } = require('../utils/errorUtils');

const requireCommunitySeller = async (req, res, next) => {
  try {
    const profile = await CommunitySeller.findOne({ user: req.user._id });
    if (!profile) return next(createError(403, 'Apply to become a community seller first.'));
    if (profile.status === 'pending') return next(createError(403, 'Your seller application is still pending approval.'));
    if (profile.status === 'rejected') return next(createError(403, 'Your seller application was rejected.'));
    if (profile.status === 'suspended') return next(createError(403, 'Your seller profile is suspended.'));
    if (profile.status !== 'approved') return next(createError(403, 'Only approved community sellers can do this.'));
    req.communitySeller = profile;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireCommunitySeller };
