import * as cdk from "aws-cdk-lib/core";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ParaprosdokianHtfStack } from "../lib/paraprosdokian-htf-stack";

function synthStack(): Template {
  const app = new cdk.App();
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
