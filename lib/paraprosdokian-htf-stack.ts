import * as cdk from "aws-cdk-lib/core";
import { Construct } from "constructs";
import { NetworkConstruct } from "./constructs/network";
import { EksClusterConstruct } from "./constructs/eks-cluster";
import { EcrConstruct } from "./constructs/ecr";
import { BackendWorkloadConstruct } from "./constructs/backend-workload";

export class ParaprosdokianHtfStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const clusterName: string =
      this.node.tryGetContext("clusterName") ?? "paraprosdokian-htf";
    const allowedPublicEndpointCidrs: string[] =
      this.node.tryGetContext("allowedPublicEndpointCidrs") ?? [];
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
