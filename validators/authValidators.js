const { body } = require('express-validator');

const emailField = () => body('email')
  .trim()
  .customSanitizer((value) => String(value || '').toLowerCase())
  .isEmail()
  .withMessage('Please provide a valid email');

const registerValidators = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 60 }).withMessage('Name cannot exceed 60 characters'),
  emailField(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  body('phone').optional().matches(/^[6-9]\d{9}$/).withMessage('Please provide a valid 10-digit Indian mobile number'),
];

const loginValidators = [
  emailField(),
  body('password').notEmpty().withMessage('Password is required'),
];

const forgotPasswordValidators = [
  emailField(),
];

const resetPasswordValidators = [
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
];

module.exports = { registerValidators, loginValidators, forgotPasswordValidators, resetPasswordValidators };
