#!/usr/bin/env node
"use strict";

// Type-checks every workspace's tests (packages/*/test and apps/*/test) in a
// single TypeScript process.
//
// Each test project loads aws-cdk-lib's ~2,800 type definition files, and
// parsing them is nearly all of the work. A separate `tsc -p` per workspace
// parses them once per workspace. `tsc --build` with several projects shares
// the parsed files, so they are parsed once in total.
//
// Test projects are found automatically, so a new workspace's tests can't be
// silently left out of the check.
//
// Deliberately not incremental (the test tsconfigs stay `noEmit`, without
// `incremental`). tsc --build decides whether a project is up to date from its
// own files' timestamps, so it would skip a test project whose dependency's
// types changed (another workspace's API, or an aws-cdk-lib upgrade) and miss
// the resulting errors.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const WORKSPACE_DIRS = ["packages", "apps"];

/** Relative paths of every `<workspace>/test` directory that has a tsconfig.json. */
function findTestProjects(root = ROOT) {
  const projects = [];
  for (const workspaceDir of WORKSPACE_DIRS) {
    const dir = path.join(root, workspaceDir);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      const testDir = path.join(workspaceDir, name, "test");
      if (fs.existsSync(path.join(root, testDir, "tsconfig.json"))) {
        projects.push(testDir);
      }
    }
  }
  return projects;
}

function main() {
  const projects = findTestProjects();
  if (projects.length === 0) {
    console.error("No test projects found (expected packages/*/test/tsconfig.json).");
    process.exit(1);
  }
  const tsc = require.resolve("typescript/bin/tsc", { paths: [ROOT] });
  const result = spawnSync(process.execPath, [tsc, "--build", ...projects], {
    cwd: ROOT,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

if (require.main === module) {
  main();
}

module.exports = { findTestProjects };
