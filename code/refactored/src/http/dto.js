/*
 * Wire format.
 *
 * One place decides what the outside world sees. Adding a column to a table
 * cannot change the API any more, because nothing serialises a database row
 * directly.
 *
 * Every money field is emitted twice: the legacy decimal the storefront and
 * the two integrations already parse, and the exact integer minor unit that
 * new clients should use. Additive change, no coordinated release, and the
 * decimal fields can be dropped once the access logs show nobody reads them.
 */
const { minorToDecimalNumber } = require('../domain/money');

function money(minor) {
  return minorToDecimalNumber(minor);
}

function toPriceBreakdown(priced) {
  return {
    // deprecated decimal fields, kept for the existing contract
    subtotal: money(priced.subtotalMinor),
    discount: money(priced.discountMinor),
    shipping: money(priced.shippingMinor),
    tax: money(priced.taxMinor),
    total: money(priced.totalMinor),
    // exact fields, for new clients
    currency: 'INR',
    subtotalMinor: priced.subtotalMinor,
    discountMinor: priced.discountMinor,
    shippingMinor: priced.shippingMinor,
    taxMinor: priced.taxMinor,
    totalMinor: priced.totalMinor,
  };
}

function toOrderCreated({ orderId, publicId, priced }) {
  return {
    id: orderId,
    publicId,
    ...toPriceBreakdown(priced),
    status: 'paid',
    lines: priced.lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      qty: l.qty,
      unitPrice: money(l.unitPriceMinor),
      unitPriceMinor: l.unitPriceMinor,
      lineTotalMinor: l.lineTotalMinor,
    })),
  };
}

function toOrder(row) {
  return {
    publicId: row.public_id,
    email: row.email,
    status: row.status,
    createdAt: row.created_at,
    currency: 'INR',
    subtotal: money(row.subtotal_minor),
    discount: money(row.discount_minor),
    shipping: money(row.shipping_minor),
    tax: money(row.tax_minor),
    total: money(row.total_minor),
    totalMinor: row.total_minor,
    coupon: row.coupon_code,
    lines: (row.lines ?? []).map((l) => ({
      productId: l.product_id,
      name: l.name_at_purchase,
      qty: l.qty,
      unitPrice: money(l.unit_price_minor),
      lineTotal: money(l.line_total_minor),
    })),
  };
}

function toProduct(product) {
  return {
    id: product.id,
    name: product.name,
    price: money(product.priceMinor),
    priceMinor: product.priceMinor,
    stock: product.stock,
  };
}

module.exports = { toPriceBreakdown, toOrderCreated, toOrder, toProduct };
