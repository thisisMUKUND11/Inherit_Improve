/*
 * Transactional outbox.
 *
 * The rule this table exists to enforce: a side effect that must happen
 * because an order was placed is recorded in the same transaction as the
 * order, and performed after that transaction commits.
 *
 * Either the order and its confirmation-email intent both exist, or neither
 * does. The mail provider being down then delays an email; it does not fail a
 * checkout, and it does not leave an order that nobody was told about.
 */

function createOutboxRepository(db) {
  return {
    enqueueInTx(tx, { topic, payload, now }) {
      const result = tx.run(
        `INSERT INTO outbox (topic, payload, status, attempts, available_at, created_at)
         VALUES (?, ?, 'pending', 0, ?, ?)`,
        [topic, JSON.stringify(payload), now, now],
      );
      return Number(result.lastInsertRowid);
    },

    async claimDue(now, limit = 10) {
      return db.all(
        `SELECT id, topic, payload, attempts
           FROM outbox
          WHERE status = 'pending' AND available_at <= ?
          ORDER BY id
          LIMIT ?`,
        [now, limit],
      );
    },

    async markSent(id, now) {
      await db.run(
        "UPDATE outbox SET status = 'sent', last_error = NULL, available_at = ? WHERE id = ?",
        [now, id],
      );
    },

    /** Exponential backoff, then park it in `failed` for a human to look at. */
    async markFailed(id, attempts, error, maxAttempts, now) {
      const exhausted = attempts >= maxAttempts;
      const backoffMs = Math.min(2 ** attempts * 1000, 5 * 60 * 1000);
      await db.run(
        `UPDATE outbox
            SET status = ?, attempts = ?, last_error = ?, available_at = ?
          WHERE id = ?`,
        [
          exhausted ? 'failed' : 'pending',
          attempts,
          String(error).slice(0, 500),
          new Date(new Date(now).getTime() + backoffMs).toISOString(),
          id,
        ],
      );
      return exhausted;
    },

    async listRecent(limit = 50) {
      return db.all(
        `SELECT id, topic, status, attempts, last_error, created_at
           FROM outbox ORDER BY id DESC LIMIT ?`,
        [limit],
      );
    },
  };
}

module.exports = { createOutboxRepository };
