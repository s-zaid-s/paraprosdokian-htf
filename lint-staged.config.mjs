// Runs on `git commit` via .husky/pre-commit, against staged files only.
// lint-staged re-stages whatever these commands fix; if one still fails, the
// commit is aborted. Escape hatch: `git commit --no-verify`; see "Skipping hooks"
// in README.md for when that's appropriate.
//
// The two globs are disjoint on purpose: lint-staged runs separate globs in
// parallel, so a file matched by both could be written by ESLint and Prettier
// at the same time.
export default {
  // ESLint before Prettier, so Prettier has the final say on formatting.
  // --no-warn-ignored: .d.ts files are ignored by eslint.config.mjs, and ESLint
  // warns when an ignored file is passed to it explicitly.
  "*.ts": ["eslint --fix --no-warn-ignored", "prettier --write"],
  // Everything else Prettier can format. --ignore-unknown skips files it has no
  // parser for. .prettierignore still applies to explicitly passed files, so
  // *.js and apps/infra/snapshot/ (byte-exact cdk synth output) are left alone,
  // the same as `npm run format:check` in CI.
  "!(*.ts)": "prettier --write --ignore-unknown",
};
