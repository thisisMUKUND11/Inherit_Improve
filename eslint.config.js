/*
 * Lint configuration.
 *
 * The formatting rules are not here because formatting is not worth a review
 * comment or a meeting -- a formatter runs on save and on commit, and the
 * argument is over. What is here is the small set of rules that catch bugs,
 * plus two that encode decisions this team has made and does not want to
 * re-litigate in every pull request.
 */
module.exports = [
  {
    files: ['code/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', process: 'readonly', console: 'readonly', __dirname: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', setImmediate: 'readonly', fetch: 'readonly', URL: 'readonly' },
    },
    rules: {
      // Bugs.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_|^next$' }],
      'no-undef': 'error',
      'no-implicit-coercion': 'warn',
      eqeqeq: ['error', 'smart'],
      'no-return-await': 'error',
      'require-atomic-updates': 'error',

      // Decisions.
      //   An await inside a loop is usually an N+1 query. Sometimes it is
      //   deliberate, as in the outbox worker, where it is annotated.
      'no-await-in-loop': 'warn',
      //   Floating point on money is the defect this codebase exists to
      //   discuss. Flag the operators; the reviewer checks the units.
      'no-magic-numbers': 'off',
      'max-depth': ['warn', 3],
      'complexity': ['warn', 10],
      'max-lines-per-function': ['warn', { max: 60, skipComments: true, skipBlankLines: true }],
    },
  },
  {
    // Tests are allowed to be long and sequential. A test that reads as a
    // narrative -- do this, then this, then assert -- is worth more than a
    // test that satisfies a complexity metric, and `await` in a loop is how
    // you drive a system in a defined order.
    files: ['code/test/**/*.js'],
    rules: {
      'no-await-in-loop': 'off',
      'max-lines-per-function': 'off',
      'max-depth': 'off',
    },
  },
  {
    // The inherited code is not linted. Adding 200 warnings to the build on
    // day one teaches the team that warnings are noise to be ignored. It is
    // linted route by route as each one is migrated, and the exclusion list
    // shrinks with every PR -- a visible, shrinking scoreboard.
    ignores: ['code/legacy/**', 'node_modules/**', 'site/**', '.tmp/**'],
  },
];
