import * as cdk from "aws-cdk-lib/core";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ParaprosdokianHtfStack } from "../lib/paraprosdokian-htf-stack";

function synthStack(context?: Record<string, unknown>): Template {
  // Omit the key entirely when absent, rather than passing `context:
  // undefined` (AppProps.context isn't `| undefined`-typed, so
  // `exactOptionalPropertyTypes` rejects an explicit `undefined`).
  const app = new cdk.App(context !== undefined ? { context } : {});
  // Environment-agnostic: avoids live AWS AZ-lookup calls during synth/tests.
  const stack = new ParaprosdokianHtfStack(app, "MyTestStack");
  return Template.fromStack(stack);
}

test("creates an EKS cluster", () => {
  const template = synthStack();
  template.hasResourceProperties("Custom::AWSCDK-EKS-Cluster", {
    Config: Match.objectLike({ name: "paraprosdokian-htf" }),
  });
});

test("creates two managed node groups", () => {
  const template = synthStack();
  template.resourceCountIs("AWS::EKS::Nodegroup", 2);
});

test("creates a multi-tier, multi-AZ VPC", () => {
  // Synthesized env-agnostic, so AZ count (and therefore NAT gateway count)
  // falls back to 2 instead of the real deployment's maxAzs: 3.
  const template = synthStack();
  template.resourceCountIs("AWS::EC2::VPC", 1);
  template.resourceCountIs("AWS::EC2::NatGateway", 2);
  template.resourceCountIs("AWS::EC2::Subnet", 6);
});

test("creates an encrypted ECR repository", () => {
  const template = synthStack();
  template.hasResourceProperties("AWS::ECR::Repository", {
    ImageScanningConfiguration: { ScanOnPush: true },
  });
});

describe("allowedPublicEndpointCidrs context", () => {
  const publicAccessCidrs = (template: Template) => {
    const [cluster] = Object.values(template.findResources("Custom::AWSCDK-EKS-Cluster"));
    if (!cluster) throw new Error("expected exactly one EKS cluster resource");
    return cluster.Properties.Config.resourcesVpcConfig.publicAccessCidrs;
  };

  test.each([
    ["a JSON array (cdk.json)", ["203.0.113.0/24", "198.51.100.0/24"]],
    ["a JSON string (cdk -c)", '["203.0.113.0/24", "198.51.100.0/24"]'],
    ["a comma-separated string (cdk -c)", "203.0.113.0/24,198.51.100.0/24"],
  ])("accepts %s", (_, value) => {
    const template = synthStack({ allowedPublicEndpointCidrs: value });
    expect(publicAccessCidrs(template)).toEqual(["203.0.113.0/24", "198.51.100.0/24"]);
  });

  test("rejects values that are not a list of strings", () => {
    expect(() => synthStack({ allowedPublicEndpointCidrs: "[1, 2]" })).toThrow(
      /must be a list of strings/,
    );
  });
});
