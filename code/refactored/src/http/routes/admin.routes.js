const express = require('express');
const { asyncRoute } = require('../middleware/error-handler');
const { adminAuth } = require('../middleware/admin-auth');

function adminRoutes({ orderRepo, outboxRepo, adminApiKey }) {
  const router = express.Router();
  router.use(adminAuth(adminApiKey));

  router.get('/orders', asyncRoute(async (req, res) => {
    res.json(await orderRepo.listRecent(100));
  }));

  // Operational visibility on the side effects: what is queued, what failed,
  // and why. The legacy system had no answer to "did that customer get their
  // confirmation email" other than asking the customer.
  router.get('/outbox', asyncRoute(async (req, res) => {
    res.json(await outboxRepo.listRecent(50));
  }));

  return router;
}

module.exports = { adminRoutes };
