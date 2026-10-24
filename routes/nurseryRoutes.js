const express = require('express');
const router = express.Router();
const { listNurseries, getNursery, registerNursery, checkPin, onboardGateway } = require('../controllers/nurseryController');
const { publicSettings, subscribeNewsletter } = require('../controllers/platformController');

router.get('/', listNurseries);
router.get('/settings/public', publicSettings);
router.post('/check-pin', checkPin);
router.post('/register', registerNursery);
router.post('/payment-gateway/onboard', onboardGateway);
router.post('/newsletter', subscribeNewsletter);
router.get('/:slug', getNursery);

module.exports = router;
