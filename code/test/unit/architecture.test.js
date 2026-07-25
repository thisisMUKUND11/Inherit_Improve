/*
 * Architecture rules, as tests.
 *
 * These are four of the standards from docs/04-standards.md, executable. A
 * rule that lives only in a document is a rule somebody has to remember during
 * a review at 5pm on a Friday; a rule that fails the build is a rule.
 *
 * They are also how the boundaries survive me leaving. The layering in this
 * service is not held up by discipline -- it is held up by CI.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'refactored', 'src');

function sourceFiles(dir = SRC) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

const rel = (file) => path.relative(SRC, file).split(path.sep).join('/');
const read = (file) => fs.readFileSync(file, 'utf8');

/** Strip comments so a rule is not tripped by prose describing the thing it bans. */
function code(file) {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('no value is ever concatenated or interpolated into SQL', () => {
  const SQL = /(SELECT|INSERT|UPDATE|DELETE)\b/i;
  const offenders = [];

  for (const file of sourceFiles()) {
    code(file).split('\n').forEach((lineText, index) => {
      if (!SQL.test(lineText)) return;
      // `${placeholders}` builds a list of ? marks for an IN clause and binds
      // the values; it is the one allowed interpolation and it is named so
      // this rule can see it.
      const interpolation = lineText.match(/\$\{(\w+)\}/);
      if (interpolation && interpolation[1] !== 'placeholders') {
        offenders.push(`${rel(file)}:${index + 1}  interpolates ${interpolation[0]}`);
      }
      if (/['"]\s*\+\s*\w/.test(lineText)) {
        offenders.push(`${rel(file)}:${index + 1}  concatenates into SQL`);
      }
    });
  }

  assert.deepEqual(offenders, [], `SQL must use bound parameters:\n${offenders.join('\n')}`);
});

test('only the config module reads the environment', () => {
  const offenders = sourceFiles()
    .filter((file) => rel(file) !== 'config/env.js')
    .filter((file) => /process\.env/.test(code(file)))
    .map(rel);

  assert.deepEqual(offenders, [], 'configuration is loaded and validated in exactly one place');
});

test('the domain layer depends on nothing outside itself', () => {
  const offenders = [];

  for (const file of sourceFiles(path.join(SRC, 'domain'))) {
    for (const [, target] of code(file).matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      const isSibling = target.startsWith('./');
      if (!isSibling) offenders.push(`${rel(file)} requires ${target}`);
    }
  }

  assert.deepEqual(
    offenders, [],
    'pricing and money must stay pure: no express, no database, no clock, no config',
  );
});

test('http handlers do not reach past the service layer', () => {
  const banned = /require\(['"][^'"]*(repositories|db\/connection)[^'"]*['"]\)/;
  const offenders = sourceFiles(path.join(SRC, 'http'))
    .filter((file) => banned.test(code(file)))
    .map(rel);

  assert.deepEqual(offenders, [], 'a route that can reach the database will eventually contain a query');
});

test('every route handler stays short enough to read in one screen', () => {
  // A blunt proxy for "the handler does one thing". The inherited checkout
  // handler is 118 lines. The threshold is not sacred; the review conversation
  // it forces is the point.
  const LIMIT = 20;
  const offenders = [];

  for (const file of sourceFiles(path.join(SRC, 'http', 'routes'))) {
    const lines = code(file).split('\n');
    let start = null;
    let depth = 0;
    lines.forEach((lineText, index) => {
      if (start === null && /router\.(get|post|patch|put|delete)\(/.test(lineText)) {
        start = index; depth = 0;
      }
      if (start === null) return;
      depth += (lineText.match(/[({[]/g) ?? []).length;
      depth -= (lineText.match(/[)}\]]/g) ?? []).length;
      if (depth <= 0 && index > start) {
        const length = index - start + 1;
        if (length > LIMIT) offenders.push(`${rel(file)}:${start + 1} is ${length} lines`);
        start = null;
      }
    });
  }

  assert.deepEqual(offenders, [], `route handlers must be under ${LIMIT} lines:\n${offenders.join('\n')}`);
});

test('the refactored service ships no committed credentials', () => {
  const SUSPICIOUS = [
    /sk_live_[A-Za-z0-9]{8,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /(password|passwd|secret|api[_-]?key)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
  ];
  const offenders = [];

  // Comments are scanned too -- a credential pasted into a comment is still a
  // credential in git. That means false positives, so there is an escape
  // hatch, and it costs a visible marker on the line plus a reviewer agreeing
  // to it. Suppression should be possible and slightly embarrassing.
  const ALLOWLIST = /allowlist-secret/;

  for (const file of sourceFiles()) {
    read(file).split('\n').forEach((lineText, index) => {
      if (ALLOWLIST.test(lineText)) return;
      for (const pattern of SUSPICIOUS) {
        if (pattern.test(lineText)) offenders.push(`${rel(file)}:${index + 1} matches ${pattern}`);
      }
    });
  }

  assert.deepEqual(offenders, [], `secrets come from the environment, never from a file in git:\n${offenders.join('\n')}`);
});
