# ADR 0001: Strict shared `tsconfig.base.json`

- **Status:** Accepted
- **Date:** 2026-11-12
- **Ticket:** HTF-003

## Context

Before this change, `tsconfig.json` was a single, hand-written file at the
repo root with its own copy of every compiler option. HTF-001 split the
codebase into `packages/network`, `packages/eks-cluster`, `packages/ecr`,
`packages/workloads`, and `apps/infra`, each with its own `tsconfig.json` -
without a shared base, duplication across five files is how one package
quietly ends up less strict than the others, usually discovered only after a
null-reference bug ships.

## Decision

Introduce `tsconfig.base.json` as the single source of truth for strictness,
extended by every package's own `tsconfig.json`. The base config enables:

| Flag                         | What it catches                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `strict`                     | The standard TS strict-mode bundle: no implicit `any`, strict null checks, etc.                       |
| `noUncheckedIndexedAccess`   | Assuming `arr[i]` or `obj[key]` can't be `undefined`.                                                 |
| `exactOptionalPropertyTypes` | Assigning `undefined` to an optional field that should only ever be _omitted_.                        |
| `isolatedModules`            | Code that can't be compiled file-by-file by fast transpilers (esbuild/swc).                           |
| `noImplicitOverride`         | A subclass method that silently shadows a base-class method instead of explicitly marking `override`. |
| `useUnknownInCatchVariables` | Treating a `catch (err)` value as `any` instead of narrowing it before use.                           |

`noUnusedLocals` is also enabled in the base (`noUnusedParameters` stays off -
unused parameters are common and harmless in CDK construct/props signatures).
An earlier draft of this ADR kept unused-variable checks in a separate,
CI-only `tsconfig.ci.json`; that doesn't compose cleanly with TypeScript
project references (a "CI-only" variant would need its own composite config
per package), so it was folded directly into the shared base instead.

## Consequences

- Fixing the first round of `exactOptionalPropertyTypes` violations required
  two kinds of changes, which future contributors should recognize as the
  standard fixes for this flag:
  1. **Our own optional props that are always passed, just sometimes
     `undefined`** (e.g. `EksClusterConstructProps.clusterAdminPrincipalArn`):
     changed from `field?: T` to `field: T | undefined` (required key,
     possibly-undefined value) instead of removing the key when absent.
  2. **A third-party type mismatch we don't control**
     (`aws-cdk-lib`'s `Vpc` vs. `IVpc` disagree on `vpnGatewayId`'s
     optionality): fixed once, at the single point where the concrete `Vpc`
     is constructed (`NetworkConstruct`), with a narrow, commented `as
ec2.IVpc` cast and an interface-typed public property, rather than
     casting at every call site.
- `scripts/check-tsconfig-overrides.js` (+
  `apps/infra/test/tsconfig-overrides.test.ts`) fails CI if any package's
  `tsconfig.json` flips a base `true` flag to `false` without an adjacent
  `// ...` comment explaining why.
- Root `tsconfig.json` is a TypeScript "solution file" (`files: []` plus
  `references` to every package/app) - `tsc -b`/`npm run build` builds all
  five projects in dependency order, each still extending
  `tsconfig.base.json` on its own.

See also: [migration guide](../tsconfig-strictness-migration.md) for
adopting a _new_ strict flag added to the base in the future.
