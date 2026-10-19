const jwt = require('jsonwebtoken');
const { accountStatusOf } = require('../services/roles');

const generateToken = (userOrId) => {
  const id = userOrId && userOrId._id ? userOrId._id : userOrId;
  const tv = userOrId && typeof userOrId === 'object' ? (userOrId.tokenVersion || 0) : 0;
  return jwt.sign({ id, tv }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d',
  });
};

const sendTokenResponse = (user, statusCode, res) => {
  const token = generateToken(user);
  const accountStatus = accountStatusOf(user);

  res.status(statusCode).json({
    success: true,
    token,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      avatar: user.avatar,
      wishlist: user.wishlist,
      accountStatus,
      isActive: accountStatus === 'active',
      shop: user.shop,
    },
  });
};

module.exports = { generateToken, sendTokenResponse };
