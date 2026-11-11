import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { NetworkConstruct } from "@paraprosdokian-htf/network";
import { EksClusterConstruct } from "@paraprosdokian-htf/eks-cluster";
import { EcrConstruct } from "@paraprosdokian-htf/ecr";
import { BackendWorkloadConstruct } from "@paraprosdokian-htf/workloads";

/**
 * Composes the platform's construct packages into a single deployable stack.
 *
 * NOTE: the construct IDs below ("Network", "EksCluster", "Ecr",
 * "BackendWorkload") determine CloudFormation logical IDs. Renaming them, or
 * moving a construct into a different stack, will cause CloudFormation to
 * replace the underlying resources (VPC, cluster, ...). Treat them as stable.
 */
export class ParaprosdokianHtfStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const clusterName: string =
      this.node.tryGetContext("clusterName") ?? "paraprosdokian-htf";
    const allowedPublicEndpointCidrs = parseStringListContext(
      this.node.tryGetContext("allowedPublicEndpointCidrs"),
      "allowedPublicEndpointCidrs",
    );
    const clusterAdminPrincipalArn: string | undefined =
      this.node.tryGetContext("clusterAdminPrincipalArn");

    const network = new NetworkConstruct(this, "Network", {
      maxAzs: 3,
      natGateways: 3,
    });

    const eksCluster = new EksClusterConstruct(this, "EksCluster", {
      vpc: network.vpc,
      clusterName,
      allowedPublicEndpointCidrs,
      clusterAdminPrincipalArn,
    });

    const ecrRepo = new EcrConstruct(this, "Ecr", {
      repositoryName: `${clusterName}-backend`,
    });

    new BackendWorkloadConstruct(this, "BackendWorkload", {
      cluster: eksCluster.cluster,
    });

    new cdk.CfnOutput(this, "VpcId", { value: network.vpc.vpcId });
    new cdk.CfnOutput(this, "ClusterName", {
      value: eksCluster.cluster.clusterName,
    });
    new cdk.CfnOutput(this, "ClusterEndpoint", {
      value: eksCluster.cluster.clusterEndpoint,
    });
    new cdk.CfnOutput(this, "EcrRepositoryUri", {
      value: ecrRepo.repository.repositoryUri,
    });
    new cdk.CfnOutput(this, "UpdateKubeconfigCommand", {
      value: `aws eks update-kubeconfig --name ${eksCluster.cluster.clusterName} --region ${this.region}`,
    });
  }
}

/**
 * Context from cdk.json can be a real JSON array, but values passed on the
 * command line (`-c key=value`) always arrive as strings. Accept both, plus a
 * comma-separated string, so `-c allowedPublicEndpointCidrs='["a","b"]'` and
 * `-c allowedPublicEndpointCidrs=a,b` behave the same as the cdk.json array.
 */
function parseStringListContext(value: unknown, key: string): string[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  let list: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    list = trimmed.startsWith("[")
      ? JSON.parse(trimmed)
      : trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) {
    throw new Error(
      `Context value '${key}' must be a list of strings, got: ${JSON.stringify(value)}`,
    );
  }
  return list;
}
