/*
 * Product repository. All SQL touching `products` lives here and nowhere else.
 *
 * The `reserveStock` method is the interesting one -- see the comment on it.
 */

function createProductRepository(db) {
  return {
    async listAll() {
      return db.all(
        'SELECT id, name, price_minor, cost_minor, supplier, stock FROM products ORDER BY id',
      );
    },

    async findByIds(ids) {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(',');
      return db.all(
        `SELECT id, name, price_minor, cost_minor, supplier, stock
           FROM products WHERE id IN (${placeholders})`,
        ids,
      );
    },

    findByIdInTx(tx, id) {
      return tx.get('SELECT id, name, price_minor, stock FROM products WHERE id = ?', [id]);
    },

    /**
     * Decrement stock atomically, inside the caller's transaction.
     *
     * The guard is in the WHERE clause, not in an `if` in the application:
     *
     *     UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?
     *
     * so the check and the write are one statement that the database
     * serialises. Two concurrent checkouts for the last four bottles cannot
     * both succeed, on SQLite or Postgres or anything else, because the second
     * UPDATE matches zero rows and we can see that in `changes`.
     *
     * The legacy code did SELECT stock -> if (stock >= qty) -> UPDATE, with an
     * await between the read and the write. Both requests read 6, both passed
     * the check, both decremented, and the shop sold minus two bottles.
     *
     * @returns {boolean} true if the reservation succeeded
     */
    reserveStockInTx(tx, productId, qty) {
      const result = tx.run(
        'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
        [qty, productId, qty],
      );
      return result.changes === 1;
    },
  };
}

module.exports = { createProductRepository };
