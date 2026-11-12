import { App, Stack } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Match, Template } from "aws-cdk-lib/assertions";
import { EksClusterConstruct, EksClusterConstructProps } from "../src";

function synth(props: Partial<EksClusterConstructProps> = {}): Template {
  const stack = new Stack(new App(), "TestStack");
  // `as ec2.IVpc`: see ADR 0001 (Vpc/IVpc + exactOptionalPropertyTypes).
  const vpc = new ec2.Vpc(stack, "Vpc") as ec2.IVpc;
  new EksClusterConstruct(stack, "EksCluster", {
    vpc,
    clusterName: "test-cluster",
    // Listed explicitly (not just left to `...props`): it's a required key
    // on `EksClusterConstructProps` (`string | undefined`, not `?:`), and
    // spreading a `Partial<...>` can't guarantee a required key is present.
    clusterAdminPrincipalArn: undefined,
    ...props,
  });
  return Template.fromStack(stack);
}

// One synth shared by the read-only assertions below (EKS synth is slow).
let template: Template;
beforeAll(() => {
  template = synth();
});

test("creates the cluster with secrets encryption and full audit logging", () => {
  template.hasResourceProperties("Custom::AWSCDK-EKS-Cluster", {
    Config: Match.objectLike({
      name: "test-cluster",
      version: "1.32",
      encryptionConfig: [Match.objectLike({ resources: ["secrets"] })],
      logging: {
        clusterLogging: [
          Match.objectLike({
            enabled: true,
            types: Match.arrayWith([
              "api",
              "audit",
              "authenticator",
              "controllerManager",
              "scheduler",
            ]),
          }),
        ],
      },
    }),
  });
  template.hasResourceProperties("AWS::KMS::Key", {
    EnableKeyRotation: true,
  });
});

test("creates system and app managed node groups", () => {
  template.resourceCountIs("AWS::EKS::Nodegroup", 2);
  template.hasResourceProperties("AWS::EKS::Nodegroup", {
    NodegroupName: "test-cluster-system",
    InstanceTypes: ["m6i.large"],
    AmiType: "AL2023_x86_64_STANDARD",
    Labels: { role: "system" },
  });
  template.hasResourceProperties("AWS::EKS::Nodegroup", {
    NodegroupName: "test-cluster-app",
    InstanceTypes: ["c6i.2xlarge"],
    Labels: { workload: "backend" },
    Tags: Match.objectLike({
      "k8s.io/cluster-autoscaler/test-cluster": "owned",
    }),
  });
});

test("installs the EKS-managed core addons", () => {
  template.resourceCountIs("AWS::EKS::Addon", 4);
  for (const addon of ["vpc-cni", "kube-proxy", "coredns", "aws-ebs-csi-driver"]) {
    template.hasResourceProperties("AWS::EKS::Addon", { AddonName: addon });
  }
});

test("installs Cluster Autoscaler, metrics-server and the ALB controller", () => {
  for (const chart of ["cluster-autoscaler", "metrics-server", "aws-load-balancer-controller"]) {
    template.hasResourceProperties("Custom::AWSCDK-EKS-HelmChart", {
      Chart: chart,
    });
  }
});

test("does not grant extra cluster-admin access by default", () => {
  template.resourceCountIs("AWS::EKS::AccessEntry", 0);
});

test("grants cluster-admin access to the configured principal", () => {
  const principalArn = "arn:aws:iam::111111111111:role/platform-admin";
  const entries = synth({
    clusterAdminPrincipalArn: principalArn,
  }).findResources("AWS::EKS::AccessEntry", {
    Properties: { PrincipalArn: principalArn },
  });
  const [entry] = Object.values(entries);
  if (!entry) throw new Error("expected exactly one matching access entry");
  // PolicyArn is a partition-aware Fn::Join, so match on its serialized form.
  expect(JSON.stringify(entry.Properties.AccessPolicies)).toContain(
    ":eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy",
  );
});

test("restricts the public endpoint to the allowed CIDRs", () => {
  synth({
    allowedPublicEndpointCidrs: ["203.0.113.0/24"],
  }).hasResourceProperties("Custom::AWSCDK-EKS-Cluster", {
    Config: Match.objectLike({
      resourcesVpcConfig: Match.objectLike({
        endpointPublicAccess: true,
        endpointPrivateAccess: true,
        publicAccessCidrs: ["203.0.113.0/24"],
      }),
    }),
  });
});
