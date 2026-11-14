// Installs the git hooks in this directory by pointing git's core.hooksPath at
// .husky/_. Runs as the root package's `postinstall`, so every contributor gets
// the hooks from `npm install` or `npm ci`, with no extra setup step.
//
// husky is a devDependency. When dev dependencies are omitted (`npm ci
// --omit=dev`, or NODE_ENV=production), it isn't installed, and calling it would
// fail the whole install. The hooks couldn't run then anyway (lint-staged is
// missing too), so skip instead.
let husky;
try {
  husky = (await import("husky")).default;
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
  console.log("husky isn't installed (dev dependencies omitted?), skipping git hook setup.");
  process.exit(0);
}

// husky() returns a message instead of throwing for cases like "not a git
// repository" or HUSKY=0, so a failure to set up hooks never breaks an install.
const message = husky();
if (message) console.log(`husky: ${message}`);
