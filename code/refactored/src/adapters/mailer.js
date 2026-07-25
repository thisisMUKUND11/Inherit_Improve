/*
 * Mail adapter.
 *
 * The same stub as the legacy system -- addresses at blackhole.test simulate
 * the provider outage from March -- but behind an interface, so the worker can
 * be tested against a mailer that fails on demand without patching modules or
 * monkeying with globals.
 */

function createMailer({ log = () => {} } = {}) {
  return {
    async send({ to, subject, body }) {
      if (String(to).endsWith('@blackhole.test')) {
        throw new Error('SMTP 421: service temporarily unavailable');
      }
      log('mail sent', { subject });
      return { accepted: true, to, subject, body };
    },
  };
}

module.exports = { createMailer };
