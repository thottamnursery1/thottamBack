const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, authorize } = require('../middleware/auth');
const { requireCommunitySeller } = require('../middleware/communitySeller');
const community = require('../controllers/communityController');

const router = express.Router();
const writeLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please wait and try again.' },
});

router.get('/sellers/:id', community.publicSeller);

router.use(protect);

router.get('/me', community.getMyProfile);
router.post('/apply', writeLimit, community.apply);
router.put('/profile', requireCommunitySeller, community.updateProfile);
router.put('/payout', requireCommunitySeller, writeLimit, community.updatePayout);
router.get('/products', requireCommunitySeller, community.listMyProducts);
router.post('/products', requireCommunitySeller, writeLimit, community.createListing);
router.put('/products/:id', requireCommunitySeller, community.updateListing);
router.delete('/products/:id', requireCommunitySeller, community.deleteListing);
router.get('/orders', requireCommunitySeller, community.listMyOrders);
router.get('/orders/:id', requireCommunitySeller, community.getMyOrder);
router.put('/orders/:id/fulfillment', requireCommunitySeller, community.fulfillOrder);
router.get('/earnings', requireCommunitySeller, community.earnings);
router.post('/reports', writeLimit, community.reportListing);

router.get('/admin/sellers', authorize('admin'), community.adminListSellers);
router.post('/admin/sellers/:id/review', authorize('admin'), community.adminReviewSeller);
router.get('/admin/listings', authorize('admin'), community.adminListings);
router.post('/admin/listings/:id/moderate', authorize('admin'), community.moderateListing);
router.get('/admin/reports', authorize('admin'), community.adminReports);
router.patch('/admin/reports/:id', authorize('admin'), community.resolveReport);
router.get('/admin/metrics', authorize('admin'), community.adminMetrics);
router.get('/admin/settlements', authorize('admin'), community.adminSettlements);
router.post('/admin/settlements/:id', authorize('admin'), community.settlementAction);
router.get('/admin/audit', authorize('admin'), community.adminAudit);

module.exports = router;
