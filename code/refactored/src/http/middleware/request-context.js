/*
 * Give every request an id, a logger, and a timing record.
 *
 * This is the cheapest observability that exists and it is the thing the
 * inherited system had none of: there was no way to correlate "the customer
 * says checkout failed at 16:32" with anything in the logs.
 */
const crypto = require('node:crypto');

function requestContext(logger) {
  return function requestContextMiddleware(req, res, next) {
    const requestId = req.get('x-request-id') || crypto.randomUUID();
    const startedAt = process.hrtime.bigint();

    req.id = requestId;
    req.log = logger.child({ requestId });
    res.set('x-request-id', requestId);

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : 'info';
      req.log[level]('request', {
        method: req.method,
        path: req.route ? req.baseUrl + req.route.path : req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });

    next();
  };
}

module.exports = { requestContext };
