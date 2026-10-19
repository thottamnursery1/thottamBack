const express = require('express');
const router = express.Router();
const { register, login, getMe, forgotPassword, resetPassword, changePassword, checkEmail } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { registerValidators, loginValidators, forgotPasswordValidators, resetPasswordValidators } = require('../validators/authValidators');
const { body } = require('express-validator');

router.post('/register', registerValidators, validate, register);
router.post('/check-email', forgotPasswordValidators, validate, checkEmail);
router.post('/login', loginValidators, validate, login);
router.get('/me', protect, getMe);
router.post('/forgot-password', forgotPasswordValidators, validate, forgotPassword);
router.put('/reset-password/:token', resetPasswordValidators, validate, resetPassword);
router.put('/change-password', protect, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
], validate, changePassword);

module.exports = router;
