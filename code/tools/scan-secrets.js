#!/usr/bin/env node
/*
 * Secret scanner.
 *
 * A stand-in for gitleaks or detect-secrets, written here so the repository
 * has no build-time dependency on a binary. In a real engagement this is
 * `gitleaks protect --staged` in a pre-commit hook and `gitleaks detect` over
 * the full history in CI.
 *
 * Two things about how it is wired matter more than the patterns:
 *
 *   1. It runs in the pre-commit hook, not only in CI. A secret caught in CI
 *      is already pushed, which means it is already leaked and the only
 *      remedy left is rotation.
 *   2. code/legacy/ is allowlisted, with a reason, in one place. The
 *      inherited system's committed credentials are the exhibit; suppressing
 *      them silently would defeat the point, and suppressing them everywhere
 *      would defeat the scanner.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

const SKIP_DIRS = new Set(['node_modules', '.git', '.tmp', 'data', 'site']);

const ALLOWLISTED_PATHS = [
  {
    prefix: path.join('code', 'legacy'),
    reason: 'the inherited codebase, kept intact as the before-state of the refactor exercise',
  },
];

const RULES = [
  { name: 'stripe live key', pattern: /sk_live_[A-Za-z0-9_]{8,}/ },
  { name: 'aws access key id', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'github token', pattern: /gh[pousr]_[A-Za-z0-9]{16,}/ },
  { name: 'slack token', pattern: /xox[abposr]-[A-Za-z0-9-]{10,}/ },
  // The optional closing quote matters: in JSON the key is already quoted, so
  // `"jwtSecret": "changeme"` does not match a pattern that expects the colon  allowlist-secret
  // to follow the word directly. That gap is how scanners miss config files.
  { name: 'generic assigned secret', pattern: /(password|passwd|pass|secret|api[_-]?key|apikey|admin[_-]?key|token|credential)["']?\s*[:=]\s*['"][^'"\s]{8,}['"]/i }, // allowlist-secret: the rule itself
  { name: 'connection string with password', pattern: /(postgres|mysql|mongodb)(\+srv)?:\/\/[^:\s]+:[^@\s]+@/i },
];

const SCANNABLE = /\.(js|mjs|cjs|json|ya?ml|env|sql|sh|html|md|txt)$/i;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SCANNABLE.test(entry.name)) yield full;
  }
}

function allowlistFor(relPath) {
  return ALLOWLISTED_PATHS.find((entry) => relPath.startsWith(entry.prefix));
}

function scan() {
  const findings = [];
  const suppressed = [];

  for (const file of walk(ROOT)) {
    const relPath = path.relative(ROOT, file);
    const allowed = allowlistFor(relPath);

    fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (/allowlist-secret/.test(line)) return;
      for (const rule of RULES) {
        if (!rule.pattern.test(line)) continue;
        const finding = { file: relPath, line: index + 1, rule: rule.name };
        if (allowed) suppressed.push({ ...finding, reason: allowed.reason });
        else findings.push(finding);
      }
    });
  }

  return { findings, suppressed };
}

if (require.main === module) {
  const { findings, suppressed } = scan();

  if (suppressed.length > 0) {
    console.log(`${suppressed.length} finding(s) suppressed by allowlist:`);
    for (const s of suppressed) console.log(`  ${s.file}:${s.line}  ${s.rule}  -- ${s.reason}`);
    console.log('');
  }

  if (findings.length === 0) {
    console.log('secret scan: clean');
    process.exit(0);
  }

  console.error(`secret scan: ${findings.length} finding(s)\n`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.rule}`);
  console.error('\nIf this is a false positive, add `allowlist-secret` to the line and say why in the PR.');
  console.error('If it is real: rotate the credential first. Removing the commit does not unleak it.');
  process.exit(1);
}

module.exports = { scan, RULES };
