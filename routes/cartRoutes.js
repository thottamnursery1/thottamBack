const express = require('express');
const router = express.Router();
const { getCart, addToCart, updateCartItem, removeCartItem, applyCoupon, removeCoupon, clearCart } = require('../controllers/cartController');
const { protect } = require('../middleware/auth');
const { body } = require('express-validator');
const validate = require('../middleware/validate');

router.use(protect);

router.get('/', getCart);
router.post('/', [
  body('productId').isMongoId().withMessage('Invalid product ID'),
  body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
], validate, addToCart);
router.put('/:itemId', [body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')], validate, updateCartItem);
router.delete('/coupon', removeCoupon);
router.delete('/clear', clearCart);
router.delete('/:itemId', removeCartItem);
router.post('/coupon', [body('code').notEmpty().withMessage('Coupon code is required')], validate, applyCoupon);

module.exports = router;
