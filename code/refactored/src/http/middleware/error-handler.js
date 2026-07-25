/*
 * The one place that turns an error into an HTTP response.
 *
 * Two categories, and the difference matters more than the status code:
 *
 *   expected   - the caller did something we anticipated. Logged at warn,
 *                answered with a precise message. Not an alert.
 *   unexpected - we have a bug. Logged at error with the stack and the request
 *                id, answered with a generic message and that id. The customer
 *                gets something they can quote to support; they do not get our
 *                stack trace, our file paths, or our table names.
 *
 * The legacy handler returned `{ error: e.message, stack: e.stack }`.
 */
const { DomainError } = require('../../domain/errors');

const STATUS_BY_CODE = {
  validation_error: 400,
  product_not_found: 400, // 400 preserves the legacy contract; 404 is the v2 answer
  out_of_stock: 400, //      likewise -- 409 is correct, and is a breaking change
  order_not_found: 404,
  unauthorized: 401,
};

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'not found', code: 'route_not_found' });
}

function errorHandler(logger) {
  // express identifies the error handler by arity: the unused `next` argument
  // must be present or this becomes ordinary middleware and never runs.
  return function errorHandlerMiddleware(err, req, res, next) {
    const log = req.log ?? logger;

    if (err instanceof DomainError) {
      const status = STATUS_BY_CODE[err.code] ?? 400;
      log.warn('request rejected', { code: err.code, status, details: err.details });
      return res.status(status).json({
        // legacy string first, so existing clients keep working
        error: err.legacyMessage,
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
        requestId: req.id,
      });
    }

    if (err?.type === 'entity.parse.failed') {
      log.warn('malformed json body');
      return res.status(400).json({ error: 'malformed json', code: 'malformed_json', requestId: req.id });
    }

    log.error('unhandled error', {
      err: { name: err?.name, message: err?.message, stack: err?.stack },
    });
    return res.status(500).json({
      error: 'internal error',
      code: 'internal_error',
      message: 'Something went wrong on our side. Quote this id to support.',
      requestId: req.id,
    });
  };
}

/** Express 4 does not catch rejected promises from async handlers. This does. */
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

module.exports = { errorHandler, notFoundHandler, asyncRoute, STATUS_BY_CODE };
