const express = require('express');
const router = express.Router();
const { getMyOrders, getOrder, createOrder, cancelOrder } = require('../controllers/orderController');
const { protect } = require('../middleware/auth');
const { body } = require('express-validator');
const validate = require('../middleware/validate');

router.use(protect);

router.get('/my-orders', getMyOrders);
router.get('/:id', getOrder);
router.post('/', [
  body('shippingAddress.fullName').notEmpty().withMessage('Full name is required'),
  body('shippingAddress.phone').matches(/^[6-9]\d{9}$/).withMessage('Valid phone number required'),
  body('shippingAddress.line1').notEmpty().withMessage('Address line 1 is required'),
  body('shippingAddress.city').notEmpty().withMessage('City is required'),
  body('shippingAddress.state').notEmpty().withMessage('State is required'),
  body('shippingAddress.postalCode').matches(/^\d{6}$/).withMessage('Valid 6-digit postal code required'),
  body('needsCartonBox')
    .custom((value) => typeof value === 'boolean')
    .withMessage('Please choose whether you need a carton box before placing the order.'),
], validate, createOrder);
router.post('/:id/cancel', cancelOrder);

module.exports = router;
