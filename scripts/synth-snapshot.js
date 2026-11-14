#!/usr/bin/env node
"use strict";

// Detects drift between `cdk synth` output for apps/infra and the CloudFormation
// templates committed under apps/infra/snapshot/.
//
//   node scripts/synth-snapshot.js --check    fail if synth output != snapshot (CI)
//   node scripts/synth-snapshot.js --update   overwrite the snapshot with synth output
//
// Any change to the synthesized infrastructure then has to come with a snapshot
// update in the same PR, so reviewers see the CloudFormation diff next to the code.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(ROOT, "apps", "infra");
const SNAPSHOT_DIR = path.join(APP_DIR, "snapshot");
const OUT_DIR = path.join(APP_DIR, "cdk.out");
const TEMPLATE_SUFFIX = ".template.json";

// Synth always targets this account/region, whoever runs it. It must match the
// lookups cached in apps/infra/cdk.context.json, since --no-lookups never asks AWS.
const SYNTH_ACCOUNT = "892242895576";
const SYNTH_REGION = "eu-west-1";

const SYNTH_ARGS = [
  "synth",
  "--quiet",
  // Fail on any lookup that isn't cached in cdk.context.json instead of calling AWS.
  "--no-lookups",
  // Leave out the AWS::CDK::Metadata resource. It encodes library versions, so it
  // changes on every dependency bump without any change to the infrastructure.
  "--no-version-reporting",
  "--no-notices",
  "--output",
  OUT_DIR,
];

/**
 * Environment for a hermetic synth. If the CDK CLI finds AWS credentials it
 * overwrites CDK_DEFAULT_ACCOUNT with the credentials' account, and it always
 * overwrites CDK_DEFAULT_REGION. A developer logged into another account would
 * then synthesize a different template than CI. So drop every AWS_* variable,
 * hide the AWS config/credentials files, and pass the target in explicitly.
 */
function hermeticEnv(baseEnv) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (key.startsWith("AWS_") || key.startsWith("CDK_DEFAULT_")) continue;
    env[key] = value;
  }
  const missing = path.join(os.tmpdir(), "synth-snapshot-no-aws-config");
  return {
    ...env,
    AWS_CONFIG_FILE: missing,
    AWS_SHARED_CREDENTIALS_FILE: missing,
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_REGION: SYNTH_REGION,
    CDK_DEFAULT_ACCOUNT: SYNTH_ACCOUNT,
  };
}

/** Reads every *.template.json in `dir` into { fileName: content }. */
function readTemplates(dir) {
  const templates = {};
  if (!fs.existsSync(dir)) return templates;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.endsWith(TEMPLATE_SUFFIX)) {
      templates[name] = fs.readFileSync(path.join(dir, name), "utf8");
    }
  }
  return templates;
}

/**
 * Compares committed templates with freshly synthesized ones. Line endings are
 * normalized, so a Windows checkout with core.autocrlf doesn't report drift.
 */
function compareSnapshots(committed, synthesized) {
  const normalize = (text) => text.replace(/\r\n/g, "\n");
  const names = [...new Set([...Object.keys(committed), ...Object.keys(synthesized)])].sort();
  const result = { added: [], removed: [], changed: [] };
  for (const name of names) {
    if (!(name in committed)) result.added.push(name);
    else if (!(name in synthesized)) result.removed.push(name);
    else if (normalize(committed[name]) !== normalize(synthesized[name])) result.changed.push(name);
  }
  return result;
}

function hasDrift({ added, removed, changed }) {
  return added.length + removed.length + changed.length > 0;
}

function synth() {
  // Start from an empty output dir so stale templates from earlier synths
  // (e.g. a nested stack that has since been removed) can't end up in the result.
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const cdkBin = require.resolve("aws-cdk/bin/cdk", { paths: [APP_DIR] });
  const result = spawnSync(process.execPath, [cdkBin, ...SYNTH_ARGS], {
    cwd: APP_DIR,
    env: hermeticEnv(process.env),
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`\ncdk synth failed (exit code ${result.status ?? result.signal}).`);
    process.exit(result.status || 1);
  }
  const templates = readTemplates(OUT_DIR);
  if (Object.keys(templates).length === 0) {
    console.error(`\ncdk synth produced no *${TEMPLATE_SUFFIX} files in ${OUT_DIR}.`);
    process.exit(1);
  }
  return templates;
}

/** Prints a unified diff (committed -> synthesized) using git, if available. */
function printDiff(committed, synthesized) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "synth-snapshot-"));
  const write = (dir, templates) => {
    fs.mkdirSync(dir);
    for (const [name, content] of Object.entries(templates)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
  };
  write(path.join(staging, "committed"), committed);
  write(path.join(staging, "synthesized"), synthesized);
  spawnSync("git", ["diff", "--no-index", "--stat", "--patch", "committed", "synthesized"], {
    cwd: staging,
    stdio: "inherit",
  });
  fs.rmSync(staging, { recursive: true, force: true });
}

function summarize({ added, removed, changed }) {
  return [
    ...added.map((name) => `  added:   ${name}`),
    ...removed.map((name) => `  removed: ${name}`),
    ...changed.map((name) => `  changed: ${name}`),
  ].join("\n");
}

function main() {
  const mode = process.argv[2];
  if (mode !== "--check" && mode !== "--update") {
    console.error("Usage: node scripts/synth-snapshot.js --check | --update");
    process.exit(2);
  }

  const synthesized = synth();
  const committed = readTemplates(SNAPSHOT_DIR);
  const diff = compareSnapshots(committed, synthesized);
  const snapshotRel = path.relative(ROOT, SNAPSHOT_DIR);

  if (mode === "--update") {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    for (const name of diff.removed) fs.rmSync(path.join(SNAPSHOT_DIR, name));
    for (const [name, content] of Object.entries(synthesized)) {
      fs.writeFileSync(path.join(SNAPSHOT_DIR, name), content);
    }
    console.log(
      hasDrift(diff)
        ? `\nUpdated ${snapshotRel}/:\n${summarize(diff)}\n\nReview the changes and commit them.`
        : `\n${snapshotRel}/ is already up to date.`,
    );
    return;
  }

  if (!hasDrift(diff)) {
    console.log(`\ncdk synth output matches ${snapshotRel}/.`);
    return;
  }

  if (Object.keys(committed).length === 0) {
    console.error(
      `\nNo snapshot committed in ${snapshotRel}/. Run \`npm run snapshot:update\` and commit the result.`,
    );
    process.exit(1);
  }

  printDiff(committed, synthesized);
  console.error(
    [
      "",
      `cdk synth output differs from the committed snapshot in ${snapshotRel}/:`,
      summarize(diff),
      "",
      "If this change is intended, run `npm run snapshot:update` and commit the result.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { hermeticEnv, compareSnapshots, hasDrift, readTemplates };
