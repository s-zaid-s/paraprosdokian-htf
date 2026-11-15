import {
  CallerIdentity,
  Ec2Client,
  EcrClient,
  EksClient,
  IEc2Client,
  IEcrClient,
  IEksClient,
  IStsClient,
  StsClient,
} from "../src";

// Example caller that depends only on the abstractions: a pre-deploy check
// that the expected account is in use and the image tag exists.
async function preDeployCheck(
  sts: IStsClient,
  ecr: IEcrClient,
  expected: { account: string; repository: string; tag: string },
): Promise<string[]> {
  const problems: string[] = [];
  const { account } = await sts.getCallerIdentity();
  if (account !== expected.account) {
    problems.push(`wrong account: ${account}`);
  }
  const { failures } = await ecr.batchGetImage(expected.repository, [{ imageTag: expected.tag }]);
  if (failures.length > 0) {
    problems.push(`image not found: ${expected.repository}:${expected.tag}`);
  }
  return problems;
}

// Plain fakes: no SDK client and no aws-sdk-client-mock needed.
const fakeSts = (identity: CallerIdentity): IStsClient => ({
  getCallerIdentity: async () => identity,
});
const fakeEcr = (existingTags: string[]): IEcrClient => ({
  describeImages: async () => [],
  batchGetImage: async (_repo, imageIds) => ({
    images: imageIds
      .filter((id) => existingTags.includes(id.imageTag!))
      .map((imageId) => ({ imageId })),
    failures: imageIds
      .filter((id) => !existingTags.includes(id.imageTag!))
      .map((imageId) => ({ imageId })),
  }),
});

describe("client interfaces", () => {
  const expected = { account: "123456789012", repository: "backend", tag: "v1" };
  const identity = {
    account: "123456789012",
    arn: "arn:aws:iam::123456789012:user/me",
    userId: "AIDA",
  };

  test("callers can be tested with plain fakes", async () => {
    await expect(preDeployCheck(fakeSts(identity), fakeEcr(["v1"]), expected)).resolves.toEqual([]);
  });

  test("fakes drive failure paths without AWS error shapes", async () => {
    const problems = await preDeployCheck(
      fakeSts({ ...identity, account: "999999999999" }),
      fakeEcr([]),
      expected,
    );

    expect(problems).toEqual(["wrong account: 999999999999", "image not found: backend:v1"]);
  });

  test("the SDK-backed classes satisfy the interfaces", () => {
    // Compile-time check: these assignments fail to type-check if a class drifts from its interface.
    const clients: [IStsClient, IEcrClient, IEksClient, IEc2Client] = [
      new StsClient({ region: "us-east-1" }),
      new EcrClient({ region: "us-east-1" }),
      new EksClient({ region: "us-east-1" }),
      new Ec2Client({ region: "us-east-1" }),
    ];

    expect(clients).toHaveLength(4);
  });
});
