/*
 * Composition root.
 *
 * Every dependency is constructed here and passed down. Nothing below this
 * file reaches out to grab a database handle, a clock, or an environment
 * variable, which is why the services and the domain can be tested without a
 * server, a socket, or a mock framework.
 *
 * buildApp returns the wiring as well as the express app so tests can drive
 * the outbox worker deliberately instead of waiting for a timer.
 */
const express = require('express');
const path = require('node:path');

const { createLogger } = require('./observability/logger');
const { requestContext } = require('./http/middleware/request-context');
const { errorHandler, notFoundHandler } = require('./http/middleware/error-handler');

const { createProductRepository } = require('./repositories/product.repo');
const { createCouponRepository } = require('./repositories/coupon.repo');
const { createOrderRepository } = require('./repositories/order.repo');
const { createOutboxRepository } = require('./repositories/outbox.repo');

const { createCatalogService } = require('./services/catalog.service');
const { createCheckoutService } = require('./services/checkout.service');

const { createMailer } = require('./adapters/mailer');
const { createOutboxWorker, createOutboxHandlers } = require('./workers/outbox.worker');

const { catalogRoutes } = require('./http/routes/catalog.routes');
const { checkoutRoutes } = require('./http/routes/checkout.routes');
const { adminRoutes } = require('./http/routes/admin.routes');

function buildApp({ db, config, logger = createLogger({ level: config.logLevel }), clock, mailer }) {
  const productRepo = createProductRepository(db);
  const couponRepo = createCouponRepository(db);
  const orderRepo = createOrderRepository(db);
  const outboxRepo = createOutboxRepository(db);

  const catalogService = createCatalogService({ productRepo });
  const checkoutService = createCheckoutService({
    db, productRepo, couponRepo, orderRepo, outboxRepo,
    policy: config.pricingPolicy,
    ...(clock ? { clock } : {}),
  });

  const resolvedMailer = mailer ?? createMailer({ log: (m, f) => logger.info(m, f) });
  const outboxWorker = createOutboxWorker({
    outboxRepo,
    handlers: createOutboxHandlers({ mailer: resolvedMailer }),
    maxAttempts: config.outbox.maxAttempts,
    logger,
    ...(clock ? { clock } : {}),
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use(requestContext(logger));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Liveness and readiness are separate on purpose: a load balancer should
  // stop sending traffic to an instance that cannot reach its database
  // without also restarting an instance that is merely busy.
  app.get('/health/live', (req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (req, res) => {
    try {
      await db.get('SELECT 1 AS ok');
      res.json({ status: 'ready' });
    } catch (err) {
      req.log.error('readiness check failed', { error: err.message });
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use('/api', catalogRoutes({ catalogService }));
  app.use('/api', checkoutRoutes({ checkoutService }));
  app.use('/admin', adminRoutes({ orderRepo, outboxRepo, adminApiKey: config.adminApiKey }));

  // POST /db/sql is gone. Nothing replaced it, because nothing should have
  // existed in the first place; the storefront uses GET /api/products.

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return { app, outboxWorker, logger, repositories: { productRepo, orderRepo, outboxRepo } };
}

module.exports = { buildApp };
