/*
 * Order repository.
 *
 * `insertInTx` takes the transaction scope rather than reaching for the
 * connection itself, so the caller decides what is atomic with what. The
 * service composes the unit of work; the repository does not have an opinion
 * about it.
 */

function createOrderRepository(db) {
  return {
    insertInTx(tx, order) {
      const result = tx.run(
        `INSERT INTO orders (
           public_id, email, subtotal_minor, discount_minor, shipping_minor,
           tax_minor, total_minor, coupon_code, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          order.publicId,
          order.email,
          order.subtotalMinor,
          order.discountMinor,
          order.shippingMinor,
          order.taxMinor,
          order.totalMinor,
          order.couponCode,
          order.status,
          order.createdAt,
        ],
      );
      const orderId = Number(result.lastInsertRowid);

      for (const line of order.lines) {
        tx.run(
          `INSERT INTO order_lines (
             order_id, product_id, name_at_purchase, unit_price_minor, qty, line_total_minor
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          [orderId, line.productId, line.name, line.unitPriceMinor, line.qty, line.lineTotalMinor],
        );
      }

      return orderId;
    },

    async findByPublicId(publicId) {
      const order = await db.get(
        `SELECT id, public_id, email, subtotal_minor, discount_minor, shipping_minor,
                tax_minor, total_minor, coupon_code, status, created_at
           FROM orders WHERE public_id = ?`,
        [publicId],
      );
      if (!order) return null;
      const lines = await db.all(
        `SELECT product_id, name_at_purchase, unit_price_minor, qty, line_total_minor
           FROM order_lines WHERE order_id = ?`,
        [order.id],
      );
      return { ...order, lines };
    },

    async listRecent(limit = 100) {
      return db.all(
        `SELECT id, public_id, email, total_minor, coupon_code, status, created_at
           FROM orders ORDER BY id DESC LIMIT ?`,
        [limit],
      );
    },
  };
}

module.exports = { createOrderRepository };
