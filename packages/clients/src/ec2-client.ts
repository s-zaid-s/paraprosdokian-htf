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

/** Wrapper around the SDK `EC2Client`, exposing only the calls this repo uses. */
export class Ec2Client {
  private readonly client: EC2Client;

  /** @param configOrClient SDK client config (region, credentials, ...) or an existing `EC2Client` to reuse. */
  constructor(configOrClient: EC2ClientConfig | EC2Client = {}) {
    this.client = configOrClient instanceof EC2Client ? configOrClient : new EC2Client(configOrClient);
  }

  /** Describes VPCs, following all pages. */
  public async describeVpcs(options: DescribeVpcsOptions = {}): Promise<Vpc[]> {
    const vpcs: Vpc[] = [];
    const input = { VpcIds: options.vpcIds, Filters: options.filters };
    for await (const page of paginateDescribeVpcs({ client: this.client }, input)) {
      vpcs.push(...(page.Vpcs ?? []));
    }
    return vpcs;
  }

  /** Describes subnets, following all pages. */
  public async describeSubnets(options: DescribeSubnetsOptions = {}): Promise<Subnet[]> {
    const subnets: Subnet[] = [];
    const input = { SubnetIds: options.subnetIds, Filters: options.filters };
    for await (const page of paginateDescribeSubnets({ client: this.client }, input)) {
      subnets.push(...(page.Subnets ?? []));
    }
    return subnets;
  }

  /** Describes Availability Zones in the client's region (this API is not paginated). */
  public async describeAvailabilityZones(options: DescribeAvailabilityZonesOptions = {}): Promise<AvailabilityZone[]> {
    const { AvailabilityZones } = await this.client.send(new DescribeAvailabilityZonesCommand({
      ZoneNames: options.zoneNames,
      Filters: options.filters,
      AllAvailabilityZones: options.allAvailabilityZones,
    }));
    return AvailabilityZones ?? [];
  }
}
