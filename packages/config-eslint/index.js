"use strict";

const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

// SOLID-friendly rules applied to production source: no `any`, every class
// member's visibility is explicit, and functions stay below a sane
// cyclomatic-complexity ceiling.
const productionRules = {
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/explicit-member-accessibility": [
    "error",
    {
      accessibility: "explicit",
      // Constructors are public by default in TS; requiring the redundant
      // `public` keyword on them is just noise.
      overrides: { constructors: "no-public" },
    },
  ],
  complexity: ["error", { max: 10 }],
};

// Test files legitimately need `any` for mocks/fixtures and often exceed the
// production complexity cap when exercising many branches in one test body.
const testRuleRelaxations = {
  "@typescript-eslint/no-explicit-any": "off",
  complexity: "off",
};

const languageOptions = {
  parser: tsParser,
  parserOptions: {
    sourceType: "module",
  },
};

const plugins = {
  "@typescript-eslint": tsPlugin,
};

/**
 * Shared ESLint flat config, consumed by spreading into each package's
 * `eslint.config.mjs`:
 *
 *   import sharedConfig from '@htf/config-eslint';
 *   export default [...sharedConfig];
 */
module.exports = [
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["**/*.test.ts", "**/*.spec.ts"],
    languageOptions,
    plugins,
    rules: productionRules,
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    languageOptions,
    plugins,
    rules: { ...productionRules, ...testRuleRelaxations },
  },
];
