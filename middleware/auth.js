const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { createError } = require('../utils/errorUtils');
const { canonicalRole, accountIsActive, INACTIVE_ACCOUNT_MESSAGE } = require('../services/roles');

function tokenStillValid(user, decoded) {
  return (decoded.tv || 0) === (user.tokenVersion || 0);
}

// Verify JWT and attach user to request
const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return next(createError(401, 'Not authorized. No token provided.'));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return next(createError(401, 'User no longer exists.'));
    if (!accountIsActive(user)) return next(createError(403, INACTIVE_ACCOUNT_MESSAGE));
    if (!tokenStillValid(user, decoded)) return next(createError(401, 'Your session is no longer valid. Please log in again.'));

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return next(createError(401, 'Invalid token.'));
    if (err.name === 'TokenExpiredError') return next(createError(401, 'Token has expired. Please log in again.'));
    next(err);
  }
};

// Restrict to specific roles
const authorize = (...roles) => {
  const allowed = new Set(roles.map((role) => canonicalRole(role)));
  return (req, res, next) => {
    if (!req.user) return next(createError(401, 'Not authorized. No token provided.'));
    if (!allowed.has(canonicalRole(req.user.role))) {
      return next(createError(403, `Role '${req.user.role}' is not authorized to access this resource.`));
    }
    next();
  };
};

// Blocks super_admin from write operations — only role:'admin' (platform admin) may create/edit/delete products
const requirePlatformAdmin = (req, res, next) => {
  if (!req.user) return next(createError(401, 'Not authorized.'));
  if (req.user.role !== 'admin') {
    return next(createError(403, 'Super admins can view and moderate products but cannot create or edit them directly.'));
  }
  next();
};

// Optional auth — attaches user if token present, never blocks
const optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (user && accountIsActive(user) && tokenStillValid(user, decoded)) req.user = user;
    }
    next();
  } catch {
    next();
  }
};

module.exports = { protect, authorize, requirePlatformAdmin, optionalAuth };
