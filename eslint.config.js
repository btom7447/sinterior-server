import globals from 'globals';

/**
 * Lint, aimed at one thing: names that do not exist.
 *
 * The `lint` script has been in package.json since the beginning with no config
 * behind it, so it has never run. In that time board.controller.js started
 * calling `mongoose.isValidObjectId` without importing mongoose — which threw a
 * ReferenceError on every request to that endpoint and took a whole feature down
 * silently, because the error handler turns anything unexpected into a generic
 * 500.
 *
 * `no-undef` catches that in under a second. This config is deliberately narrow:
 * a style ruleset dropped onto a mature codebase produces hundreds of warnings
 * that get ignored, and a lint nobody reads is worse than none. Correctness
 * rules only, all as errors, so the signal stays believable.
 */
export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // The one that would have caught the outage.
      'no-undef': 'error',

      // Same family: things that are always a mistake rather than a preference.
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
      'no-self-compare': 'error',

      // Deliberately off. It fires on `req.attachments = ...` after an await,
      // and on `socket.user = ...` in the handshake — the ordinary way Express
      // middleware and socket auth pass work down the chain. Those objects
      // belong to one request and are not shared, so the race it describes
      // cannot happen. Six false positives on correct code would be six reasons
      // to stop reading the output, and then the rules that do matter go unread
      // with them.
      'require-atomic-updates': 'off',
    },
  },
];
