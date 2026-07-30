module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    // An error, not a warning: the per-domain IPC/preload/API split moves hundreds
    // of imports between files, and a left-behind import is the classic residue of
    // a move that only half happened. A warning does not fail CI, so it would not
    // have caught it. Prefix with _ to keep a deliberately unused binding.
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-empty': 'off',
  },
  ignorePatterns: ['dist', 'dist-electron', 'release', 'node_modules'],
};
