/*
 * Domain errors.
 *
 * The domain says what went wrong. It does not know what an HTTP status code
 * is -- that mapping lives in one place, http/middleware/error-handler.js, so
 * a new transport (a queue consumer, a CLI, the admin app) reuses the rules
 * instead of reinventing them.
 *
 * `legacyMessage` exists because the storefront and two integrations match on
 * the old error strings. We keep the string and add a machine-readable `code`
 * beside it. The strings are deprecated and scheduled for removal with the v2
 * error envelope.
 */

class DomainError extends Error {
  constructor(code, message, { details = null, legacyMessage = null } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
    this.legacyMessage = legacyMessage ?? message;
    this.expected = true; // distinguishes "the user did something" from "we broke"
  }
}

class ValidationError extends DomainError {
  constructor(details, legacyMessage) {
    super('validation_error', 'The request body is not valid', { details, legacyMessage });
  }
}

class ProductNotFoundError extends DomainError {
  constructor(productId) {
    super('product_not_found', `No product with id ${productId}`, {
      details: { productId },
      legacyMessage: 'bad product',
    });
  }
}

class OutOfStockError extends DomainError {
  constructor(productName, requested, available) {
    super('out_of_stock', `Not enough stock for ${productName}`, {
      details: { productName, requested, available },
      legacyMessage: `out of stock: ${productName}`,
    });
  }
}

class OrderNotFoundError extends DomainError {
  constructor() {
    // Deliberately does not confirm whether the id exists: the lookup is by
    // public token, and a distinguishable 403 would leak which ids are real.
    super('order_not_found', 'Order not found', { legacyMessage: 'not found' });
  }
}

class UnauthorizedError extends DomainError {
  constructor() {
    super('unauthorized', 'Missing or invalid credentials', { legacyMessage: 'nope' });
  }
}

module.exports = {
  DomainError,
  ValidationError,
  ProductNotFoundError,
  OutOfStockError,
  OrderNotFoundError,
  UnauthorizedError,
};
