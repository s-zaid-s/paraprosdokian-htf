import * as ec2 from 'aws-cdk-lib/aws-ec2';

/**
 * The networking resources that downstream constructs depend on.
 *
 * Downstream constructs (compute, databases, load balancers, ...) should accept
 * an `INetwork` rather than a concrete `NetworkConstruct`. This keeps them
 * decoupled from how the network is provisioned: it may be created by
 * `NetworkConstruct`, imported from another stack, or stubbed in tests.
 */
export interface INetwork {
  /** ID of the VPC. */
  readonly vpcId: string;

  /**
   * The VPC itself, for CDK L2 constructs that require an `ec2.IVpc`
   * (e.g. `lambda.Function`, `rds.DatabaseInstance`, `ecs.Cluster`).
   */
  readonly vpc: ec2.IVpc;

  /** Subnets with a route to an Internet Gateway (e.g. for public load balancers). */
  readonly publicSubnets: ec2.ISubnet[];

  /** Subnets with egress via NAT but no inbound internet access (e.g. for application workloads). */
  readonly privateSubnets: ec2.ISubnet[];

  /** Security groups that downstream resources should attach. */
  readonly securityGroups: ec2.ISecurityGroup[];
}
