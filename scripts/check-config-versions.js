#!/usr/bin/env node
'use strict';

// Fails if any package in the workspace pins a different version of the
// shared @htf/config-* packages than the others (HTF-002, prompt 10).

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WATCHED_DEPS = ["@htf/config-eslint", "@htf/config-prettier"];

function findPackageJsonFiles() {
  const files = [path.join(ROOT, "package.json")];
  for (const workspaceDir of ["packages", "apps"]) {
    const dir = path.join(ROOT, workspaceDir);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const pkgJson = path.join(dir, name, "package.json");
      if (fs.existsSync(pkgJson)) {
        files.push(pkgJson);
      }
    }
  }
  return files;
}

function main() {
  const seenVersions = new Map(); // dep -> Map(version -> [consumers])

  for (const file of findPackageJsonFiles()) {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const dep of WATCHED_DEPS) {
      const version = allDeps[dep];
      if (!version) continue;

      if (!seenVersions.has(dep)) seenVersions.set(dep, new Map());
      const versionsForDep = seenVersions.get(dep);
      if (!versionsForDep.has(version)) versionsForDep.set(version, []);
      versionsForDep.get(version).push(path.relative(ROOT, file));
    }
  }

  let hasDrift = false;
  for (const [dep, versionsForDep] of seenVersions) {
    if (versionsForDep.size > 1) {
      hasDrift = true;
      console.error(`Version drift detected for ${dep}:`);
      for (const [version, consumers] of versionsForDep) {
        console.error(`  ${version} -> ${consumers.join(", ")}`);
      }
    }
  }

  if (hasDrift) {
    console.error(
      "\nEvery package must pin the same version of each @htf/config-* package.",
    );
    process.exit(1);
  }

  console.log("No config-package version drift detected.");
}

main();
