const express = require('express');
const router = express.Router();
const { getProductReviews, addReview, deleteReview, getRecentReviews } = require('../controllers/reviewController');
const { protect } = require('../middleware/auth');
const { body } = require('express-validator');
const validate = require('../middleware/validate');

router.get('/recent', getRecentReviews);
router.get('/:productId', getProductReviews);
router.post('/:productId', protect, [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').notEmpty().withMessage('Review comment is required').isLength({ max: 1000 }),
], validate, addReview);
router.delete('/:id', protect, deleteReview);

module.exports = router;
