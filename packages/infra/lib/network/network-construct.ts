import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { INetwork } from './types';

export interface NetworkConstructProps {
  /**
   * CIDR block for the VPC.
   * @default '10.0.0.0/16'
   */
  readonly cidr?: string;

  /**
   * Maximum number of Availability Zones to use.
   * @default 2
   */
  readonly maxAzs?: number;

  /**
   * Number of NAT gateways for the private subnets' egress.
   * @default 1
   */
  readonly natGateways?: number;
}

/**
 * Provisions a VPC with public and private subnets and a default security
 * group. Exposes the result through the `INetwork` contract.
 */
export class NetworkConstruct extends Construct implements INetwork {
  public readonly vpc: ec2.IVpc;
  public readonly vpcId: string;
  public readonly publicSubnets: ec2.ISubnet[];
  public readonly privateSubnets: ec2.ISubnet[];
  public readonly securityGroups: ec2.ISecurityGroup[];

  constructor(scope: Construct, id: string, props: NetworkConstructProps = {}) {
    super(scope, id);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(props.cidr ?? '10.0.0.0/16'),
      maxAzs: props.maxAzs ?? 2,
      natGateways: props.natGateways ?? 1,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    const defaultSecurityGroup = new ec2.SecurityGroup(this, 'DefaultSecurityGroup', {
      vpc,
      description: 'Default security group for workloads in this network',
      allowAllOutbound: true,
    });

    this.vpc = vpc;
    this.vpcId = vpc.vpcId;
    this.publicSubnets = vpc.publicSubnets;
    this.privateSubnets = vpc.privateSubnets;
    this.securityGroups = [defaultSecurityGroup];
  }
}
