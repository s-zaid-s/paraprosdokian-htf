import { RemovalPolicy } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface NetworkConstructProps {
  /**
   * Number of Availability Zones to spread the VPC across.
   * @default 3
   */
  readonly maxAzs?: number;
  /**
   * Number of NAT gateways. One per AZ gives HA egress for private subnets,
   * which matters for a trading backend that cannot tolerate a single NAT
   * gateway becoming a bottleneck or single point of failure.
   * @default 3
   */
  readonly natGateways?: number;
  /**
   * CIDR block for the VPC.
   * @default '10.20.0.0/16'
   */
  readonly cidr?: string;
}

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
   * (e.g. the EKS cluster, `rds.DatabaseInstance`, `ecs.Cluster`).
   */
  readonly vpc: ec2.IVpc;
  /** Subnets with a route to an Internet Gateway (e.g. for public load balancers). */
  readonly publicSubnets: ec2.ISubnet[];
  /** Subnets with egress via NAT but no inbound internet access (e.g. for workloads). */
  readonly privateSubnets: ec2.ISubnet[];
  /** Security groups that downstream resources should attach. */
  readonly securityGroups: ec2.ISecurityGroup[];
}

/**
 * Networking foundation for the cluster: a 3-tier VPC (public / private-egress
 * / isolated) with flow logs enabled for security auditing. Exposes the result
 * through the `INetwork` contract so downstream constructs depend on the
 * abstraction rather than this concrete class.
 */
export class NetworkConstruct extends Construct implements INetwork {
  // Typed as the interface, not the concrete class: `ec2.Vpc` declares
  // `vpnGatewayId` as `string | undefined` while `ec2.IVpc` declares it
  // optional (`vpnGatewayId?: string`), which `exactOptionalPropertyTypes`
  // treats as incompatible. Exposing the interface type here fixes every
  // downstream consumer at the one place the mismatch actually originates.
  public readonly vpc: ec2.IVpc;
  public readonly flowLogGroup: logs.LogGroup;
  public readonly vpcId: string;
  public readonly publicSubnets: ec2.ISubnet[];
  public readonly privateSubnets: ec2.ISubnet[];
  // No shared security group is provisioned here: the EKS cluster manages its
  // own, and downstream constructs attach theirs. Exposed (empty) to satisfy
  // the INetwork contract without adding an unused SecurityGroup resource.
  public readonly securityGroups: ec2.ISecurityGroup[] = [];

  constructor(scope: Construct, id: string, props: NetworkConstructProps = {}) {
    super(scope, id);

    const maxAzs = props.maxAzs ?? 3;
    const natGateways = props.natGateways ?? 3;
    const cidr = props.cidr ?? "10.20.0.0/16";

    this.vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr(cidr),
      maxAzs,
      natGateways,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          // Worker nodes and pods live here; outbound-only via NAT.
          name: "private-eks",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 20,
        },
        {
          // Reserved for data stores (databases, caches) with no internet route.
          name: "isolated-data",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      // `as ec2.IVpc`: aws-cdk-lib's `Vpc.vpnGatewayId` is typed wider than
      // `IVpc.vpnGatewayId`, which only matters under `exactOptionalPropertyTypes`.
    }) as ec2.IVpc;

    this.vpcId = this.vpc.vpcId;
    this.publicSubnets = this.vpc.publicSubnets;
    this.privateSubnets = this.vpc.privateSubnets;

    // VPC flow logs give an auditable network trail, important for a
    // regulated trading firm's security/compliance posture.
    this.flowLogGroup = new logs.LogGroup(this, "FlowLogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const flowLogRole = new iam.Role(this, "FlowLogRole", {
      assumedBy: new iam.ServicePrincipal("vpc-flow-logs.amazonaws.com"),
    });

    new ec2.FlowLog(this, "FlowLog", {
      resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
      destination: ec2.FlowLogDestination.toCloudWatchLogs(this.flowLogGroup, flowLogRole),
      trafficType: ec2.FlowLogTrafficType.ALL,
      maxAggregationInterval: ec2.FlowLogMaxAggregationInterval.ONE_MINUTE,
    });

    // Gateway endpoint avoids routing S3 traffic (ECR layers, logs, etc.) through NAT.
    this.vpc.addGatewayEndpoint("S3Endpoint", {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // Interface endpoints keep control-plane/API traffic off the public internet
    // even when nodes/pods call these services from private subnets.
    const interfaceServices: Array<[string, ec2.InterfaceVpcEndpointAwsService]> = [
      ["EcrApiEndpoint", ec2.InterfaceVpcEndpointAwsService.ECR],
      ["EcrDkrEndpoint", ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER],
      ["StsEndpoint", ec2.InterfaceVpcEndpointAwsService.STS],
      ["CloudWatchLogsEndpoint", ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS],
      ["EksEndpoint", ec2.InterfaceVpcEndpointAwsService.EKS],
    ];
    for (const [id2, service] of interfaceServices) {
      this.vpc.addInterfaceEndpoint(id2, {
        service,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        privateDnsEnabled: true,
      });
    }
  }
}
