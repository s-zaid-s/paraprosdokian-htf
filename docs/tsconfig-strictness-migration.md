# Adopting a new strict TypeScript flag

This repo enforces strictness centrally via `tsconfig.base.json` (see
[ADR 0001](adr/0001-strict-tsconfig-base.md)). When you want to turn on a
_new_ strict flag across the codebase, follow this process so one big,
unreviewable PR doesn't block unrelated work.

## 1. Gauge the blast radius first

Before touching `tsconfig.base.json`, try the flag locally without committing
it:

```sh
npx tsc --noEmit --strict false -- <newFlagName>
```

(or temporarily add the flag to a scratch `tsconfig.json` copy) and count how
many errors come back. A handful of errors in one or two files is a single
PR. Dozens of errors spread across many files is a multi-PR migration -
continue below.

## 2. Land the flag disabled-but-documented, package by package

1. Add the new flag to `tsconfig.base.json` set to `true`.
2. For every package that isn't fixed yet, override it back to `false` in
   that package's own `tsconfig.json`, **with a comment**:

   ```jsonc
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": {
       // TODO(HTF-xxx): not yet migrated to useUnknownInCatchVariables;
       // tracked in https://github.com/<org>/<repo>/issues/<n>
       "useUnknownInCatchVariables": false,
     },
   }
   ```

   `scripts/check-tsconfig-overrides.js` will fail the build on any override
   that's missing this comment, so this step can't be skipped silently.

3. Open a tracking issue referenced by the `TODO(HTF-xxx)` comment.

## 3. Triage and fix one package at a time

For each package:

1. Remove its override.
2. Run `npx tsc --noEmit -p packages/<name>/tsconfig.json` and fix every
   resulting error. Two common patterns from the `exactOptionalPropertyTypes`
   migration (see ADR 0001) generalize to most strict flags:
   - If the error is in **our own code**, fix the actual bug the flag is
     pointing at (don't just suppress it).
   - If the error is from a **third-party library's types**, fix it once at
     the single boundary where our code first touches that type, with a
     narrow, commented cast - not scattered `as any`/`@ts-expect-error`
     suppressions at every call site.
3. Run that package's test suite and the repo-wide `npm test` before merging.
4. Delete the tracking issue once every package's override is gone.

## Why this process, not a single big-bang PR

A single PR that turns on a new strict flag repo-wide either (a) blocks
every other in-flight PR until it's fully fixed, or (b) gets rubber-stamped
without real review because nobody can hold "200 unrelated strictness fixes"
in their head at once. Landing the flag "on, but overridden off with a
tracked TODO" per package lets each fix get reviewed on its own merits while
the rest of the team keeps shipping.
