# Refactor — the checkout handler

One endpoint, taken from the inherited code to the target structure, with the tests
that made it safe and the defects it removes.

Both versions are in this repository, both run, and the same test suite runs against
both:

| | |
|---|---|
| **Before** | [`code/legacy/server.js`](../code/legacy/server.js) — `POST /api/orders`, 109 lines |
| **After** | [`code/refactored/src/`](../code/refactored/src/) — route, service, domain, repositories |
| **Proof it is safe** | [`checkout.contract.test.js`](../code/test/contract/checkout.contract.test.js) — 24 assertions, identical on both |
| **Proof it is better** | [`intended-differences.test.js`](../code/test/differences/intended-differences.test.js) — 17 assertions, each a defect |

```
npm test
# tests 45  pass 45  fail 0     unit + architecture
# tests 24  pass 24  fail 0     contract, run twice: legacy and refactored
# tests 17  pass 17  fail 0     intended differences
```

---

## 1. Before

`POST /api/orders`, as inherited. Comments removed; this is the code.

```js
app.post('/api/orders', async (req, res) => {
 try {
  console.log('[order] incoming', JSON.stringify(req.body));

  const { email, items, coupon, card } = req.body;

  if (!items) {
    return res.status(400).json({ error: 'no items' });
  }

  let subtotal = 0;
  const lines = [];
  for (const item of items) {
    const p = await db.get('SELECT * FROM products WHERE id = ' + item.productId);
    if (!p) {
      return res.status(400).json({ error: 'bad product' });
    }
    if (p.stock < item.qty) {
      return res.status(400).json({ error: 'out of stock: ' + p.name });
    }
    subtotal += p.price * item.qty;
    lines.push({ productId: p.id, name: p.name, qty: item.qty, price: p.price });
  }

  subtotal = Math.round(subtotal * 100) / 100;

  const shipping = subtotal >= FREE_SHIPPING_OVER ? 0 : SHIPPING_FEE;

  const preTax = subtotal + shipping;
  const tax = Math.round(preTax * TAX_RATE * 100) / 100;

  let discount = 0;
  if (coupon) {
    const c = await db.get("SELECT * FROM coupons WHERE code = '" + coupon + "' AND active = 1");
    if (c) {
      if (c.kind === 'percent') {
        discount = Math.round(subtotal * (c.value / 100) * 100) / 100;
      } else {
        discount = c.value;
      }
    }
  }

  const total = Math.round((preTax + tax - discount) * 100) / 100;

  const result = await db.run(
    'INSERT INTO orders (email, items, subtotal, discount, shipping, tax, total, coupon, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [email, JSON.stringify(lines), subtotal, discount, shipping, tax, total,
     coupon || null, 'paid', new Date().toISOString()],
  );

  for (const item of items) {
    await db.run(
      'UPDATE products SET stock = stock - ' + item.qty + ' WHERE id = ' + item.productId,
    );
  }

  if (card) {
    console.log('[order] charging card ending', String(card.number).slice(-4),
                'via', config.payments.secretKey);
  }

  await sendConfirmationEmail(email, result.lastInsertRowid, total);

  res.json({ id: result.lastInsertRowid, subtotal, discount, shipping, tax, total, status: 'paid' });
 } catch (e) {
  console.error(e);
  res.status(500).json({ error: e.message, stack: e.stack });
 }
});
```

It is not incompetent code. It is what one person under deadline pressure writes, and
then extends eleven times over four years. Every individual line is reasonable. The
problem is that there is nowhere else for any of it to go.

---

## 2. What is actually wrong with it

Not "it's long". Long is a symptom. Eight concrete defects, each of which follows from
the same cause — **there is no place in this codebase for a rule to live, so rules live
wherever they were first needed, and get copied when they are needed again.**

1. **Pricing is duplicated, and the copies disagree.** The same rules exist in
   `POST /api/quote`, written six months earlier, which subtracts the coupon *before*
   tax. This handler subtracts it *after*. Every coupon order charges the customer 18%
   of their discount extra.
2. **Money is floating point.** `Math.round(x * 100) / 100` is wrong whenever the float
   sits just below a half-paise boundary. `5.35 × 3 × 10%` gives ₹1.60; the answer is
   ₹1.61.
3. **Check-then-write across an await.** `SELECT stock` → `if` → `UPDATE`. Two
   concurrent orders both pass the check.
4. **No transaction.** The insert and each stock update are separate writes. A crash
   between them leaves an order with no stock movement, or the reverse.
5. **A third party is inside the request.** The confirmation email is awaited before
   responding. Provider down → 500 → customer retries → duplicate order, already paid.
6. **String-concatenated SQL.** The coupon field is a SQL console.
7. **No validation.** `qty: -5` produces a negative total and returns stock.
8. **Nothing is testable.** To assert anything about pricing you must start a web
   server and a database, POST a cart, and read a number out of a JSON body. So nobody
   does.

And the compounding one: **you cannot fix any of these in isolation.** Fixing the
pricing means editing a function that also writes to the database and sends email, and
there is no test to tell you whether you broke the other two.

---

## 3. The safety net, before touching anything

The first commit of this refactor contains no refactoring. It is
[24 assertions](../code/test/contract/checkout.contract.test.js) describing what the
system does today, written by observing it.

They are **black box, over HTTP, against the process**. Not a stylistic choice: the
inherited code has no seams. `server.js` opens a database at import time and does
everything else inside route handlers, so there is nothing to inject and nothing to
construct. The tests go at the highest level available, because it is the only level
that exists.

That constraint turns into the biggest advantage of the whole exercise:

```js
for (const target of TARGETS) {          // ['legacy', 'refactored']
  test(`contract [${target}]`, async (t) => {
    const app = await startTarget(target);
    ...
```

**The same file runs against both systems.** A test only the new code can pass proves
nothing about the migration. This one proves the two are interchangeable, which is
exactly the claim that has to be true before traffic moves.

Two assertions deliberately encode behaviour that is *wrong*:

```js
await t.test('checkout: rejects a basket larger than available stock', async () => {
  assert.equal(status, 400);        // 409 is the correct status. 400 is what we return.
  assert.equal(body.error, 'out of stock: Cold Brew Bottle');   // a string, not a code
});
```

That is the discipline. A characterization test records reality, including the parts
you dislike. Opinions go in the differences suite, one at a time, each with a decision
attached. Mixing the two is how a "pure refactor" quietly ships a behaviour change.

---

## 4. After

### The route — parse, delegate, map

```js
router.post('/orders', asyncRoute(async (req, res) => {
  const cart = parseCart(req.body, { requireEmail: true });
  const result = await checkoutService.placeOrder(cart);
  req.log.info('order placed', {
    orderId: result.orderId, publicId: result.publicId, totalMinor: result.priced.totalMinor,
  });
  res.status(200).json(toOrderCreated(result));
}));
```

No arithmetic, no SQL, no `try`/`catch`, no branching on business rules. Errors are
thrown where they are detected and translated once, centrally. A handler that grows a
fourth responsibility is the review comment.
→ [`checkout.routes.js`](../code/refactored/src/http/routes/checkout.routes.js)

### The domain — pure, and the only place prices are decided

```js
function priceOrder({ lines, coupon = null, policy }) {
  const pricedLines = lines.map((line) => {
    assertMinor(line.unitPriceMinor);
    if (!Number.isSafeInteger(line.qty) || line.qty <= 0) throw new TypeError(...);
    return { ...line, lineTotalMinor: line.unitPriceMinor * line.qty };
  });

  const subtotalMinor = pricedLines.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  const discountMinor = discountFor(subtotalMinor, coupon);
  const shippingMinor = subtotalMinor >= policy.freeShippingThresholdMinor
    ? 0 : policy.shippingFeeMinor;

  const taxableMinor = subtotalMinor - discountMinor + shippingMinor;
  const taxMinor     = applyBasisPoints(taxableMinor, policy.taxBasisPoints);

  return { lines: pricedLines, subtotalMinor, discountMinor, shippingMinor, taxMinor,
           totalMinor: taxableMinor + taxMinor };
}
```

No database, no express, no clock, no configuration lookup. Everything arrives as an
argument. Integers throughout — the rounding decision happens once, explicitly, in
`applyBasisPoints`, instead of eleven times implicitly in `Math.round`.
→ [`pricing.js`](../code/refactored/src/domain/pricing.js) ·
[`money.js`](../code/refactored/src/domain/money.js)

### The service — owns what is atomic with what

```js
async function placeOrder({ email, items, couponCode }) {
  const { priced, coupon } = await buildPricedOrder({ items, couponCode });
  const publicId = newPublicId();
  const now = clock();

  const orderId = await db.transaction((tx) => {
    for (const line of priced.lines) {
      const reserved = productRepo.reserveStockInTx(tx, line.productId, line.qty);
      if (!reserved) {
        const current = productRepo.findByIdInTx(tx, line.productId);
        throw new OutOfStockError(line.name, line.qty, current ? current.stock : 0);
      }
    }
    const id = orderRepo.insertInTx(tx, { publicId, email, status: 'paid', createdAt: now,
                                          couponCode: coupon?.code ?? null, ...priced });
    outboxRepo.enqueueInTx(tx, { topic: 'order.confirmation_email',
                                 payload: { orderId: id, publicId, email,
                                            totalMinor: priced.totalMinor }, now });
    return id;
  });

  return { orderId, publicId, priced, createdAt: now };
}
```

Everything that must be all-or-nothing is inside the transaction, and nothing that must
not be. `db.transaction()` **throws if its callback returns a promise** — the rule "no
I/O inside a transaction" is enforced by the code rather than remembered by the author.
→ [`checkout.service.js`](../code/refactored/src/services/checkout.service.js) ·
[`connection.js`](../code/refactored/src/db/connection.js)

### The repository — the guard is in the WHERE clause

```js
reserveStockInTx(tx, productId, qty) {
  const result = tx.run(
    'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
    [qty, productId, qty],
  );
  return result.changes === 1;
}
```

The check and the write are one statement the database serialises. This is correct on
SQLite, on Postgres, and on anything else — it does not depend on the driver being
synchronous or on the application being single-threaded.
→ [`product.repo.js`](../code/refactored/src/repositories/product.repo.js)

---

## 5. What improved

Each row is asserted in the test suite; nothing here is a claim about how the code
feels.

| Before | After | Defect removed | Evidence |
|---|---|---|---|
| Pricing written twice, in two handlers | One `priceOrder()`, called by both | Quote ≠ charge on **every** coupon order | Matrix test: 30 carts, 0 divergences after, 100% of coupon carts before |
| `price REAL`, `Math.round(x*100)/100` | Integer paise, explicit half-up | ₹1.60 where ₹1.61 was owed | `applyBasisPoints(1605, 1000) === 161` |
| `SELECT stock` → `if` → `UPDATE` | Guarded atomic `UPDATE`, checked `changes` | Oversell: stock reached **−2** | Two concurrent checkouts: 2 accepted before, 1 before/1 rejected after |
| Five independent writes | One transaction | Half-applied orders | `transaction()` rejects async callbacks |
| `await sendEmail()` in the request | Outbox row committed with the order, worker after | 500 + duplicate orders on a provider blip | Provider fails → HTTP 200, order intact, retry recorded |
| Coupon concatenated into SQL | Bound parameter + input allowlist | `X' OR kind='fixed' --` → free ₹50 | Exploit works before, 400 after |
| No validation | Parsed at the edge, all errors at once | `qty: -5` paid the customer and restocked | 200 + negative total before, 400 after |
| `SELECT *` to the browser | Explicit DTO | Cost price and supplier published publicly | Response keys asserted exactly |
| `{ error, stack }` on failure | Generic message + request id; stack to the log | Stack traces and internal IPs to customers | No response carries `stack` |
| `console.log(req.body)` | Central redaction denylist | Card numbers in four years of logs | `card`/`cvc`/`password` → `[redacted]` |
| Secrets in `config.json` | Env, validated at boot | Five live credentials in git | Boots without them → exit 78, `EX_CONFIG` |
| Sequential order ids, no authz | Unguessable public id | `/api/orders/41` leaked any order | 200 before, 404 after; token holder still 200 |

### And the thing that is hardest to put in a table

**Before:** to assert anything about pricing you started a web server and a database.
There were zero unit tests and there was no way to write one.

**After:** `pricing.test.js` checks **8,000+ price combinations** — every coupon type,
quantities 1–5, the full realistic price range — asserting that totals are integers,
never negative, that discounts never exceed the goods, and that the breakdown always
adds up. It runs in **under 40 milliseconds**, with no server, no database, no fixture
file and no mock.

That is the actual return on pulling logic out of a route handler. Not elegance —
**the ability to ask questions cheaply.** The team can now answer "what happens if a
coupon is worth more than the basket" in thirty seconds instead of by reasoning about
it in a meeting.

### Size

| | Lines of code |
|---|---|
| Legacy checkout handler | **74** (109 with comments) |
| Route handler | 6 |
| Validation | 57 (shared with quote) |
| Service | 76 (three methods) |
| Pricing + money domain | 72 (shared with quote, refunds, admin, imports) |

Total is larger. That is the correct outcome and worth being explicit about: **the
refactor did not make the code smaller, it made it addressable.** 74 lines that can
only be executed by an HTTP request became five units that can each be executed in
isolation, three of which are now reused by other endpoints instead of copied into
them.

---

## 6. Three decisions worth defending

**Preserving errors that are wrong.** `OutOfStockError` returns HTTP 400 with the
string `out of stock: Cold Brew Bottle`. 409 with a structured body is correct. But
two integrations parse that string, and being right is not worth breaking someone
else's production at 2am. Every domain error carries both a `legacyMessage` and a
machine-readable `code`; the correct statuses ship behind a versioned `Accept` header
and become the default when the logs show the old shape is unused.
→ [`errors.js`](../code/refactored/src/domain/errors.js)

**Emitting money twice.** Responses carry both the decimal `total: 470.82` the
storefront already parses and the exact `totalMinor: 47082` new clients should use.
Additive, so no coordinated release with three integrators; the decimals get deprecated
on evidence rather than on a date.
→ [`dto.js`](../code/refactored/src/http/dto.js)

**Not making the domain clever.** `priceOrder` is a flat function with six steps and no
strategy pattern, no rule engine and no plugin registry. It handles two coupon kinds
because there are two coupon kinds. When a third arrives it will be an `if`; when the
sixth arrives, that is the moment to design an abstraction — with five real examples
to design against rather than an imagined future.

---

## 7. What I did not change

- **The URLs, the request shapes, and the response fields.** Every existing client
  keeps working.
- **`GET /api/quote` internals** — not yet. It gets deleted and re-pointed at
  `checkoutService.quote()` in the same PR series, but as a separate commit, so the
  diff for each is reviewable.
- **express.** Not the problem.
- **The variable names in the parts of `server.js` I did not touch.** Tempting; adds
  diff noise; costs review attention that should go to the money code.

---

## 8. How this ships

Not as one pull request. Six, each independently deployable and independently
revertible:

1. Contract tests, against the legacy system, no production change
2. `domain/` and `repositories/`, unreferenced by any route
3. `checkoutService`, unreferenced, unit tested
4. v2 route behind `ORDERS_V2=0` — dead code in production
5. Shadow mode: both run, legacy served, diffs logged
6. Ramp 1% → 10% → 50% → 100%, then **delete the legacy handler**

Step 6's deletion ticket is written at the same time as step 1. A strangler migration
that never removes the old code leaves two systems instead of one.

Full sequence, with abort criteria at each stage:
[Migration plan §3](02-migration-plan.md#3-month-1--the-first-seam-and-the-money).

---

**Next:** [Engineering standards →](04-standards.md)
