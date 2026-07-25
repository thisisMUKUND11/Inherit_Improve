/*
 * Outbox worker.
 *
 * Reads committed intents and performs them, with retries and backoff. This is
 * the half of the fix that the outbox table is the other half of: the checkout
 * request is finished and answered before anything here runs, so a mail
 * provider having a bad afternoon costs us delayed emails instead of failed
 * checkouts and duplicate orders.
 *
 * Delivery is at-least-once. Handlers must tolerate being called twice, which
 * is why the payload carries the order's public id -- a retry re-sends the
 * same confirmation for the same order rather than inventing a new one.
 */

function createOutboxWorker({
  outboxRepo,
  handlers,
  maxAttempts = 5,
  clock = () => new Date().toISOString(),
  logger = { info() {}, warn() {}, error() {} },
}) {
  let timer = null;

  /** Process everything currently due. Returns a small report, for tests. */
  async function runOnce() {
    const now = clock();
    const due = await outboxRepo.claimDue(now, 10);
    const report = { processed: 0, sent: 0, failed: 0, exhausted: 0 };

    /* eslint-disable no-await-in-loop --
       Deliberately sequential. Firing every due message at the provider at
       once is how a backlog after an outage turns into a rate-limit ban, and
       how a retry storm becomes the second incident. Throughput is bounded by
       the batch size and the poll interval, both configurable. */
    for (const message of due) {
      report.processed += 1;
      const handler = handlers[message.topic];
      if (!handler) {
        report.failed += 1;
        await outboxRepo.markFailed(message.id, maxAttempts, `no handler for ${message.topic}`, maxAttempts, now);
        logger.error('outbox: no handler', { topic: message.topic, id: message.id });
        continue;
      }
      try {
        await handler(JSON.parse(message.payload));
        await outboxRepo.markSent(message.id, now);
        report.sent += 1;
      } catch (err) {
        const attempts = message.attempts + 1;
        const exhausted = await outboxRepo.markFailed(
          message.id, attempts, err.message, maxAttempts, now,
        );
        report.failed += 1;
        if (exhausted) report.exhausted += 1;
        logger[exhausted ? 'error' : 'warn']('outbox: delivery failed', {
          id: message.id, topic: message.topic, attempts, exhausted, error: err.message,
        });
      }
    }
    /* eslint-enable no-await-in-loop */
    return report;
  }

  return {
    runOnce,
    start(intervalMs) {
      if (timer) return;
      timer = setInterval(() => {
        runOnce().catch((err) => logger.error('outbox: worker crashed', { error: err.message }));
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/** Handlers keyed by topic. Each one is small and independently testable. */
function createOutboxHandlers({ mailer }) {
  return {
    'order.confirmation_email': async ({ email, publicId, totalMinor }) => {
      await mailer.send({
        to: email,
        subject: `Your OrderDesk order ${publicId}`,
        body: `Thanks for your order. Total: ${(totalMinor / 100).toFixed(2)} INR.`,
      });
    },
  };
}

module.exports = { createOutboxWorker, createOutboxHandlers };
