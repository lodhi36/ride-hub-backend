const express = require('express');
const router = express.Router();
const termsController = require('../controllers/termsController');

router.get('/:role', termsController.getTermsByRole);
router.post('/accept', termsController.acceptTerms);
router.get('/admin/all', termsController.adminGetAllTerms);
router.put('/admin/:role', termsController.adminUpdateTerms);

module.exports = router;
