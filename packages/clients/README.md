# @htf/clients

Small, class-based wrappers around the AWS SDK v3 for the STS, ECR, EKS and
EC2 calls this repo uses.

**Scripts in this repo should use this package instead of importing
`@aws-sdk/*` directly.** If a script needs an AWS call that isn't here, add it
to this package (see [Adding an operation](#adding-an-operation)) rather than
calling the SDK from the script.

## Why not use `@aws-sdk/*` directly?

### 1. Scripts can be tested with plain fakes

Each wrapper has an interface (`IStsClient`, `IEcrClient`, `IEksClient`,
`IEc2Client`). A script that accepts these interfaces can be unit-tested with
ordinary objects: no SDK client, no `aws-sdk-client-mock`, and no need to
build SDK error types.

A script that calls the SDK directly can only be tested by mocking the SDK
itself. That ties its tests to SDK command classes and response shapes. See
`test/interfaces.test.ts` for a worked example.

### 2. Pagination is handled for you

A single SDK call can return only part of the results. For example, ECR's
`DescribeImages` returns at most 100 images per call, plus a `nextToken` for
the rest. Code that does `client.send(new DescribeImagesCommand(...))` once
gets no error and misses everything after the first page.

`describeImages`, `describeVpcs` and `describeSubnets` follow every page token
and return the complete list. EC2's `DescribeAvailabilityZones` isn't paginated
and returns all zones in one response.

### 3. One region and one set of credentials for every client

`AwsClientFactory` creates all four clients from one configuration. Without
it, each script builds its own SDK clients, and they're easy to configure
inconsistently: one gets an explicit region or profile, and another is left to
the environment. The script then checks one account or region but acts on
another.

```ts
import { fromIni } from "@aws-sdk/credential-providers";
import { AwsClientFactory } from "@htf/clients";

const factory = new AwsClientFactory({
  region: "eu-west-1",
  credentials: fromIni({ profile: "deploy" }),
});
const sts = factory.createStsClient();
const ecr = factory.createEcrClient();
```

Options you leave unset fall back to the SDK's defaults (`AWS_REGION`, the
shared config file, the default credential chain).

### 4. Simpler results and clearer errors

- Methods return the data, not the SDK response wrapper (`$metadata` etc.).
- Missing lists come back as `[]`, not `undefined`.
- Where the SDK marks a field optional but AWS always returns it, the wrapper
  checks it once. `getCallerIdentity()` returns `{ account, arn, userId }` as
  plain strings, and `describeCluster()` returns a `Cluster`, not
  `Cluster | undefined`. If AWS ever omits them, the call throws a clear error
  instead of passing `undefined` into your script.

### 5. Known pitfalls are documented in one place

The interface docs state the behaviour callers depend on. For example:

- `describeImages` **throws** if any requested image doesn't exist. This is
  ECR's `ImageNotFoundException`.
- `batchGetImage` **reports** missing images in `failures` instead, so use it
  for "does this tag exist?" checks and for resolving a tag to a digest.

### 6. One place to change when the SDK or our needs change

SDK versions, pagination, error handling and tests for every AWS call the
repo makes all live in this package. Upgrading the SDK, or changing how a call
behaves, is one change, tested here, and not spread across scripts.

## What this package doesn't do

- **It doesn't hide the SDK's data types.** Methods return SDK types such as
  `Cluster`, `Vpc`, `Subnet` and `ImageDetail`, and take `ImageIdentifier` and
  `Filter`. These are plain data shapes, so fakes can return just the fields a
  test needs. Scripts still compile against `@aws-sdk/*` types, but don't need
  an SDK client.
- **It doesn't configure retries, timeouts or endpoints.** `AwsClientFactory`
  shares only `region` and `credentials`.
- **Nothing enforces the "don't import `@aws-sdk/*`" rule yet.** It's a
  convention. A lint rule such as ESLint's `no-restricted-imports` could
  enforce it once the repo has linting. Importing SDK helpers and types only
  to pass into this package is fine: for example, credential providers from
  `@aws-sdk/credential-providers`, or the `Filter` type.

## Usage

### Add the dependency

In the `package.json` of the workspace package that contains your script:

```json
{
  "dependencies": {
    "@htf/clients": "*"
  }
}
```

Then run `npm install` from the repo root. npm links the local package
instead of downloading it.

The package's entry point is its compiled output (`dist/`), so build it before
running scripts that use it: `npm run build` from the repo root, or
`npm run build -w @htf/clients`.

### Write the script against the interfaces

Take the interfaces as parameters, and create the real clients only at the
script's entry point:

```ts
import { AwsClientFactory, IEcrClient, IStsClient } from "@htf/clients";

export async function preDeployCheck(
  sts: IStsClient,
  ecr: IEcrClient,
  account: string,
  repo: string,
  tag: string,
) {
  const identity = await sts.getCallerIdentity();
  if (identity.account !== account) {
    throw new Error(`Expected account ${account}, but credentials are for ${identity.account}`);
  }
  const { failures } = await ecr.batchGetImage(repo, [{ imageTag: tag }]);
  if (failures.length > 0) {
    throw new Error(`Image ${repo}:${tag} not found`);
  }
}

// Entry point: the only place that creates real clients.
if (require.main === module) {
  const factory = new AwsClientFactory(); // region and credentials from the environment
  preDeployCheck(
    factory.createStsClient(),
    factory.createEcrClient(),
    "123456789012",
    "backend",
    "v1",
  ).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
```

### Test it with fakes

```ts
import { IEcrClient, IStsClient } from "@htf/clients";
import { preDeployCheck } from "./pre-deploy-check";

const sts: IStsClient = {
  getCallerIdentity: async () => ({
    account: "123456789012",
    arn: "arn:aws:iam::123456789012:user/ci",
    userId: "AIDA",
  }),
};
const ecr: IEcrClient = {
  describeImages: async () => [],
  batchGetImage: async (_repo, imageIds) => ({
    images: [],
    failures: imageIds.map((imageId) => ({ imageId })),
  }),
};

test("fails when the image tag is missing", async () => {
  await expect(preDeployCheck(sts, ecr, "123456789012", "backend", "v1")).rejects.toThrow(
    "not found",
  );
});
```

## API

| Class (interface)          | Method                                                                             | Returns                       |
| -------------------------- | ---------------------------------------------------------------------------------- | ----------------------------- |
| `StsClient` (`IStsClient`) | `getCallerIdentity()`                                                              | `{ account, arn, userId }`    |
| `EcrClient` (`IEcrClient`) | `describeImages(repositoryName, imageIds?)`                                        | `ImageDetail[]` (all pages)   |
|                            | `batchGetImage(repositoryName, imageIds)`                                          | `{ images, failures }`        |
| `EksClient` (`IEksClient`) | `describeCluster(name)`                                                            | `Cluster`                     |
| `Ec2Client` (`IEc2Client`) | `describeVpcs({ vpcIds?, filters? })`                                              | `Vpc[]` (all pages)           |
|                            | `describeSubnets({ subnetIds?, filters? })`                                        | `Subnet[]` (all pages)        |
|                            | `describeAvailabilityZones({ zoneNames?, filters?, allAvailabilityZones? })`       | `AvailabilityZone[]`          |
| `AwsClientFactory`         | `createStsClient()`, `createEcrClient()`, `createEksClient()`, `createEc2Client()` | the interface for each client |

Each class's constructor also accepts SDK client config or an existing SDK
client, for the rare case where one client needs different settings from the
factory's.

## Adding an operation

1. Add the method to the interface, with docs describing the behaviour callers
   depend on (pagination, what throws, what comes back empty).
2. Implement it in the class. Use the SDK's `paginate*` helper if the
   operation is paginated, and return the data rather than the SDK response.
3. Test it in `test/<client>.test.ts` with `aws-sdk-client-mock`. Check the
   exact command input with `toEqual`, check the call count, and cover
   pagination if it applies. `test/eks-client.test.ts` is the reference.
4. Add it to the API table above.

## Development

```sh
npm run build -w @htf/clients   # compile to dist/
npm test -w @htf/clients        # run the tests
```
