import {
  AvailabilityZone,
  DescribeAvailabilityZonesCommand,
  EC2Client,
  EC2ClientConfig,
  Filter,
  paginateDescribeSubnets,
  paginateDescribeVpcs,
  Subnet,
  Vpc,
} from '@aws-sdk/client-ec2';

export interface DescribeVpcsOptions {
  /** Specific VPC IDs to describe. @default - all VPCs */
  readonly vpcIds?: string[];
  /** EC2 filters, e.g. `{ Name: 'tag:Name', Values: ['my-vpc'] }`. */
  readonly filters?: Filter[];
}

export interface DescribeSubnetsOptions {
  /** Specific subnet IDs to describe. @default - all subnets */
  readonly subnetIds?: string[];
  /** EC2 filters, e.g. `{ Name: 'vpc-id', Values: ['vpc-123'] }`. */
  readonly filters?: Filter[];
}

export interface DescribeAvailabilityZonesOptions {
  /** Specific zone names to describe. @default - all zones */
  readonly zoneNames?: string[];
  /** EC2 filters, e.g. `{ Name: 'state', Values: ['available'] }`. */
  readonly filters?: Filter[];
  /** Include zones and Local/Wavelength Zones the account has not opted into. @default false */
  readonly allAvailabilityZones?: boolean;
}

/** The EC2 operations this repo uses. Depend on this rather than `Ec2Client`. */
export interface IEc2Client {
  /** Describes VPCs. Returns all results (not just the first page). */
  describeVpcs(options?: DescribeVpcsOptions): Promise<Vpc[]>;

  /** Describes subnets. Returns all results (not just the first page). */
  describeSubnets(options?: DescribeSubnetsOptions): Promise<Subnet[]>;

  /** Describes Availability Zones in the client's region. */
  describeAvailabilityZones(options?: DescribeAvailabilityZonesOptions): Promise<AvailabilityZone[]>;
}

/** `IEc2Client` backed by the AWS SDK v3 `EC2Client`. */
export class Ec2Client implements IEc2Client {
  private readonly client: EC2Client;

  /** @param configOrClient SDK client config (region, credentials, ...) or an existing `EC2Client` to reuse. */
  constructor(configOrClient: EC2ClientConfig | EC2Client = {}) {
    this.client = configOrClient instanceof EC2Client ? configOrClient : new EC2Client(configOrClient);
  }

  public async describeVpcs(options: DescribeVpcsOptions = {}): Promise<Vpc[]> {
    const vpcs: Vpc[] = [];
    const input = { VpcIds: options.vpcIds, Filters: options.filters };
    for await (const page of paginateDescribeVpcs({ client: this.client }, input)) {
      vpcs.push(...(page.Vpcs ?? []));
    }
    return vpcs;
  }

  public async describeSubnets(options: DescribeSubnetsOptions = {}): Promise<Subnet[]> {
    const subnets: Subnet[] = [];
    const input = { SubnetIds: options.subnetIds, Filters: options.filters };
    for await (const page of paginateDescribeSubnets({ client: this.client }, input)) {
      subnets.push(...(page.Subnets ?? []));
    }
    return subnets;
  }

  // Not paginated: the API returns all zones in a single response.
  public async describeAvailabilityZones(options: DescribeAvailabilityZonesOptions = {}): Promise<AvailabilityZone[]> {
    const { AvailabilityZones } = await this.client.send(new DescribeAvailabilityZonesCommand({
      ZoneNames: options.zoneNames,
      Filters: options.filters,
      AllAvailabilityZones: options.allAvailabilityZones,
    }));
    return AvailabilityZones ?? [];
  }
}
