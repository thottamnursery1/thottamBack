const express = require('express');
const { protect, authorize, optionalAuth } = require('../middleware/auth');
const auctions = require('../controllers/auctionController');

const router = express.Router();

router.get('/', auctions.listAuctions);
router.get('/me/history', protect, auctions.myAuctions);
router.get('/admin/payments', protect, authorize('admin', 'super_admin'), auctions.adminAuctions);
router.post('/admin/payments/:id/refund', protect, authorize('admin', 'super_admin'), auctions.adminRefund);
router.post('/', protect, auctions.createAuction);
router.get('/:id', optionalAuth, auctions.getAuction);
router.post('/:id/bids', protect, auctions.placeBid);
router.get('/:id/checkout', protect, auctions.checkoutQuote);
router.post('/:id/pay', protect, auctions.payAuction);
router.post('/:id/verify', protect, auctions.verifyAuction);

module.exports = router;
