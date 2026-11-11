# paraprosdokian-htf

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

Targeting a single workspace:

- `npm test -w @paraprosdokian-htf/eks-cluster` test one package
- `npx jest packages/network` run one package's tests from the root (after `npm run build`)

Tests only transpile TypeScript; the `typecheck` step (part of `npm test`) handles type errors. Type-checking
inside Jest re-loads the `aws-cdk-lib` type definitions for every test file, which grows memory by about 450 MB
per file and can run out of memory on small CI runners.

`cdk watch` only watches files inside `apps/infra` (the CDK CLI limits watching to the directory that holds
`cdk.json`). Edits under `packages/` are picked up by the next `cdk synth/diff/deploy`, but they won't trigger
a watch cycle on their own.

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
