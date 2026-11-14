# paraprosdokian-htf

[![CI](https://github.com/s-zaid-s/paraprosdokian-htf/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/s-zaid-s/paraprosdokian-htf/actions/workflows/ci.yml?query=branch%3Amain+event%3Apush)

This is an AWS CDK (TypeScript) monorepo that provisions an Amazon EKS cluster to serve as the backend platform
for a high-frequency trading operation.

It is an [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) monorepo: each piece of the platform is a
separately built and tested construct library under `packages/`. The single deployable CDK app under `apps/infra`
puts them together into a stack.

## Repository layout

```
.
├── package.json            # workspace root: shared dev tooling + orchestration scripts
├── tsconfig.base.json      # compiler options shared by every workspace
├── tsconfig.json           # solution file: `tsc -b` builds all workspaces in dependency order
├── jest.config.js          # runs every workspace's tests in one Jest invocation
├── jest.config.base.js     # shared Jest settings, extended by each workspace
├── packages/
│   ├── network/            # @paraprosdokian-htf/network      -> NetworkConstruct
│   ├── eks-cluster/        # @paraprosdokian-htf/eks-cluster  -> EksClusterConstruct
│   ├── ecr/                # @paraprosdokian-htf/ecr          -> EcrConstruct
│   └── workloads/          # @paraprosdokian-htf/workloads    -> BackendWorkloadConstruct
└── apps/
    └── infra/              # @paraprosdokian-htf/infra (deployable CDK app)
        ├── bin/            #   CDK app entrypoint
        ├── lib/            #   ParaprosdokianHtfStack: composes the packages
        ├── cdk.json        #   CDK CLI config + context
        └── cdk.context.json
```

Every workspace has the same layout: `src/` (or `bin/` + `lib/` for the app) compiles to `dist/`. Tests live
in `test/`, and `test/tsconfig.json` gives editors Jest types there.

The construct packages don't depend on each other. Each one takes plain `aws-cdk-lib` types as input (for
example `EksClusterConstruct` takes an `ec2.IVpc`, and `BackendWorkloadConstruct` takes an `eks.ICluster`), and
only `apps/infra` wires them together. Keep it that way: it lets each package be tested, versioned and reused
on its own.

`aws-cdk-lib` and `constructs` are **peer dependencies** of the packages. That way the whole workspace uses a
single copy of each, which CDK needs to pass constructs between packages. If you add a package, follow the same
pattern (see [Adding a package](#adding-a-package)).

## Architecture

```
@paraprosdokian-htf/network
  NetworkConstruct     3-AZ VPC: public / private-with-egress / isolated subnets,
                       VPC flow logs, S3 gateway endpoint, ECR/STS/logs/EKS
                       interface endpoints (keeps control traffic off the public
                       internet), 1 NAT gateway per AZ for HA egress.

@paraprosdokian-htf/eks-cluster
  EksClusterConstruct  EKS cluster (K8s 1.32) with:
                         - KMS-encrypted Kubernetes secrets (envelope encryption)
                         - Full control-plane audit logging to CloudWatch
                         - Two managed node groups: "system" (m6i.large) and
                           "app" (c6i.2xlarge, labeled workload=backend)
                         - Nodes use IMDSv2, SSM Session Manager (no SSH),
                           AL2023 AMIs, node auto-repair
                         - EKS-managed addons: vpc-cni, kube-proxy, coredns,
                           aws-ebs-csi-driver (IRSA)
                         - AWS Load Balancer Controller (built-in construct)
                         - Cluster Autoscaler + metrics-server (Helm, IRSA)
                         - Optional EKS access entry for a human cluster admin

@paraprosdokian-htf/ecr
  EcrConstruct         Private, KMS-encrypted, scan-on-push ECR repository with
                       lifecycle rules for image retention.

@paraprosdokian-htf/workloads
  BackendWorkload      The "basic backend": a namespace with a ResourceQuota, a
  Construct            Deployment (liveness/readiness probes, resource
                       requests/limits), a PodDisruptionBudget, a ClusterIP
                       Service, an ALB Ingress, and a HorizontalPodAutoscaler.
                       Ships with a placeholder image - point it at your own
                       image in the ECR repo once you have one.

@paraprosdokian-htf/infra (apps/infra)
  ParaprosdokianHtfStack  Composes all of the above into one stack.
```

> **Construct IDs are load-bearing.** CloudFormation logical IDs come from the construct path
> (`ParaprosdokianHtfStack/Network/...`, `.../EksCluster/...`). The monorepo keeps the same IDs as the
> original single-package app, so it synthesizes an identical template. Renaming the IDs in
> `apps/infra/lib/paraprosdokian-htf-stack.ts`, or moving a construct into a different stack, will make
> CloudFormation **replace** the VPC, cluster, etc. Run `npm run diff` before deploying any such change.

## Configuration (`apps/infra/cdk.json` context)

| Key                          | Purpose                                                                 | Default              |
| ---------------------------- | ----------------------------------------------------------------------- | -------------------- |
| `clusterName`                | Name prefix for the cluster, node groups, ECR repo, KMS alias           | `paraprosdokian-htf` |
| `allowedPublicEndpointCidrs` | CIDR blocks allowed to reach the public Kubernetes API endpoint         | `[]` (unrestricted)  |
| `clusterAdminPrincipalArn`   | IAM user/role ARN to grant cluster-admin access via an EKS access entry | `null` (none)        |

Override any of these at the CLI, e.g.:

```sh
npm run deploy -- -c clusterAdminPrincipalArn=arn:aws:iam::111111111111:user/alice \
  -c allowedPublicEndpointCidrs='["203.0.113.0/24"]'
```

`allowedPublicEndpointCidrs` also accepts a comma-separated list on the CLI
(`-c allowedPublicEndpointCidrs=203.0.113.0/24,198.51.100.0/24`).

## Deploying

Use the Node.js version pinned in `.nvmrc` (CI uses the same file); `nvm use` or `fnm use` picks it up.
All commands below run from the repository root. The root `cdk`/`synth`/`diff`/`deploy` scripts forward to the
CDK CLI inside `apps/infra`. Anything after `--` is passed straight to `cdk`.

```sh
npm ci
npm run build
npm run cdk -- bootstrap   # once per account/region
npm run deploy
```

You can also work from the app directory directly: `cd apps/infra && npx cdk deploy`.

You don't need to run `npm run build` before each `cdk` command. `apps/infra/cdk.json` sets
`"build": "npm run build"`, so the CDK CLI incrementally compiles the app **and every package it references**
before each synth. The app then runs as plain compiled JavaScript (`node dist/bin/...`), with source maps so
stack traces point at the `.ts` sources.

After deploy, configure kubectl (the `UpdateKubeconfigCommand` stack output
has the exact command):

```sh
aws eks update-kubeconfig --name paraprosdokian-htf --region <region>
kubectl get nodes
kubectl -n backend get deploy,svc,ingress,hpa
```

Push your own image and point the Deployment at it:

```sh
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
docker build -t <account>.dkr.ecr.<region>.amazonaws.com/paraprosdokian-htf-backend:v1 .
docker push <account>.dkr.ecr.<region>.amazonaws.com/paraprosdokian-htf-backend:v1
kubectl -n backend set image deployment/backend-api backend-api=<account>.dkr.ecr.<region>.amazonaws.com/paraprosdokian-htf-backend:v1
```

## Useful commands

From the repository root:

- `npm run build` compile all workspaces in dependency order (`tsc -b`: TypeScript project references, incremental)
- `npm run watch` recompile all workspaces on change
- `npm run clean` remove all build output
- `npm run typecheck` type-check all sources **and** tests
- `npm test` type-check, then run every workspace's Jest suite
- `npm run synth` emit the synthesized CloudFormation template
- `npm run diff` compare the deployed stack with the current state
- `npm run deploy` deploy the stack to your default AWS account/region
- `npm run snapshot:check` synthesize and fail if the templates differ from the committed snapshot (see below)
- `npm run snapshot:update` synthesize and overwrite the committed snapshot

Targeting a single workspace:

- `npm test -w @paraprosdokian-htf/eks-cluster` test one package
- `npx jest packages/network` run one package's tests from the root (after `npm run build`)

Tests only transpile TypeScript; the `typecheck` step (part of `npm test`) handles type errors. It checks every
workspace's tests in a single `tsc --build` process (`scripts/typecheck-tests.js`), so `aws-cdk-lib`'s type definitions
are parsed once rather than once per workspace. Type-checking inside Jest re-loads the `aws-cdk-lib` type definitions
for every test file, which grows memory by about 450 MB per file and can run out of memory on small CI runners.

`cdk watch` only watches files inside `apps/infra` (the CDK CLI limits watching to the directory that holds
`cdk.json`). Edits under `packages/` are picked up by the next `cdk synth/diff/deploy`, but they won't trigger
a watch cycle on their own.

## Git hooks

`npm install` (or `npm ci`) sets up two hooks with [husky](https://typicode.github.io/husky/), via the root
`postinstall` script (`.husky/install.mjs`). There's no separate setup step. If dev dependencies are omitted
(`--omit=dev`, `NODE_ENV=production`) or there's no `.git` directory, the install still succeeds and just skips the hooks.

If you install with `--ignore-scripts`, or have `ignore-scripts=true` in your npm config (check with
`npm config get ignore-scripts`), npm skips `postinstall` and the hooks are **not** set up, without any warning.
Set them up once by hand after installing:

```sh
node .husky/install.mjs
```

This only needs to be done once per clone. It's safe to rerun, and it runs only husky's setup, not any dependency's
install scripts.

**pre-commit:** on each `git commit`, [lint-staged](https://github.com/lint-staged/lint-staged) runs on the
**staged** files only:

- `*.ts`: `eslint --fix`, then `prettier --write`
- everything else Prettier can format: `prettier --write`

Fixes are added to the commit automatically. If an error can't be auto-fixed (e.g. `no-explicit-any`), the commit
is aborted and your changes are left as they were. Files listed in `.prettierignore` are never reformatted, including
the byte-exact `apps/infra/snapshot/`. The config lives in `lint-staged.config.mjs`.

**pre-push:** on each `git push`, `npm test` runs for the whole monorepo (every workspace's type-check and Jest
suite, about 1-2 minutes). A failure blocks the push. Pushes that only delete remote branches skip the tests. The tests
run against your **working tree**, so the hook warns when that isn't what you're pushing: when you have uncommitted
changes, or are pushing a branch other than the one checked out.

### Skipping hooks (`--no-verify`)

> [!WARNING]
> Skipping a hook doesn't skip the check. CI runs lint, formatting, type-checks, every test and the synth snapshot
> check on every PR, so anything a hook would have caught still fails there, just later and in front of reviewers.
> Use the escape hatch to get unblocked, not to get code merged.

| To skip                           | Use                                                    |
| --------------------------------- | ------------------------------------------------------ |
| pre-commit, for one commit        | `git commit --no-verify` (or `git commit -n`)          |
| pre-push, for one push            | `git push --no-verify`                                 |
| both hooks, for the whole session | `export HUSKY=0` (remember to `unset HUSKY` afterward) |

**Don't use `git push -n`:** for `push`, `-n` means `--dry-run`, not `--no-verify`. The hook still runs the full test
suite, and then nothing is pushed.

**Reasonable reasons to skip:**

- **Saving or sharing work in progress on your own branch.** A WIP commit you'll squash later, or a push to back up
  your work or to show someone a failing test. Open the PR as a draft until the checks pass.
- **The hook is broken, not your code.** For example, a tool crashes or your environment can't run it. Skip once, then
  fix the hook or report the problem, so skipping doesn't become a habit.
- **You've just run the same checks yourself.** For example, `npm test` on exactly the commit you're pushing, with a
  clean working tree. Running the pre-push tests again adds nothing.

**Don't skip:**

- **To get failing tests, lint errors or unformatted code into a PR you intend to merge.** CI will reject it anyway.
  Skipping pre-commit also leaves the file unformatted, and lint-staged formats whole files. The next person to touch
  that file then gets your formatting fixes in their diff.
- **When pushing to `main` or a release branch.** CI on `main` runs only after the code has landed.
- **Because the hooks feel slow.** Say so instead, so they can be made faster. Routinely skipping them makes them
  useless for everyone.

**After skipping,** run the checks yourself before you mark the PR ready for review:

```sh
npm run lint && npm run format:check && npm test && npm run snapshot:check
```

Hooks run on your machine, and nothing can stop `--no-verify`. The real gate is CI. Make sure the CI job
(`Install, build, lint, test, synth`) is a **required status check** for `main` in the repository's branch protection
settings. Then no skipped hook can get failing code merged.

## Synth snapshot (drift detection)

`apps/infra/snapshot/` holds the CloudFormation templates that `cdk synth` produces for the app. CI runs
`npm run snapshot:check` on every PR and fails if the current synth output differs from them. Any change to the
synthesized infrastructure, whether from our code, a context value or a dependency bump, must therefore update the
snapshot in the same PR. Reviewers then see the exact template diff next to the code that caused it.

When the check fails and the change is intended:

```sh
npm run snapshot:update
git add apps/infra/snapshot
```

CI also uploads the templates it synthesized as a `synth-snapshot` artifact on the failed run. They are identical to what
`snapshot:update` writes.

The snapshot doesn't depend on who runs it. `scripts/synth-snapshot.js` synthesizes with your AWS credentials hidden,
for the account/region whose lookups are cached in `apps/infra/cdk.context.json`, with `--no-lookups` (no AWS calls).
It also leaves out the `AWS::CDK::Metadata` resource, which changes on every CDK version bump. Some dependency bumps
still change the snapshot, for example when a new `aws-cdk-lib` ships updated custom-resource Lambda code (new asset
hashes) or runtimes. That is a real change to what gets deployed, so commit it with the bump. For Dependabot's PRs
this happens automatically (see below).

## Dependency updates

[Dependabot](.github/dependabot.yml) opens update PRs every Monday, for npm packages and for the GitHub Actions used
in CI:

- **Grouping:**
  - one PR per CDK release (`aws-cdk-lib`, the `aws-cdk` CLI, `constructs` and `@aws-cdk/*`);
  - one PR for all other minor and patch updates;
  - one PR per major update, so each breaking change is reviewed on its own.
- **Cooldown:** a release is proposed only after it has been public for 3 days, so a compromised or broken version is
  usually pulled before it reaches a PR. Security updates aren't delayed.
- **Never updated:** the internal `@htf/*` and `@paraprosdokian-htf/*` workspace packages, so they always resolve to
  the local copy. Major versions of `@types/node` are also skipped; bump them by hand together with `.nvmrc`.

**Snapshot updates.** A dependency update can change the synthesized templates, for example a new Lambda runtime or new
`kubectl`/`helm` versions in the EKS Lambda layer, so Dependabot's PR would fail the snapshot drift check. For
Dependabot's npm PRs, the
[Dependabot snapshot update](.github/workflows/dependabot-snapshot.yml) workflow regenerates `apps/infra/snapshot/`,
commits it to the PR as `github-actions[bot]`, and starts CI on that commit. Expect the first CI run on Dependabot's
own commit to fail the drift check; the run on the snapshot commit is the one that counts.

The workflow is split into two jobs so the updated dependencies' code never runs with write access:

- **Synthesize snapshot:** installs the dependencies and synthesizes the templates, with a read-only token.
- **Commit snapshot to the PR:** runs no npm code. It accepts only well-formed `*.template.json` files from the first
  job, then commits and pushes them.

**Reviewing these PRs:**

- **Review the snapshot diff.** It shows exactly how the update changes what gets deployed (runtimes, binary
  versions, asset hashes). Treat it like any other infrastructure change, and run `npm run diff` before deploying.
- **Never auto-merge a PR that changes the snapshot.**
- **If the PR falls behind `main`,** comment `@dependabot rebase`. The snapshot commit counts as an edit, so Dependabot
  won't rebase on its own. A rebase replaces the branch, and the workflow then regenerates the snapshot.
- **If you bump a CDK package yourself** (not via Dependabot), run `npm run snapshot:update` and commit the result.

## Adding a package

Internal dependencies use the `"*"` version range. npm links a workspace only while its version satisfies
the range. With a range like `^0.1.0`, bumping a package to `1.0.0` would make `npm install` fetch
`@paraprosdokian-htf/<name>` from the **public registry** instead: a dependency-confusion risk for the app
that deploys your infrastructure. `"*"` always resolves to the local workspace.

1. Copy an existing package (e.g. `packages/ecr`), then rename it in its `package.json`
   (`@paraprosdokian-htf/<name>`).
2. Keep `aws-cdk-lib` and `constructs` in **`peerDependencies`** (and `devDependencies`), never in
   `dependencies`.
3. Add `{ "path": "packages/<name>" }` to the root `tsconfig.json` references. If the new package imports
   another `@paraprosdokian-htf/*` package, also add `"references": [{ "path": "../<other>" }]` to the
   new package's own `tsconfig.json`. `tsc -b` gets its build order from these per-project references,
   not from the order of the root list.
4. If the app uses it, add `"@paraprosdokian-htf/<name>": "*"` to `apps/infra/package.json` `dependencies`
   and add the package to the `references` in `apps/infra/tsconfig.json`. Import it only by package name
   (`from "@paraprosdokian-htf/<name>"`), never by a relative or `dist/` path.
5. Run `npm install` to link the new workspace.
