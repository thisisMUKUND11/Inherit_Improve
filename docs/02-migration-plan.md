# Migration plan — OrderDesk

A phased plan to get from the system described in the [assessment](01-assessment.md)
to a maintainable one, without a rewrite, without a freeze, and without an outage.

**Shape of it:** strangler fig, at the route level. The new code grows inside the old
application, one endpoint at a time. Both implementations run in the same process
behind a flag. Traffic moves gradually. The old path is deleted only once the new one
has carried 100% of production traffic for a full week.

At no point are there two systems to keep in sync, and at no point is there a
"switchover day".

---

## 1. The rules this plan obeys

**Capacity is 30–40%, not 100%.** Three engineers, and feature work continues
throughout — that is not a compromise, it is the condition that makes the plan
survivable. A freeze puts the whole effort on the chopping block the first time a
customer escalates. Concretely: one engineer on migration work at any time, rotating,
plus everyone applying the *touch-it-improve-it* rule to feature work. **The rotation
is not fairness, it is the adoption strategy** — by the end of Q1 all three have done
it, and the pattern is not mine any more.

**Every week ends deployable.** No long-lived branches, no "we'll integrate in
February". Work merges to `main` behind a flag, dark, as often as it compiles.

**Nothing ships without a way back.** Every phase names its rollback, and the rollback
is *executed at least once on purpose* before it is needed. An untested rollback is
the same hypothesis as an untested backup.

**Database changes are expand/contract, always.** Deploys overlap; old and new code
run simultaneously for at least a few minutes, and during a canary for days. Any
migration a running instance of the previous version cannot tolerate is forbidden.
No column is renamed. No column is dropped in the same release that stops using it.

**Deletion is in the plan.** A strangler migration that never removes the old code
leaves you with two systems and twice the work. Every migration ticket has a paired
deletion ticket, scheduled, in the same epic. **Not deleting is the most common way
this pattern fails.**

**Behaviour changes are separated from structural changes.** Never in the same
release. When something breaks after a deploy that did both, you cannot tell which
half did it. See §5.

---

## 2. Week 1 — stop the bleeding, build the instruments

No refactoring this week. One code change, and it is a security stop-loss.

### Day 1 — Credentials

- Rotate every credential in `config.json`: database password, SMTP, payment secret,
  admin key. **Rotate first, tidy later** — new values into the secret store, old ones
  revoked at the provider. That is what ends the exposure.
- Move configuration to environment variables with startup validation, so a missing
  value is a boot failure with a clear message instead of `undefined` reaching the
  payment provider. → [`config/env.js`](../code/refactored/src/config/env.js)
- Pull the provider access logs for the exposure window and look for use from
  addresses we do not recognise. Assume compromise until the logs say otherwise.
- Add `gitleaks` to CI and to a pre-commit hook. CI alone is too late: by the time CI
  runs, the secret is pushed. → [`scan-secrets.js`](../code/tools/scan-secrets.js)
- Schedule the history scrub (`git-filter-repo`) for the weekend. It rewrites every
  hash and needs everyone to re-clone, so it waits for a quiet moment. It is also
  optional — rotation is the fix.

*Rollback: none needed; rotation is additive. Old credentials stay revoked.*

### Day 1–2 — Prove the backups

- Restore last night's snapshot into a scratch database. Time it. Write down the
  number and the steps.
- Verify row counts and the last order timestamp against production.
- Publish the restore runbook. Put the timing in it, because "how long until we are
  back" is the first question anyone will ask.
- Schedule this as a recurring monthly exercise with a named owner.

*Deliverable: a restore we have actually done, and a number we can quote.*

### Day 2 — Instruments

- Error tracking (Sentry or equivalent), wired to a channel a human reads.
- Structured JSON request logs with a request id, **and redaction on the way out** —
  the denylist is applied centrally, not remembered at each call site. This also
  closes SEC-4. → [`logger.js`](../code/refactored/src/observability/logger.js)
- One dashboard, four numbers: error rate, p95 latency, **orders per minute**, and
  outbox depth once it exists. Orders per minute is the important one: it is the
  metric that tells you a deploy broke money, and it does it in 60 seconds rather
  than at month end.
- Two alerts and only two, so that an alert still means something:
  orders/minute drops below 40% of the same hour last week; 5xx rate above 1% for
  5 minutes.
- Uptime check against `/health/ready` from outside the network.

### Day 3 — Close the two open doors

The only code change of the week.

- Delete `POST /db/sql`. Replace with `GET /api/products` returning the fields the
  storefront actually renders — cost price and supplier are not among them.
- Remove the admin key from the client bundle; move admin auth to a header, from the
  environment, compared in constant time.
- Bind the coupon parameter (SEC-3). One line, and it closes the injection.

*Rollback: single revert, behind `LEGACY_SQL_ENDPOINT=on` for 48 hours in case an
internal tool nobody mentioned was using it. Flag deleted on day 5.*

### Day 3–4 — A path to production

- CI pipeline: install, secret scan, lint, test. It runs on every push from the first
  day, when there are three tests, because a pipeline introduced later is a pipeline
  people argue about. → [`ci.yml`](../.github/workflows/ci.yml)
- Branch protection on `main`: CI green, one review.
- A staging environment that is a real deploy of the same artefact.
- One-command deploy and one-command rollback. **Then roll back a real deploy on
  purpose, in the afternoon, with everyone watching.** Nobody trusts a rollback they
  have not seen work.

### Day 5 — The safety net starts

- Write the first characterization tests around checkout: the current behaviour,
  recorded as it is, including the bits that are wrong.
- Publish the **known-wrong behaviours** list alongside them, so nobody "fixes" a
  test that is deliberately encoding a defect.
- Add the flag mechanism (environment-driven, percentage-based) with no consumers yet.

→ [`checkout.contract.test.js`](../code/test/contract/checkout.contract.test.js)

### Week 1 exit criteria

Every one of these is a yes/no that someone can check:

- [ ] Every credential rotated; old ones revoked; secret scanning blocks commits
- [ ] A database restore performed, timed, documented
- [ ] Errors visible in a tool; two alerts live; one fired in a drill
- [ ] `POST /db/sql` gone; admin key out of the client; coupon parameter bound
- [ ] CI green on `main`; a deploy rolled back on purpose
- [ ] Characterization tests running on the checkout path

**What has not happened:** no refactoring, no restructuring, no architecture. The
codebase is exactly as ugly as it was on Monday and dramatically less dangerous. That
distinction is the whole point of the week, and it is worth saying out loud to a team
that expects the new person to arrive and start rearranging furniture.

---

## 3. Month 1 — the first seam, and the money

### Week 2 — Build the seam, dark

Introduce the target structure *alongside* the existing handler, not in place of it:

```
src/
  domain/        pricing, money        pure, no I/O, exhaustively testable
  services/      checkout, catalog     use cases, own the transaction boundary
  repositories/  product, coupon...    all SQL, bound parameters only
  http/          routes, validation    parse, delegate, map. nothing else
```

Extract **one** endpoint end to end — `POST /api/orders`, the highest-value and
highest-risk one — as the reference implementation. Ship it behind `ORDERS_V2` at 0%.
Nothing changes for anyone.

The detailed before/after is [deliverable 3](03-refactor.md).

*Why the riskiest one first: it is the one that pays for the effort, it is the one the
team most needs to see done safely, and the pattern it establishes has to survive
contact with the hardest case. A reference implementation extracted from an easy
endpoint teaches nothing about the hard ones.*

### Week 2–3 — Shadow, then ramp

**Shadow mode.** For every checkout, run both implementations, serve the legacy
result, and log a structured diff when they disagree. Real traffic, real carts, real
coupons, zero customer risk.

Expect diffs. They fall into three buckets:

| Bucket | Action |
|---|---|
| We got it wrong | Fix v2. Most diffs, first two days. |
| Legacy is wrong and we intended to fix it | Add to the intended-differences list, with a decision attached |
| Legacy is wrong and we did *not* know | Stop. This is a new discovery — take it to the business. |

The third bucket is why shadow mode earns its cost. It finds the defects the
assessment missed, at zero risk, before anyone depends on the new answer.

**Ramp** once the only remaining diffs are the intended ones:

| Stage | Traffic | Hold | Abort if |
|---|---|---|---|
| 1 | 1% | 24h | any unintended diff; error rate up at all |
| 2 | 10% | 24h | orders/minute down >2% vs control; p95 up >20% |
| 3 | 50% | 48h | same, plus any support ticket mentioning price |
| 4 | 100% | 1 week | same |

*Rollback at every stage: set the flag to 0%. Effective in seconds, no deploy. This is
why the flag is environment-driven and not a code constant.*

Delete the legacy handler at the end of the 100% week. **Ticket already written,
already in the sprint.**

### Week 3 — Money, via expand/contract

The database stores prices as `REAL`. Fixing that is a data migration on a live table,
so it is six releases, not one. This sequence is the plan's answer to "how do you
change the shape of production without stopping it":

1. **Expand.** Add `price_minor INTEGER` (nullable). Deploy. Nothing reads it. Old
   code is entirely unaffected — it does not know the column exists.
2. **Dual-write.** New writes populate both `price` and `price_minor`. Deploy. Reads
   still come from `price`.
3. **Backfill.** Batched, throttled, resumable, off-peak. Runs as a script with a
   progress log, not a single `UPDATE` holding a lock on a live table.
4. **Reconcile.** A scheduled job asserts `price_minor = ROUND(price * 100)` for every
   row and alerts on any mismatch. Let it run clean for 48 hours. **This step is
   non-negotiable and it is the one people skip.**
5. **Contract, part one.** Reads switch to `price_minor`, behind its own flag, ramped
   like any other change. Writes still populate both.
6. **Contract, part two.** Two weeks later, with reconciliation still clean: stop
   writing `price`, then drop it in a subsequent release.

Every step is independently deployable and independently reversible. At no point does
a running instance of the previous release encounter a schema it cannot handle.

Same pattern for `orders`, where it matters more: those rows are financial records.

*The wire format does not change here.* Responses keep the decimal fields and **gain**
exact `*_minor` integers alongside. Clients migrate when they migrate; the decimals get
deprecated once the access logs show nobody reads them.
→ [`dto.js`](../code/refactored/src/http/dto.js)

### Week 3–4 — Transactions, stock, and the outbox

- Wrap the order write and the stock decrements in one transaction.
- Replace check-then-write with an atomic guarded update:
  `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`, checking
  `changes`. Correct on any database, including ones with genuine parallelism.
- Introduce the outbox table. The confirmation email becomes a row committed with the
  order, dispatched by a worker afterwards, with retries and backoff.
- Backfill safety: a one-off report of every product with negative stock, for support
  to work through. **The fix stops new occurrences; it does not clean up the old ones,
  and pretending otherwise is how a "fixed" bug reappears as a support complaint.**

*Rollback: the outbox worker is a separate process. Stopping it queues messages rather
than losing them — the failure mode is delay, which is the point.*

### Week 4 — Hand it over

- A **second** engineer extracts the next endpoint, using week 2's work as the
  template. I review; I do not write it.
- Their questions become the seam documentation, because their questions are the ones
  the next person will have.
- Retro on the pattern. Change it based on what they found awkward. **If the pattern
  only works when I do it, it is not a pattern, it is a preference.**

### Month 1 exit criteria

- [ ] Checkout fully on v2 at 100%; legacy checkout handler **deleted**
- [ ] Quote and checkout share one pricing function — divergence structurally impossible
- [ ] Money is integer minor units end to end; reconciliation clean for two weeks
- [ ] Stock cannot go negative; proven by a concurrency test in CI
- [ ] Confirmation emails survive a provider outage
- [ ] A second engineer has migrated an endpoint alone
- [ ] Deploys are daily and unremarkable

---

## 4. Quarter 1 — finish it, and make it not need me

### Month 2 — Volume, and the platform underneath

**Endpoint migration at ~2 per week, done by the team.** My role is review. The
remaining endpoints are simpler than checkout; the pattern is established; the
interesting decisions are made.

Running alongside:

- **Database hardening.** Application connects as a least-privilege role, not a
  superuser. Connection pooling with sensible limits. Indexes chosen from the actual
  slow query log rather than intuition. Fix the N+1 in cart pricing — visible in the
  logs now that there are logs.
- **Authentication.** Per-user admin accounts with an audit trail, replacing the shared
  key. Sequential order ids replaced by unguessable public ids (see §5).
- **Frontend.** A typed API client generated from the OpenAPI description, so a
  breaking change fails a build instead of a checkout. The storefront stops knowing
  anything about the database.
- **Dependencies.** Lockfile committed, automated update PRs, a standing 2-hour Friday
  slot to merge them. Little and often, so it never becomes a project.
- **Data retention.** Log retention policy, PII purge for the historical logs, and the
  compliance conversation from the assessment closed out.

### Month 3 — Durability

- **Performance, with evidence.** A load test that reproduces last Diwali's peak.
  Fix what it finds. Publish before/after numbers.
- **Runbooks and on-call.** One page per failure mode: symptom, check, action,
  escalation. A game day where we deliberately break staging and follow them. On-call
  rotation only after the runbooks exist — a rota without runbooks is just spreading
  the anxiety around.
- **Delete the rest of the legacy paths.** The strangler completes. Feature flags for
  completed migrations are removed; a permanent flag is technical debt with a nicer
  name.
- **Post-migration review.** What the estimates got wrong, what shadow mode caught
  that review did not, what to do differently.
- **Decide on TypeScript with evidence** rather than taste: how many of this quarter's
  bugs would types have caught? If the answer is "few", the answer is no. If it is
  yes, the path is `checkJs` plus JSDoc, file by file, not a big-bang conversion.

### Quarter 1 exit criteria

- [ ] No route handler contains business logic — **enforced by a test**, not a rule
- [ ] One source of truth for pricing; no SQL outside repositories
- [ ] All legacy handlers and completed flags deleted
- [ ] Restore drill and game day both performed, both documented
- [ ] Any engineer can ship to production on their first day
- [ ] Change failure rate under 15%; MTTR under 30 minutes; both measured, not guessed

---

## 5. Changes that cannot be behaviour-preserving

Most of this plan hides behind a flag because the outside world cannot tell the
difference. Three changes are visible, and they need a different process — a decision
from someone who is not an engineer, and a rollout that involves people rather than
percentages.

**The pricing fix (COR-3).** Some customers will be charged less than before. That is
the correct outcome and it is still a revenue change; finance decides, not me. The
three years of incorrect invoices are a separate remediation, sized by engineering and
decided by leadership.

**Order lookup by public id (SEC-5).** `GET /api/orders/41` must stop working, and two
integrations use it. Process: add the new endpoint, contact both integrators with a
90-day window, log every call to the old route with its caller, chase the stragglers
by name, and turn it off when the log is empty for two weeks — not when the calendar
says so. *A deprecation window measured in dates rather than in observed traffic is a
guess.*

**Error envelope v2.** Correct status codes (409 for out-of-stock, 201 for created) and
a structured error body. Shipped as an opt-in `Accept: application/vnd.orderdesk.v2`
header first; the default flips only when the logs show the old shape is unused. Until
then the new code deliberately returns the old strings and the old statuses, with
machine-readable codes added beside them.
→ [`errors.js`](../code/refactored/src/domain/errors.js)

---

## 6. What could go wrong with the plan itself

| Risk | Signal | Response |
|---|---|---|
| Shadow diffs never converge | Still finding new diff classes after a week | Stop. The rules are not what anyone thinks they are. Get finance to write them down before writing more code. |
| Migration time gets eaten by features | Two sprints with no migration ticket closed | Escalate with the dashboard, not with a complaint. "Change failure rate went back up" is an argument; "we need more time for tech debt" is not. |
| The team does not adopt the pattern | Second engineer's extraction looks nothing like the first | My documentation failed, not their attention. Pair on the third one. |
| A canary looks fine and is not | Diffs are clean but support tickets rise | Watch support volume as a ramp metric, not just the technical ones. |
| I become the single point of knowledge | Questions all route to me | The week-4 handover is not optional. If it slips, everything else slips behind it. |
| Reconciliation finds pre-existing bad data | Mismatches during the money backfill that predate us | Expected. Quarantine and report; do not silently "correct" financial records. |

---

## 7. Not this quarter

Kubernetes. Microservices. A new frontend framework. Event sourcing. A data warehouse.
GraphQL. Multi-region.

Every one of them is a defensible idea and none of them solves a problem this business
has in the next 90 days. The list exists so that when somebody proposes one in month
two, the answer is a reference rather than an argument.

---

**Next:** [Before/after refactor →](03-refactor.md)
