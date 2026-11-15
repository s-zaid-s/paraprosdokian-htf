import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { StsClient } from "../src";

const sts = mockClient(STSClient);
beforeEach(() => sts.reset());

describe("StsClient", () => {
  test("getCallerIdentity maps the response", async () => {
    sts.on(GetCallerIdentityCommand).resolves({
      Account: "123456789012",
      Arn: "arn:aws:iam::123456789012:user/me",
      UserId: "AIDA",
    });

    await expect(new StsClient().getCallerIdentity()).resolves.toEqual({
      account: "123456789012",
      arn: "arn:aws:iam::123456789012:user/me",
      userId: "AIDA",
    });
  });

  test("getCallerIdentity throws on an incomplete response", async () => {
    sts.on(GetCallerIdentityCommand).resolves({ Arn: "arn" });

    await expect(new StsClient().getCallerIdentity()).rejects.toThrow("incomplete identity");
  });

  test("reuses an existing SDK client", async () => {
    const existing = new STSClient({ region: "eu-west-1" });
    sts.on(GetCallerIdentityCommand).resolves({ Account: "1", Arn: "a", UserId: "u" });

    await new StsClient(existing).getCallerIdentity();

    expect(sts.call(0).thisValue).toBe(existing);
  });

  test("creates a client from config", async () => {
    const client = new StsClient({ region: "eu-west-1" });
    sts.on(GetCallerIdentityCommand).resolves({ Account: "1", Arn: "a", UserId: "u" });

    await client.getCallerIdentity();

    await expect((sts.call(0).thisValue as STSClient).config.region()).resolves.toBe("eu-west-1");
  });
});
