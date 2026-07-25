/*
 * Checkout routes.
 *
 * Compare this file with code/legacy/server.js. A handler here does three
 * things and then stops:
 *
 *   1. parse and validate the request
 *   2. call one service method
 *   3. map the result to the wire format
 *
 * There is no arithmetic, no SQL, no try/catch and no branching on business
 * rules. Errors are thrown by the layer that detected them and translated once
 * in the error handler. If a handler in this codebase grows a fourth
 * responsibility, that is the review comment.
 */
const express = require('express');
const { asyncRoute } = require('../middleware/error-handler');
const { parseCart } = require('../validate');
const { toPriceBreakdown, toOrderCreated, toOrder } = require('../dto');

function checkoutRoutes({ checkoutService }) {
  const router = express.Router();

  router.post('/quote', asyncRoute(async (req, res) => {
    const cart = parseCart(req.body, { requireEmail: false });
    const priced = await checkoutService.quote(cart);
    res.json(toPriceBreakdown(priced));
  }));

  router.post('/orders', asyncRoute(async (req, res) => {
    const cart = parseCart(req.body, { requireEmail: true });
    const result = await checkoutService.placeOrder(cart);
    req.log.info('order placed', {
      orderId: result.orderId,
      publicId: result.publicId,
      totalMinor: result.priced.totalMinor,
    });
    // 201 is the right status for this and 200 is what the legacy handler
    // returned. Existing clients get 200 until the v2 envelope ships; being
    // right is not worth a surprise for an integration we do not control.
    res.status(200).json(toOrderCreated(result));
  }));

  // Lookup is by unguessable public id. The legacy route took the sequential
  // primary key with no authorisation, so /api/orders/41 handed you somebody
  // else's order. Removing that is a deliberate breaking change -- see
  // docs/02-migration-plan.md, "changes that cannot be behaviour-preserving".
  router.get('/orders/:publicId', asyncRoute(async (req, res) => {
    const order = await checkoutService.getOrderByPublicId(req.params.publicId);
    res.json(toOrder(order));
  }));

  return router;
}

module.exports = { checkoutRoutes };
