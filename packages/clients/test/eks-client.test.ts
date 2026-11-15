import { DescribeClusterCommand, EKSClient, ResourceNotFoundException } from "@aws-sdk/client-eks";
import { mockClient } from "aws-sdk-client-mock";
import { EksClient } from "../src";

const eks = mockClient(EKSClient);
beforeEach(() => eks.reset());

describe("EksClient", () => {
  test("describeCluster sends exactly one DescribeClusterCommand with the cluster name", async () => {
    eks.on(DescribeClusterCommand).resolves({ cluster: { name: "prod" } });

    await new EksClient().describeCluster("prod");

    // Exactly one SDK call was made, and it was a DescribeClusterCommand.
    expect(eks.calls()).toHaveLength(1);
    const [call] = eks.commandCalls(DescribeClusterCommand);
    expect(call).toBeDefined();
    // toEqual (not toMatchObject) so unexpected extra parameters also fail the test.
    expect(call.args[0].input).toEqual({ name: "prod" });
  });

  test("describeCluster returns the cluster", async () => {
    eks
      .on(DescribeClusterCommand, { name: "prod" })
      .resolves({ cluster: { name: "prod", status: "ACTIVE" } });

    await expect(new EksClient().describeCluster("prod")).resolves.toMatchObject({
      name: "prod",
      status: "ACTIVE",
    });
  });

  test("describeCluster throws when no cluster is returned", async () => {
    eks.on(DescribeClusterCommand).resolves({});

    await expect(new EksClient().describeCluster("prod")).rejects.toThrow("no cluster for 'prod'");
  });

  test("describeCluster propagates ResourceNotFoundException", async () => {
    eks
      .on(DescribeClusterCommand)
      .rejects(new ResourceNotFoundException({ message: "not found", $metadata: {} }));

    await expect(new EksClient().describeCluster("missing")).rejects.toBeInstanceOf(
      ResourceNotFoundException,
    );
  });
});
