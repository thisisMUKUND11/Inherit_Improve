# Engineering standards — OrderDesk

What I would introduce, and how I would get a team that did not ask for any of it to
actually use it.

The second half is the hard part. Standards documents are easy to write and almost
always ignored, and the reason is rarely that the standards were wrong.

---

## Part one — the standards

### 0. The two rules about rules

**A rule a human has to remember is an aspiration. A rule CI enforces is a standard.**
Every item below names how it is checked. Where the answer is "in review", it is a
weaker rule and I have said so.

**Four things are non-negotiable. Everything else is up for a vote.** Secrets,
money, migrations, and the transaction boundary — those are safety, and I will
overrule the team on them. Naming, file layout, comment style, test structure, how
many blank lines: taste, and taste belongs to whoever maintains the code. Being
explicit that the mandatory list is *short* is what makes it stick. A twelve-page
standards document with no priority signals is read as "the new person has opinions",
and it is read once.

---

### 1. Definition of done

A change is done when:

- [ ] It works, and there is a test that would fail if it stopped working
- [ ] CI is green: secret scan, lint, tests
- [ ] It is behind a flag if it changes behaviour customers can see
- [ ] It can be rolled back without a database restore
- [ ] It emits something — a log line, a metric — that would show it misbehaving
- [ ] The next person can understand *why* from the code or the PR, not just *what*

Not on the list: documentation updated in a wiki nobody reads, a ticket moved to the
right column, and a code coverage threshold. Each of those is either automated or not
worth a checkbox.

### 2. Pull requests

| Rule | Enforced by |
|---|---|
| No direct pushes to `main` | Branch protection |
| One approving review | Branch protection |
| CI green before merge | Branch protection |
| Under ~400 lines of diff | Review convention, bot warning over 400 |
| One concern per PR | Review |
| Refactor and behaviour change never in the same PR | Review, and it is the one I am strictest about |

That last one is the highest-value rule on this page. When a PR moves code *and*
changes what it does, nobody can review either half, and when it breaks in production
you cannot bisect the cause. Split it. Always.

The 400-line limit is not about attention span; it is about honesty. Nobody reviews a
900-line diff, they approve it. A limit that produces real review is worth more than
a limit that produces polite approval.

### 3. Testing standards

- **Characterization tests before any refactor.** Record what the system does,
  including what it does wrong. → [refactor §3](03-refactor.md#3-the-safety-net-before-touching-anything)
- **Contract tests run against old and new** while both exist. A test only the new
  implementation can pass proves nothing about the migration.
- **Pure domain logic gets exhaustive unit tests.** They are cheap; use thousands of
  cases, not three.
- **One integration test per route,** through the real HTTP stack against a real
  database.
- **Do not mock the database.** A mocked repository asserts that you called the
  function you wrote; it will happily pass while the SQL is wrong.
- **Every bug fix ships with the test that reproduces it.** Written first, watched to
  fail, then fixed.
- **Coverage ratchets, it does not target.** The number may not go down. There is no
  goal number. An 80% mandate produces tests written to raise a number, which are worse
  than no tests because they take time to maintain and catch nothing.

### 4. Architecture

Four layers, and the dependency arrow only points one way:

```
http/          parse, delegate, map errors. no arithmetic, no SQL
services/      use cases. own the transaction boundary
repositories/  all SQL. bound parameters only
domain/        pure. no I/O, no clock, no config, no framework
```

Rules:

- No business logic in a route handler
- No SQL outside `repositories/`
- Nothing interpolated into SQL, ever
- `domain/` imports nothing outside `domain/`
- No I/O inside a transaction
- Money is integer minor units everywhere; floats never touch an amount
- Timestamps are UTC ISO-8601
- Configuration is read in one place and validated at boot
- Errors are domain types; the HTTP mapping lives in exactly one file

**Five of those are executable tests, not review comments:**
[`architecture.test.js`](../code/test/unit/architecture.test.js) fails the build on
interpolated SQL, on `process.env` outside the config module, on `domain/` importing
anything external, on an HTTP file importing a repository, and on a route handler over
20 lines. `db.transaction()` throws at runtime if its callback returns a promise.

This matters more than it looks. The boundaries in this service are not held up by
anyone's discipline or by my continued presence — they are held up by CI. That is the
difference between an architecture and a diagram.

### 5. Operations

- **Secrets never enter the repository.** `.env.example` only. Pre-commit hook *and*
  CI. If one is caught: rotate first, then clean up — a secret that reached CI is
  already pushed, and pushed is leaked.
- **Migrations are expand/contract and forward-only.** No rename, no destructive change
  in the same release that stops using a column. Deploys overlap.
- **Every deploy is revertible in one command,** and we prove it monthly.
- **Every endpoint emits latency and error rate.** Anything unmeasured is unowned.
- **Alerts must be actionable.** An alert nobody acts on gets deleted, not muted. Two
  good alerts beat thirty ignored ones.
- **ADRs for decisions with a blast radius.** One page: context, decision,
  alternatives, consequences. Written when the decision is made, never revised — a
  superseded ADR gets a successor, not an edit.
- **A runbook per failure mode:** symptom, check, action, escalation.

### 6. What I am not proposing yet

TypeScript, a monorepo, a component library, GraphQL, 90% coverage, mandatory pairing,
a linting rule for every preference.

Each is defensible. None solves a problem this team has this quarter, and each one
spends adoption credit I need for the four things that do. Revisit at the Q1 review,
with evidence: *how many of last quarter's incidents would this have prevented?*

---

## Part two — adoption

### 1. Resistance is information

The failure mode is to treat resistance as ignorance and respond with more explaining.
Resistance to engineering standards is almost always rational, and it is worth
diagnosing which of these it is before responding, because the four have completely
different remedies:

| What they say | What it usually means | What works |
|---|---|---|
| "We don't have time for that" | They are measured on features and this is not counted | Make the cost of *not* doing it visible in their terms: hours of unplanned work, deploys rolled back |
| "We tried that before" | A previous quality push was announced, stalled, and quietly abandoned | Ship something small and finish it. Credibility is the currency and it is earned in deliveries, not proposals |
| "Our situation is different" | Sometimes true. Often a fear of being judged | Ask what is different. Sometimes you learn why the code is that way. Occasionally you are wrong |
| Silent non-compliance | They think you will leave, or be overruled, and it will blow over | Consistency. This one is only solved by time |

And the one nobody says out loud: **the person who wrote this code is in the room.**
Every criticism of the codebase is heard as a criticism of them. Get that wrong in
week one and nothing else in this document matters.

### 2. Earn the right before asking for anything

I would not introduce a single standard in week one. I would fix something that hurts
them.

Ask: *what pages you at night, what do you dread deploying, what does support ask you
about every week?* Then fix that, visibly, and let someone else present it.

In this codebase it is obvious — nobody wants to touch checkout, and deploys are
frightening. Week 1 makes deploys boring and rollbacks real
([migration plan §2](02-migration-plan.md#2-week-1--stop-the-bleeding-build-the-instruments)).
That buys the standing to say "here's how I'd like us to write tests", and it means
the first standard arrives attached to a thing that already worked.

**Order matters more than content here.** Standards first, then benefits: you are a
new person with rules. Benefit first, then standards: you are the person who fixed
deploys, describing how.

### 3. Show it, then hand it over

- **First one, I do it.** In public, small PRs, narrating the reasoning. The
  [checkout refactor](03-refactor.md) is that artefact — the argument made in working
  code rather than in a document.
- **Second one, we pair.** They drive.
- **Third one, they do it and I review.** Scheduled in
  [week 4](02-migration-plan.md#week-4--hand-it-over), not left to happen.
- **Fourth one, someone else reviews it.**

By the fourth, the pattern is theirs. If it only works when I do it, it is not a
pattern, it is a preference — and their difficulty is my documentation failing, not
their attention.

### 4. Make the right thing the easy thing

Every standard that depends on discipline will decay. Encode it:

- Formatter on save and on commit. Formatting arguments end permanently, and nobody
  has to be the person who cares about semicolons.
- Lint autofix in the pre-commit hook.
- Secret scanning in the hook, so the failure happens before the push.
- `npm run new:route` scaffolds route + service + repository + test in the house style.
  The lazy path becomes the correct path.
- PR template with the definition of done as checkboxes.
- **Architecture rules as failing tests, not review comments.** Nobody has to be the
  person who says "this belongs in a service" for the fifth time — CI says it, in
  eleven seconds, with no interpersonal cost.

That last point is underrated as a *social* mechanism. The most corrosive thing about
introducing standards is turning a colleague into the person who nags. Automation moves
the friction from between two people to between a person and a machine, and machines
do not get resented for long.

### 5. Ratchet, never retrofit

**New code complies. Existing code complies when you touch it. Nobody stops to clean.**

No quality sprints. A quality sprint teaches the team that quality is a special
activity requiring permission, and it is the first thing cancelled when a customer
escalates.

Concretely: the linter ignores `code/legacy/`, and files leave that list as they are
migrated. The exclusion list is a scoreboard that shrinks every week and never grows.
Rules apply to the diff, not to the repository.

Same for the test-coverage ratchet: it may not go down. There is no target.

### 6. One rule at a time, with an expiry date

Never a document. One rule, at a retro, with a sunset:

> *"For the next two weeks, no PR over 400 lines. At the retro we decide whether to
> keep it. If it is making things worse, we drop it and I will not bring it back."*

The trial period is what makes people willing to try, and meaning it is what makes the
second proposal land. **A rule I refuse to drop after a bad trial costs me every
future rule.**

Order for this team: (1) CI must be green to merge — nobody argues with that;
(2) bug fixes ship with a reproducing test; (3) small PRs; (4) architecture boundaries,
by which point they are already writing that way from the migration work.

### 7. Every rule names the incident it prevents

"No SQL in handlers" is abstract and sounds like taste.

"On 14 March we sold two bottles we did not have, because the stock check and the
stock write were separate statements in a route handler. That is why the transaction
boundary lives in the service" is not arguable, and it is remembered.

Write the standards doc with the incident attached to each rule. Where there is no
incident yet, say so honestly — some rules are precautionary and deserve less weight
than the ones written in blood. Being honest about which is which is what makes the
blood-written ones credible.

### 8. Give away ownership of everything you can

I write the first draft. The team edits it. Where the change is taste, it goes in
unchanged — **the point is not that the draft was right, it is that the document
becomes theirs.**

Where it is one of the four safety items, I say so plainly: *"this one I'm not moving
on, and here's why."* Being visibly flexible on eight things is what makes
inflexibility on four read as judgement rather than ego.

Then hand out ownership: someone owns the CI pipeline, someone owns the runbooks,
someone owns dependency updates. People defend what they own and comply with what they
are told, and the first is durable.

### 9. Handling the author of the code

They are usually the most resistant and the most valuable person in the room.

- Never criticise the code in a group setting. Ever.
- Ask them why, genuinely. `POST /db/sql` was added under deadline pressure to
  unblock a launch. That is a reasonable decision that outlived its context, and
  hearing the story usually reveals a constraint you did not know about.
- Frame it as a change in requirements, not a verdict: *this code got the company to
  40,000 orders a month; the thing that gets it to 400,000 looks different.* True, and
  it makes the past a success rather than a mistake.
- Make them co-author of the standards. Their name on it converts the most effective
  potential blocker into the most effective advocate.
- Credit them publicly for the parts that were right. There always are some.

### 10. Measure it, publish it, let it argue for you

Monthly, on a wall, no commentary:

| Metric | Why this one |
|---|---|
| Deploy frequency | Goes up when people stop being afraid |
| Lead time, commit to production | Measures the pipeline, not the people |
| Change failure rate | The one that justifies the tests |
| Time to restore | The one that justifies the rollback work |
| **Hours per week on unplanned work** | The one non-engineers understand instantly |

That last row is the argument. When it drops from twelve hours to three, nobody has to
be persuaded that the standards are worth it, and — more importantly — nobody has to
be persuaded by *me*. The graph makes the case, monthly, without a meeting.

Publish honestly, including the months it gets worse. A metric only ever shown when
flattering is recognised as marketing within two months, and then it is worthless.

### 11. When it still does not work

Sequence, in order, and skipping steps is the usual mistake:

1. **Is it easy to comply?** If the standard needs discipline, that is my bug. Fix the
   tooling.
2. **Is the why published, with the incident?** If not, publish it.
3. **Is it actually a good rule?** Sometimes the resistant person is right. Ask them to
   propose a better version — often they do, and then they own it.
4. **Is one person consistently bypassing an agreed rule?** Private conversation.
   Understand it. Usually it is time pressure or a disagreement never voiced.
5. **Still happening?** It is a management conversation about working agreements, not a
   tooling problem — but only after 1 to 4, and only for the four non-negotiables.
   Escalating over formatting is how you lose a team.

### 12. Anti-patterns I would avoid

- Introducing more than three changes at once
- A quality sprint
- A coverage mandate
- Shaming in code review, or letting anyone else do it
- Rules without automation
- Standards that arrive before any delivered value
- Rewriting to make the standards easier to apply
- Presenting standards as best practice. **Nothing is adopted because it is best
  practice. Things are adopted because they solve a problem the team already has.**

### 13. What success looks like

Not compliance. Compliance is what you get when people are being watched.

Success is a PR from someone who did not attend any of these conversations that has a
reproducing test, is under 400 lines, and puts the pricing rule in the domain — because
that is how it is done here. And, six months after I leave, the standards having
changed in ways I would not have chosen, still enforced.

The measure of this work is whether it survives me. A standard that needs its author
present is a preference with a nicer name.

---

**Back to:** [Assessment](01-assessment.md) · [Migration plan](02-migration-plan.md) ·
[Refactor](03-refactor.md)
