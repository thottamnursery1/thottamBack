const express = require('express');
const router = express.Router();
const { listNurseries, getNursery, registerNursery, checkPin } = require('../controllers/nurseryController');
const { publicSettings, subscribeNewsletter } = require('../controllers/platformController');

router.get('/', listNurseries);
router.get('/settings/public', publicSettings);
router.post('/check-pin', checkPin);
router.post('/register', registerNursery);
router.post('/newsletter', subscribeNewsletter);
router.get('/:slug', getNursery);

module.exports = router;
