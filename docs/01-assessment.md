# Assessment — OrderDesk

**What this is:** an engineering assessment of an inherited production system, the
order in which I would fix it, and what it costs to leave each thing alone.

**The system:** OrderDesk is the checkout and order API behind a direct-to-consumer
coffee retailer. Four years old, written by one developer who has since left, kept
running by three engineers who did not write it. Roughly 40,000 orders a month. It
works. Customers are being served right now, and they will be served during
everything described here.

**The constraint that shapes every decision below:** it cannot go down. That rules out
a rewrite, rules out a freeze, and rules out any change I cannot reverse in minutes.

> **On the numbers.** Figures like "12% of orders use a coupon" are the estimates I
> would put in front of a CEO on day two, each derivable from a single query. Week 1
> replaces every estimate with the real figure. Where a number is load-bearing I have
> said what query produces it.

---

## 1. Before I change anything

The first instinct with a codebase like this is to start fixing it. That instinct is
wrong, and acting on it is how a new hire causes their first outage in week one. Two
days of the following is the highest-value work available:

- **Read the incident history.** Every outage, every "can you just fix this" Slack
  thread, every rolled-back deploy. What breaks tells you where the system is thin
  far faster than reading source does.
- **Watch a deploy.** Not a description of a deploy — an actual one, over someone's
  shoulder, with a stopwatch. How long, how many manual steps, what happens when it
  goes wrong, who is allowed to do it.
- **Sit with support for two hours.** Support knows every defect in the product. They
  have workarounds for bugs nobody has ever written down. "Oh, we just tell them to
  refresh" is a bug report.
- **Find the money path.** In this system it is: product page → cart → quote →
  checkout → confirmation email. Everything else can break for an hour and cost
  goodwill. This breaks and it costs revenue.
- **Ask each engineer, separately: what are you afraid to touch?** The answers map the
  fragility better than any static analysis, and they tell you who has been carrying
  what.
- **Find out what happened last time someone tried to improve things.** There is
  almost always a previous attempt. Knowing why it stalled is the difference between
  a plan that gets adopted and a plan that gets nodded at. See
  [Standards](04-standards.md#1-resistance-is-information).

I would also confirm, in writing, one thing with the business before touching the
pricing code: **which of the two conflicting price calculations is correct.** That is
not an engineering decision, and I explain why under COR-3.

---

## 2. How I ranked it

Four rules, applied in this order. They are not scored on a matrix; when two issues
compete, the earlier rule wins.

**Rule 1 — Irreversible beats expensive.** A leaked credential cannot be un-leaked. An
unverified backup cannot be restored retroactively. Data corrupted silently for a
month is not recoverable by fixing the bug that caused it. These come first even when
something else is costing more money today, because everything else can still be fixed
tomorrow at the same price.

**Rule 2 — You cannot safely change what you cannot observe or verify.** Tests,
logging, error tracking and a working rollback are not "quality work" competing with
the real fixes. They are the equipment the real fixes require. Doing structural work
before them is not faster; it is the same work done blind.

**Rule 3 — Bleeding beats aching.** An active, ongoing loss — money leaving the
business on every coupon order, stock being oversold every week — outranks a chronic
condition that makes engineering slow. Fat route handlers cost a fortune over a year
and cost nothing this afternoon.

**Rule 4 — Success makes it worse.** Prefer fixing issues that get more dangerous as
traffic grows. The oversell race is invisible at 10 orders an hour and constant at
500. Fixing it at the current volume is cheap; fixing it after a campaign is an
incident with a customer-service tail.

**One thing that is explicitly not a rule: how bad the code makes me feel.** The
ugliest code in this repository is not on this list, because it works, it is not on
the money path, and nobody needs to change it.

---

## 3. The register

Severity is *impact if it happens*; Likelihood is *chance in the next 90 days at
current volume*. "Order" is the tier it belongs to, not a strict sequence — everything
inside a tier can run in parallel across three engineers.

| ID | Issue | Severity | Likelihood | Effort | Order |
|----|-------|----------|-----------|--------|-------|
| **SEC-1** | Live credentials committed to the repository | Critical | **Already happened** | 1 day | T0 |
| **OPS-1** | Backups never restore-tested | Critical | Low | 1 day | T0 |
| **SEC-2** | Frontend executes SQL via `POST /db/sql`; admin key in the client bundle | Critical | High | 2 days | T0 |
| **OBS-1** | No error tracking, no structured logs, no alerting | High | **Continuous** | 2 days | T0 |
| **SEC-3** | SQL injection via the coupon field | Critical | Medium | ½ day | T0 |
| **OPS-2** | No safe deploy path: manual, no staging, no tested rollback | High | High | 3 days | T1 |
| **TST-1** | No tests, no CI | High | **Continuous** | 3 days | T1 |
| **COR-3** | Quote and checkout compute different prices | High | **Continuous** | 3 days | T2 |
| **COR-1** | Money stored and computed in floating point | High | **Continuous** | 5 days | T2 |
| **COR-2** | No transactions; check-then-write stock race | High | High | 3 days | T2 |
| **REL-1** | Email sent synchronously inside checkout | High | Medium | 3 days | T2 |
| **ARC-2** | No input validation anywhere | High | High | 2 days | T2 |
| **SEC-5** | Sequential order IDs, no authorisation on order lookup | High | Medium | 2 days | T2 |
| **ARC-1** | Business logic inside route handlers | Medium | **Continuous** | Ongoing | T2 |
| **SEC-4** | Card data and PII written to application logs | High | **Already happened** | 1 day | T1 |
| **SEC-6** | Shared admin key, passed in the query string | Medium | Medium | 1 day | T2 |
| **OPS-3** | Application connects to Postgres as a superuser | Medium | Low | 1 day | T3 |
| **DB-1** | Schema created at boot; no migration history | Medium | Medium | 2 days | T3 |
| **PERF-1** | N+1 product queries per cart; no indexes beyond primary keys | Medium | Medium | 3 days | T3 |
| **DEP-1** | Dependencies unpinned and years stale | Medium | Medium | Ongoing | T3 |
| **ORG-1** | Bus factor of one on deployment; no runbook | High | Medium | 2 days | T3 |

### What each one costs if we leave it

**SEC-1 — Credentials in the repository.**
`config.json` contains the database password, the SMTP password, a live payment
secret key and the admin key. Anyone who has ever cloned the repository has them
permanently — contractors, ex-employees, anyone with a laptop backup. **The exposure
is not a risk, it is a state that already exists**, and every day it continues the
window widens. Leaving it: an ex-contractor with a grudge, or one leaked laptop, can
read every customer record, send mail as the company, and move money. Deleting the
file changes nothing; git keeps history and the credentials remain valid. *The fix is
rotation.* Scrubbing history is housekeeping that happens afterwards.
→ *This is number one purely because of Rule 1: it is the only item where the damage
accrues while you plan.*

**OPS-1 — Backups never restore-tested.**
The managed database has nightly snapshots. Nobody has ever restored one. An untested
backup is a hypothesis. Leaving it: the one failure that ends the company instead of
inconveniencing it. It shares tier 0 with SEC-1 because it is one day of work and it
is the difference between a bad week and no company.

**SEC-2 — The browser sends SQL to the server.**
`POST /db/sql` accepts a SQL string from the client and runs it. It was added in 2021
so the storefront could show stock levels without waiting for an API change. Every
visitor has a database console — `SELECT * FROM orders` returns every customer's email
and order history, and `DROP TABLE` is spelled the same way it always is. The admin key
is also sitting in the page source. Leaving it: total data compromise, on a timescale
set by whoever looks first. This is a two-day fix — two read endpoints the storefront
already needs — and until it ships, nothing else on this list matters.
→ *Demonstrated in [`intended-differences.test.js`](../code/test/differences/intended-differences.test.js)
under `SEC-2`.*

**OBS-1 — Nothing is watched.**
No error tracker, no structured logs, no uptime check, no alert. Outages are reported
by customers on Instagram. There is no way to answer "is this happening to everyone or
just them", "when did it start", or — critically — "did my change make it worse".
Leaving it: unbounded time-to-detection, and no evidence base for any decision after
today. This is tier 0 not because it is urgent on its own but because of Rule 2:
**it is the instrument panel for every other fix on this list.** Doing COR-1 without it
means changing money code and finding out whether it worked from the monthly accounts.

**SEC-3 — SQL injection in the coupon field.**
The coupon code is concatenated into the query. `X' OR kind='fixed' --` yields ₹50 off
with no valid code, and the same hole reads any table. Half a day to fix (bind the
parameter), so it goes in tier 0 on effort alone.
→ *Proven, with a working exploit, in the differences suite.*

**SEC-4 — Card data in the logs.**
The checkout handler opens with `console.log(JSON.stringify(req.body))`, and the body
contains the card object. Four years of card numbers and customer PII are in the
hosting provider's log retention. Like SEC-1, the damage is historical as well as
ongoing: stopping the logging does not unlog it. Tier 1 rather than tier 0 only
because stopping the write is a one-line change bundled with the logging work, and the
cleanup (log purge, retention policy, and a call with whoever owns PCI compliance) is
a conversation, not a code change.

**OPS-2 — No safe deploy path.**
Deployment is ssh, `git pull`, `pm2 restart`. No staging, no versioned artefacts, no
rollback beyond `git revert` and doing it again. Leaving it: every fix on this list is
a gamble, so the team quite reasonably batches changes to reduce the number of
gambles, which makes each one bigger and more dangerous. **This is the root cause of
the fear, and fear is why the codebase looks like this.** Nothing else in the plan is
safe to attempt at speed until deploying is boring.

**TST-1 — No tests.**
Zero. Every change is verified by clicking through the site. Leaving it: refactoring
is impossible, because refactoring means "change the code without changing the
behaviour" and there is no way to know whether the behaviour changed. The team's
reluctance to touch things is not conservatism — **it is a correct assessment of their
tooling.**

**COR-3 — Quote and checkout disagree.**
`POST /api/quote` subtracts the coupon before tax. `POST /api/orders` subtracts it
after. The difference is exactly 18% of the discount, and the customer pays it. On a
₹50 coupon that is ₹9.00 — the customer is shown 470.82 and charged 479.82.

This is the item I would take to the CEO on day two, because it is not primarily an
engineering problem:
- Customers are charged more than they were quoted, on **every coupon order**. At an
  estimated 12% coupon usage and ~₹180 average discount, that is roughly **₹155,000 a
  month** collected in error, and a refund liability going back three years. *(Real
  figure: one query joining orders to coupons.)*
- Charging tax on a discount the customer received is not a rounding quirk. Every
  affected invoice is wrong.
- It is invisible without comparing two screens, which is why it survived three years.

**And there is a decision here that is not mine to make.** When two code paths
disagree, "preserve existing behaviour" is not an available option — there are two
existing behaviours. Someone in finance has to say which one is correct, and someone
in leadership has to decide what happens about the three years of invoices. My job is
to make the question unambiguous, cheap to answer, and impossible to recreate.
→ *The matrix test proves that the inherited system diverges on 100% of coupon carts
and 0% of non-coupon carts — which is exactly why nobody noticed.*

**COR-1 — Money in floating point.**
Prices are `REAL` in the database and rounded with `Math.round(x * 100) / 100`, which
is wrong whenever the float sits just under a half-paise boundary. Three filter
coffees at ₹5.35 discount by ₹1.60 instead of ₹1.61. A sweep of realistic
price × quantity × coupon combinations finds **6,211 divergent cases**. Leaving it:
the ledger never quite balances, reconciliation stays a manual monthly chore that
someone quietly absorbs, and each wrong row is written permanently. Worse than the
error is the *class* of error — silent, small, cumulative, and impossible to
distinguish from a data-entry mistake after the fact.

**COR-2 — No transactions, and a stock race.**
Checkout writes the order row and then updates stock in separate statements, with no
transaction. It also does `SELECT stock` → `if (stock >= qty)` → `UPDATE`, with an
await in the middle. Two concurrent orders for the last four bottles both pass the
check and both decrement. Leaving it: overselling that support absorbs manually,
inventory nobody trusts, and orders that are half-written when a process restarts.
Rule 4 applies hard — this is a Tuesday-afternoon curiosity now and a permanent state
of affairs the first time a campaign lands.
→ *The differences suite drives two concurrent checkouts against the inherited system
and asserts stock ends at **−2**.*

**REL-1 — The mail provider is inside the checkout transaction.**
`await sendConfirmationEmail(...)` runs after the order is committed and the card is
charged, inside the request. When the provider has a bad afternoon the customer gets
a 500 — with a stack trace — for an order that already exists and has already been
paid for. **So they order again.** Leaving it: the third-party's availability is
multiplied into ours, and every provider blip generates duplicate orders and refund
work.

**ARC-2 — No input validation.**
`qty: -5` is accepted: it produces a negative total and *returns five mugs to stock*.
Leaving it: an open till. This is cheap to fix and belongs with the extraction work
because that is where the boundary gets a name.

**SEC-5 — Order IDs are sequential and unauthenticated.**
`GET /api/orders/41` returns order 41 to anybody, including the customer's email and
what they bought. Enumerable, so "anybody" means "one short script". Leaving it: a
bulk customer-data leak that requires no skill, and a disclosure obligation when it
happens.

**ARC-1 — Business logic in route handlers.**
The checkout handler is 118 lines of validation, pricing, stock, persistence, payment
and email. This is the headline complaint about the codebase and it is deliberately
*not* near the top of the list, because on its own it costs nothing today. It matters
because it is the **mechanism** behind COR-3, COR-2, ARC-2 and REL-1: logic with
nowhere to live gets copied, and copies drift. Fixing the four defects properly means
fixing this, which is the right order — the structure improves as a consequence of
fixing something that pays for itself, not as a line item nobody can justify.

**ORG-1 — One person can deploy.**
Not a code issue and a genuine business risk. Leaving it: the system is unmaintainable
for the fortnight that person is on holiday.

### Deliberately not on this list

Restraint is a plan too. Each of these is a real improvement, and each would consume
the credibility needed to do the things above.

| Not doing | Why not |
|---|---|
| Rewriting the app | It works, it earns money, and a rewrite means running two systems while shipping nothing for six months. Rewrites of systems nobody fully understands are how companies die. |
| Migrating to TypeScript | Defensible, and it is a whole-codebase change touching every file during the exact quarter I need clean, reviewable diffs. Revisit in Q2, gradually, with `checkJs` and JSDoc. See [Standards §6](04-standards.md#6-what-i-am-not-proposing-yet). |
| Splitting into services | The problem is that the code has no internal boundaries. Adding network calls between the same tangle makes it a distributed tangle. Modules first; if the module boundaries hold for six months, then talk. |
| Reformatting the codebase | Destroys `git blame` on the only archaeology available. When it happens: one commit, tool-generated, added to `.git-blame-ignore-revs`. |
| Replacing express | It is not the problem. |
| Chasing 80% coverage | A number, not a goal. Cover the money paths and ratchet from there. See [Standards §3](04-standards.md#3-testing-standards). |
| Renaming things for taste | Real cost, no revenue, and it reads to the team as criticism of people rather than of code. |

---

## 4. What I need from the business

Engineering cannot decide these, and the plan stalls without them.

1. **Which pricing rule is correct?** (COR-3.) Finance, in writing, this week.
2. **What happens about three years of incorrect invoices?** Leadership and whoever
   advises on tax. Engineering can produce the affected list in a day; the remedy is
   not our call.
3. **Who owns PCI compliance,** and do they know card numbers are in the logs? (SEC-4.)
4. **What fraction of engineering time do we get?** My plan assumes 30–40%, sustained.
   Not a freeze — a freeze is how these efforts get cancelled in week three when a
   customer escalates. See [Migration plan §1](02-migration-plan.md#1-the-rules-this-plan-obeys).
5. **What is the acceptable blast radius for a mistake?** It determines how fast the
   canary ramps. I would propose: no change may put more than 1% of orders at risk for
   more than 10 minutes.

---

## 5. What "fixed" looks like

Success criteria, so this can be marked honestly at the end of the quarter.

| Measure | Today | End of Q1 |
|---|---|---|
| Time to detect a checkout outage | Hours, via customers | Under 5 minutes, via alert |
| Time to roll back a bad deploy | 30+ minutes, manual | Under 5 minutes, one command |
| Deploy frequency | Weekly, feared | Daily, boring |
| Change failure rate | Unknown | Measured, under 15% |
| Quote/charge disagreements | Every coupon order | Zero, enforced by test |
| Credentials in the repository | 5 | 0, enforced by CI |
| Test coverage of the money path | 0% | Contract + unit, in CI on every push |
| Engineers who can deploy safely | 1 | All of them |
| Engineers who will touch checkout | 0 | All of them |

The last row is the one I would actually judge it on.

---

**Next:** [Migration plan →](02-migration-plan.md)
