const express = require('express');
const router = express.Router();
const tryOnController = require('../controllers/tryOnController');

router.post('/remove-bg', tryOnController.removeBackground);
router.post('/process', tryOnController.processTryOn);
router.post('/cleanup', tryOnController.cleanupTryOn);
router.delete('/cleanup', tryOnController.cleanupTryOn);

module.exports = router;
