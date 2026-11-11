import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { NetworkConstruct, NetworkConstructProps } from "../src";

// Stacks are environment-agnostic (no account/region), so CDK falls back to
// 2 AZs regardless of maxAzs - NAT gateway/subnet counts below reflect that.
function synth(props?: NetworkConstructProps): Template {
  const stack = new Stack(new App(), "TestStack");
  new NetworkConstruct(stack, "Network", props);
  return Template.fromStack(stack);
}

test("creates a VPC with the default CIDR", () => {
  synth().hasResourceProperties("AWS::EC2::VPC", {
    CidrBlock: "10.20.0.0/16",
  });
});

test("honours a custom CIDR", () => {
  synth({ cidr: "10.99.0.0/16" }).hasResourceProperties("AWS::EC2::VPC", {
    CidrBlock: "10.99.0.0/16",
  });
});

test("creates public, private-with-egress and isolated subnets per AZ", () => {
  const template = synth();
  template.resourceCountIs("AWS::EC2::Subnet", 6);
  for (const tier of ["public", "private-eks", "isolated-data"]) {
    template.hasResourceProperties("AWS::EC2::Subnet", {
      Tags: Match.arrayWith([
        { Key: "aws-cdk:subnet-name", Value: tier },
      ]),
    });
  }
});

test("creates one NAT gateway per AZ", () => {
  synth().resourceCountIs("AWS::EC2::NatGateway", 2);
});

test("enables VPC flow logs for all traffic", () => {
  synth().hasResourceProperties("AWS::EC2::FlowLog", {
    ResourceType: "VPC",
    TrafficType: "ALL",
    LogDestinationType: "cloud-watch-logs",
    MaxAggregationInterval: 60,
  });
});

test("creates the S3 gateway endpoint and private interface endpoints", () => {
  const template = synth();
  // 1 S3 gateway endpoint + ECR API, ECR DKR, STS, CloudWatch Logs, EKS.
  template.resourceCountIs("AWS::EC2::VPCEndpoint", 6);
  template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
    VpcEndpointType: "Gateway",
  });
  template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
    VpcEndpointType: "Interface",
    PrivateDnsEnabled: true,
  });
});
