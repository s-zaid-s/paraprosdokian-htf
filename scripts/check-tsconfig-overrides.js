#!/usr/bin/env node
"use strict";

// Fails if any package's tsconfig.json silently disables a flag that
// `tsconfig.base.json` turns on, without an adjacent `//` comment explaining
// why (HTF-003, prompt 9). Undocumented overrides are exactly how a package
// quietly loses strictness without anyone noticing in review.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_CONFIG_PATH = path.join(ROOT, "tsconfig.base.json");
const EXCLUDED_FILENAMES = new Set(["tsconfig.base.json", "tsconfig.ci.json"]);

/** Returns the set of compilerOptions keys the base config turns on (`true`). */
function getBaseFlags(baseConfigRaw) {
  const parsed = JSON.parse(baseConfigRaw);
  const options = parsed.compilerOptions || {};
  return Object.keys(options).filter((key) => options[key] === true);
}

/** Finds base flags this consuming tsconfig flips to `false` without a nearby comment. */
function findUndocumentedOverrides(baseFlags, consumingConfigRaw) {
  const lines = consumingConfigRaw.split("\n");
  const violations = [];

  lines.forEach((line, index) => {
    for (const flag of baseFlags) {
      const disablesFlag = new RegExp(`"${flag}"\\s*:\\s*false`).test(line);
      if (!disablesFlag) continue;

      const hasCommentOnLine = line.includes("//");
      const previousLine = index > 0 ? lines[index - 1] : "";
      const hasCommentAbove = previousLine.includes("//");

      if (!hasCommentOnLine && !hasCommentAbove) {
        violations.push({ flag, line: index + 1 });
      }
    }
  });

  return violations;
}

// Every workspace (packages/* and apps/*) can override the base in its own
// tsconfig.json and in test/tsconfig.json (used to type-check its tests).
const WORKSPACE_DIRS = ["packages", "apps"];
const WORKSPACE_TSCONFIGS = ["tsconfig.json", path.join("test", "tsconfig.json")];

function findConsumingTsconfigFiles(root = ROOT) {
  const files = [path.join(root, "tsconfig.json")];
  for (const workspaceDir of WORKSPACE_DIRS) {
    const dir = path.join(root, workspaceDir);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      for (const tsconfig of WORKSPACE_TSCONFIGS) {
        const tsconfigPath = path.join(dir, name, tsconfig);
        if (fs.existsSync(tsconfigPath)) {
          files.push(tsconfigPath);
        }
      }
    }
  }
  return files.filter((file) => !EXCLUDED_FILENAMES.has(path.basename(file)));
}

function main() {
  const baseFlags = getBaseFlags(fs.readFileSync(BASE_CONFIG_PATH, "utf8"));
  let hasViolations = false;

  for (const file of findConsumingTsconfigFiles()) {
    const raw = fs.readFileSync(file, "utf8");
    const violations = findUndocumentedOverrides(baseFlags, raw);

    if (violations.length > 0) {
      hasViolations = true;
      console.error(`Undocumented strict-flag overrides in ${path.relative(ROOT, file)}:`);
      for (const { flag, line } of violations) {
        console.error(`  line ${line}: "${flag}": false (no adjacent "// ..." justification)`);
      }
    }
  }

  if (hasViolations) {
    console.error(
      "\nAdd a `// why` comment next to each override, or remove it to keep the base config's strictness.",
    );
    process.exit(1);
  }

  console.log("No undocumented tsconfig strict-flag overrides detected.");
}

if (require.main === module) {
  main();
}

module.exports = { getBaseFlags, findUndocumentedOverrides, findConsumingTsconfigFiles };
