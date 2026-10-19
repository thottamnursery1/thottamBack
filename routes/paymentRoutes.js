const express = require('express');
const router = express.Router();
const { createPaymentOrder, verifyPayment } = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');
const { body } = require('express-validator');
const validate = require('../middleware/validate');

router.use(protect);

router.post('/create-order', [
  body('shippingAddress.fullName').notEmpty().withMessage('Full name is required'),
  body('shippingAddress.phone').matches(/^[6-9]\d{9}$/).withMessage('Valid phone number required'),
  body('shippingAddress.line1').notEmpty().withMessage('Address line 1 is required'),
  body('shippingAddress.city').notEmpty().withMessage('City is required'),
  body('shippingAddress.state').notEmpty().withMessage('State is required'),
  body('shippingAddress.postalCode').matches(/^\d{6}$/).withMessage('Valid 6-digit postal code required'),
  body('needsCartonBox')
    .custom((value) => typeof value === 'boolean')
    .withMessage('Please choose whether you need a carton box before placing the order.'),
], validate, createPaymentOrder);

router.post('/verify', [
  body('razorpay_order_id').notEmpty().withMessage('Razorpay order ID required'),
  body('razorpay_payment_id').notEmpty().withMessage('Razorpay payment ID required'),
  body('razorpay_signature').notEmpty().withMessage('Razorpay signature required'),
], validate, verifyPayment);

module.exports = router;
