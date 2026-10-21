const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, authorize, optionalAuth } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');
const plants = require('../controllers/plantController');

const router = express.Router();
const writeLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many plant requests. Please wait and try again.' },
});

router.get('/', optionalAuth, plants.listPublic);
router.get('/me/offerings', protect, plants.myOfferings);
router.get('/me/activities', protect, plants.myActivities);
router.post('/me/notifications/read', protect, plants.markNotificationsRead);
router.post('/uploads', protect, writeLimit, upload.array('images', 6), plants.uploadImages);

router.get('/admin/metrics', protect, authorize('admin'), plants.adminMetrics);
router.get('/admin/listings', protect, authorize('admin'), plants.adminListings);
router.post('/admin/listings/:id/moderate', protect, authorize('admin'), plants.moderate);
router.get('/admin/requests', protect, authorize('admin'), plants.adminRequests);
router.get('/admin/reports', protect, authorize('admin'), plants.adminReports);
router.patch('/admin/reports/:id', protect, authorize('admin'), plants.resolveReport);
router.post('/admin/users/:id/restriction', protect, authorize('admin'), plants.restrictUser);
router.put('/admin/policy', protect, authorize('admin'), plants.updatePolicy);
router.get('/admin/audit', protect, authorize('admin'), plants.adminAudit);

router.post('/adoptions/:id/respond', protect, plants.respondAdoption);
router.post('/adoptions/:id/withdraw', protect, plants.withdrawAdoption);
router.post('/adoptions/:id/cancel', protect, plants.cancelAdoption);
router.post('/adoptions/:id/confirm', protect, plants.confirmAdoption);
router.post('/exchanges/:id/respond', protect, plants.respondExchange);
router.post('/exchanges/:id/withdraw', protect, plants.withdrawExchange);
router.post('/exchanges/:id/cancel', protect, plants.cancelExchange);
router.post('/exchanges/:id/confirm', protect, plants.confirmExchange);
router.post('/activities/:id/dispute', protect, writeLimit, plants.dispute);
router.post('/enquiries/:id/close', protect, plants.closeEnquiry);

router.get('/:id', optionalAuth, plants.getOne);
router.post('/', protect, writeLimit, plants.createListing);
router.put('/:id', protect, plants.updateListing);
router.delete('/:id', protect, plants.removeListing);
router.post('/:id/pause', protect, plants.pauseListing);
router.post('/:id/adopt', protect, writeLimit, plants.adopt);
router.post('/:id/exchange', protect, writeLimit, plants.proposeExchange);
router.post('/:id/enquiry', protect, writeLimit, plants.saleEnquiry);
router.post('/:id/report', protect, writeLimit, plants.reportListing);
router.post('/:id/reviews', protect, writeLimit, plants.reviewListing);

module.exports = router;
