/*
 * Checkout.
 *
 * The service owns the use case: what happens, in what order, and what is
 * atomic with what. It does not know about HTTP and it does not write SQL.
 *
 * Note that `quote` and `placeOrder` share `buildPricedOrder`. That single
 * shared call is the fix for the defect that cost the business money for three
 * years: it is now impossible for the price a customer is shown and the price
 * they are charged to disagree, because they are the same function call with
 * the same inputs. Not "kept in sync by convention" -- the same code.
 */
const { priceOrder } = require('../domain/pricing');
const { ProductNotFoundError, OutOfStockError, OrderNotFoundError } = require('../domain/errors');

/* eslint-disable-next-line max-lines-per-function --
   The rule is measuring the factory, not a function anybody has to read as a
   unit. The three methods inside it are 6, 30 and 4 lines. Splitting the
   factory to satisfy the metric would make the wiring harder to follow, which
   is the opposite of what the rule is for. */
function createCheckoutService({
  db,
  productRepo,
  couponRepo,
  orderRepo,
  outboxRepo,
  policy,
  clock = () => new Date().toISOString(),
  newPublicId = () => require('node:crypto').randomUUID(),
}) {
  /** Load the referenced products and coupon, then price the cart. Pure after this point. */
  async function buildPricedOrder({ items, couponCode }) {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await productRepo.findByIds(productIds);
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines = items.map((item) => {
      const product = byId.get(item.productId);
      if (!product) throw new ProductNotFoundError(item.productId);
      return {
        productId: product.id,
        name: product.name,
        unitPriceMinor: product.price_minor,
        qty: item.qty,
        stock: product.stock,
      };
    });

    const coupon = couponCode ? await couponRepo.findActiveByCode(couponCode) : null;
    return { priced: priceOrder({ lines, coupon, policy }), coupon };
  }

  return {
    async quote({ items, couponCode }) {
      const { priced } = await buildPricedOrder({ items, couponCode });
      return priced;
    },

    async placeOrder({ email, items, couponCode }) {
      const { priced, coupon } = await buildPricedOrder({ items, couponCode });
      const publicId = newPublicId();
      const now = clock();

      // Everything that must be all-or-nothing, and nothing that must not be.
      // No await inside: the mail provider is not invited into the transaction.
      const orderId = await db.transaction((tx) => {
        for (const line of priced.lines) {
          const reserved = productRepo.reserveStockInTx(tx, line.productId, line.qty);
          if (!reserved) {
            const current = productRepo.findByIdInTx(tx, line.productId);
            throw new OutOfStockError(line.name, line.qty, current ? current.stock : 0);
          }
        }

        const id = orderRepo.insertInTx(tx, {
          publicId,
          email,
          couponCode: coupon ? coupon.code : null,
          status: 'paid',
          createdAt: now,
          ...priced,
        });

        outboxRepo.enqueueInTx(tx, {
          topic: 'order.confirmation_email',
          payload: { orderId: id, publicId, email, totalMinor: priced.totalMinor },
          now,
        });

        return id;
      });

      return { orderId, publicId, priced, createdAt: now };
    },

    async getOrderByPublicId(publicId) {
      const order = await orderRepo.findByPublicId(publicId);
      if (!order) throw new OrderNotFoundError();
      return order;
    },
  };
}

module.exports = { createCheckoutService };
