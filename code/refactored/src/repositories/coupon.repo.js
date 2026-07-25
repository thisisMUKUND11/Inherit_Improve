/*
 * Coupon repository.
 *
 * The lookup is a bound parameter. The legacy version was:
 *
 *   "SELECT * FROM coupons WHERE code = '" + coupon + "' AND active = 1"
 *
 * which turned the coupon field on the cart page into a SQL console.
 */

function createCouponRepository(db) {
  return {
    /** @returns {{kind:string,percentBp:number|null,amountMinor:number|null}|null} */
    async findActiveByCode(code) {
      const row = await db.get(
        `SELECT code, kind, percent_bp, amount_minor
           FROM coupons
          WHERE code = ? AND active = 1`,
        [code],
      );
      if (!row) return null;
      return {
        code: row.code,
        kind: row.kind,
        percentBp: row.percent_bp,
        amountMinor: row.amount_minor,
      };
    },
  };
}

module.exports = { createCouponRepository };
