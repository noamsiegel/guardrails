/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allow longer subject lines for richer commits.
    'header-max-length': [2, 'always', 100],
    // Body lines: allow up to 200 cols to fit context blocks from tools.
    'body-max-line-length': [1, 'always', 200],
    'footer-max-line-length': [1, 'always', 200],
  },
};
