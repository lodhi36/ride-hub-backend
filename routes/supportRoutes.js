const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');

// Dashboard & Statistics (Real-time DB counts)
router.get('/dashboard', supportController.getDashboardStats);

// Order Search & Live Tracking
router.get(['/orders/search', '/orders'], supportController.searchOrders);
router.get(['/orders/:orderId', '/tracking/:orderId'], supportController.getOrderDetailsWithTracking);

// Live Zone Map (Zone Boundaries + Live Online Riders)
router.get(['/zones/live', '/live-map'], supportController.getLiveZonesAndRiders);

// Case / Ticket Queue & Filtering (Tabs: CUSTOMER, RIDER, SUPPLIER)
router.get('/cases', supportController.getQueueCases);
router.get('/tickets', supportController.getQueueCases);
router.get('/cases/:caseId', supportController.getCaseById);
router.get('/ticket/:caseId', supportController.getCaseById);

// Create Support Request / Raise Ticket
router.post('/request', supportController.createSupportRequest);
router.post('/cases', supportController.createSupportRequest);
router.post('/ticket/create', supportController.createSupportRequest);
router.post('/tickets', supportController.createSupportRequest);

// Real-Time Chat & Operations
router.post('/cases/:caseId/message', supportController.addCaseMessage);
router.post('/cases/:caseId/messages', supportController.addCaseMessage);
router.post('/ticket/:caseId/message', supportController.addCaseMessage);
router.post('/cases/:caseId/activities', supportController.addCaseActivity);

// Status, Assignment & Cancellation
router.put('/cases/:caseId/status', supportController.updateCaseStatus);
router.put('/ticket/:caseId/status', supportController.updateCaseStatus);
router.post('/cases/:caseId/cancel', supportController.cancelSupportTicket);
router.post('/tickets/:caseId/cancel', supportController.cancelSupportTicket);
router.post('/ticket/:caseId/cancel', supportController.cancelSupportTicket);
router.put('/cases/:caseId/cancel', supportController.cancelSupportTicket);
router.post('/cancel', supportController.cancelSupportTicket);
router.put('/cases/:caseId/assign', supportController.assignCase);
router.post('/cases/:caseId/transfer', supportController.transferCase);
router.post('/cases/:caseId/resolve', supportController.resolveCase);
router.post('/cases/:caseId/money-action', supportController.executeMoneyAction);

// Support Admin Cancellation Request System (ACCEPT / REJECT)
router.post('/cases/:caseId/cancellation-action', supportController.processCancellationDecision);
router.post('/cancellation/action', supportController.processCancellationDecision);

// 0-Penalty Rider Order Transfer (Timer Expiry Flow)
router.post('/rider/transfer-order', supportController.transferRiderOrder);
router.post('/transfer-order', supportController.transferRiderOrder);

// Real Previous Orders & User Tickets History
router.get('/previous-orders', supportController.getPreviousOrders);
router.get('/orders/previous', supportController.getPreviousOrders);
router.get('/user-tickets/:userId', supportController.getUserTickets);
router.get('/user-tickets', supportController.getUserTickets);

// Support Admin Wallet, UPI & Withdrawals (Distinct from Rider Wallet)
router.get('/wallet/:agentId', supportController.getSupportWallet);
router.post('/wallet/upi', supportController.submitSupportUpi);
router.post('/wallet/withdraw', supportController.requestSupportWithdrawal);

// Audit Logs
router.get('/audit-logs', supportController.getAuditLogs);

// Agents & Profile
router.get('/agents', supportController.getAgents);
router.put('/agent-status', supportController.updateAgentStatus);
router.post('/login', supportController.agentLogin);

// Payout Rules
router.get('/payout-rules', supportController.getPayoutRules);

module.exports = router;

