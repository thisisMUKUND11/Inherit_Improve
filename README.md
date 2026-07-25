# Inherit and improve

> **Digital Heroes — full-stack training task.**
> You are handed a working but poorly built codebase. No tests, business logic inside
> route handlers, direct database calls from the frontend, secrets in the repo. It
> serves real customers and cannot go down.

**Live site:** _add your deployed URL here_

Four written deliverables, and — because a claim about code is worth more when the code
runs — **both systems are in this repository, both boot, and the same test suite runs
against both.**

| # | Deliverable | | Weight |
|---|---|---|---|
| a | [Assessment](docs/01-assessment.md) | What to fix, in what order, and the risk of leaving each thing in place | 30 |
| b | [Migration plan](docs/02-migration-plan.md) | Week 1, month 1, quarter 1 — no big-bang rewrite | 25 |
| c | [Before/after refactor](docs/03-refactor.md) | One real handler, refactored, with the tests that made it safe | 25 |
| d | [Standards proposal](docs/04-standards.md) | What to introduce, and how to get a resistant team to adopt it | 20 |

---

## Quick start

Requires **Node 22.5+** (the built-in `node:sqlite` module — there is no native
dependency to compile).

```bash
npm install
npm test          # 86 tests: unit + architecture, contract, intended differences
```

```bash
npm run verify    # what CI runs: secret scan, lint, all tests, site build
```

Run either system and poke it in a browser:

```bash
npm run start:legacy        # http://localhost:3001 — the inherited storefront
npm run start:refactored    # http://localhost:3002 — needs .env, see below
```

```bash
cp code/refactored/.env.example code/refactored/.env   # then fill it in
# The refactored service exits 78 with a readable message if you skip this.
# That is deliberate: a missing secret should be a boot failure, not a surprise
# at 3am when `undefined` reaches the payment provider.
```

---

## What is in here

```
docs/                     the four deliverables
code/
  legacy/                 the inherited system — runs, takes orders, and is a mess
    server.js             POST /api/orders: 109 lines of everything
    config.json           five committed credentials (fabricated, deliberately present)
    public/index.html     a storefront that sends SQL from the browser
  refactored/             the same endpoints, restructured
    src/domain/           pricing + money. pure: no I/O, no clock, no config
    src/services/         use cases. own the transaction boundary
    src/repositories/     all SQL. bound parameters only
    src/http/             routes, validation, error mapping, redacted logging
    src/workers/          transactional outbox dispatcher
    migrations/           numbered, recorded, forward-only
  test/
    contract/             24 assertions run against BOTH systems
    differences/          17 assertions: each a defect, proven before and after
    unit/                 pricing, money, validation, logging, architecture rules
  tools/scan-secrets.js   pre-commit + CI secret scanning
site/build.js             renders docs/*.md into the published page
```

---

## The part worth two minutes of your time

**The contract suite runs against both systems, unchanged.**

```js
for (const target of TARGETS) {          // ['legacy', 'refactored']
  test(`contract [${target}]`, async (t) => {
    const app = await startTarget(target);
```

It starts each system as a real child process and drives it over HTTP, because the
inherited code has no seams to inject into — which is the normal situation when you
take over a codebase, and it decides where the first tests can go.

24 assertions describing what customers depend on. They pass identically on both. That
is the evidence that lets traffic move from one to the other behind a flag, and it is
the entire migration strategy in one file.

Two of those assertions deliberately encode behaviour that is *wrong* — a 400 where 409
belongs, a 200 where 201 belongs. A characterization test records reality, including
the parts you dislike. Opinions live next door in
[`differences/`](code/test/differences/intended-differences.test.js), where each
intended change is stated, justified, and proven in both directions:

```
COR-3  the price quoted and the price charged now agree
COR-3  quote and checkout agree on every cart, not just this one
COR-1  money is no longer computed in floating point
COR-2  concurrent checkouts can no longer oversell
SEC-3  the coupon field is no longer a SQL console
SEC-5  one customer can no longer read another customer's order
REL-1  a mail provider outage no longer fails the checkout
...
```

Each of those is a real defect in the inherited system. The tests assert that it
happens before and does not happen after — the ₹9.00 silent overcharge on every coupon
order, the stock reaching **−2** under two concurrent checkouts, the SQL injection that
hands out ₹50 for a made-up coupon code.

---

## Architecture rules are tests, not review comments

[`code/test/unit/architecture.test.js`](code/test/unit/architecture.test.js) fails the
build on:

- any value interpolated or concatenated into SQL
- `process.env` read outside the config module
- `domain/` importing anything outside `domain/`
- an HTTP file importing a repository
- a route handler longer than 20 lines
- a credential-shaped string anywhere in the source

A rule a human has to remember is an aspiration. A rule CI enforces is a standard —
and it means the boundaries survive the person who introduced them.

---

## About the committed credentials

`code/legacy/config.json` contains five credential-shaped values. **Every one is
fabricated for this exercise** and deliberately committed: it is the "secrets in the
repo" problem, present rather than described.

The secret scanner finds all five and suppresses them through a single allowlist entry
with a written reason, which is how a real engagement handles a known artefact:

```
$ npm run secrets:scan
5 finding(s) suppressed by allowlist:
  code/legacy/config.json:5   generic assigned secret  -- the inherited codebase...
  code/legacy/config.json:14  stripe live key          -- the inherited codebase...
  code/legacy/public/index.html:35  generic assigned secret  -- ...
secret scan: clean
```

Nothing under `code/refactored/` contains a secret, and a test asserts it.

---

## Deploying the site

The page is generated from `docs/*.md`, so the documents stay the single source of
truth. The build fails on a broken cross-document anchor.

```bash
npm run site:build     # -> site/index.html
```

[`vercel.json`](vercel.json) is set up for a static deploy: build command
`npm run site:build`, output directory `site`.

```bash
npx vercel --prod
```

---

<p align="center">
Built for <a href="https://digitalheroesco.com">Digital Heroes Training Task</a>
</p>
