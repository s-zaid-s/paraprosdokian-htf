import { DescribeAvailabilityZonesCommand, DescribeSubnetsCommand, DescribeVpcsCommand, EC2Client } from '@aws-sdk/client-ec2';
import { mockClient } from 'aws-sdk-client-mock';
import { Ec2Client } from '../src';

const ec2 = mockClient(EC2Client);
beforeEach(() => ec2.reset());

describe('Ec2Client', () => {
  test('describeVpcs follows all pages and passes options', async () => {
    ec2.on(DescribeVpcsCommand)
      .resolvesOnce({ Vpcs: [{ VpcId: 'vpc-1' }], NextToken: 't1' })
      .resolvesOnce({ Vpcs: [{ VpcId: 'vpc-2' }] });
    const filters = [{ Name: 'tag:Name', Values: ['main'] }];

    const vpcs = await new Ec2Client().describeVpcs({ filters });

    expect(vpcs.map((v) => v.VpcId)).toEqual(['vpc-1', 'vpc-2']);
    expect(ec2.commandCalls(DescribeVpcsCommand)[0].args[0].input).toMatchObject({ Filters: filters });
    expect(ec2.commandCalls(DescribeVpcsCommand)[1].args[0].input).toMatchObject({ NextToken: 't1' });
  });

  test('describeSubnets follows all pages and passes options', async () => {
    ec2.on(DescribeSubnetsCommand)
      .resolvesOnce({ Subnets: [{ SubnetId: 'subnet-1' }], NextToken: 't1' })
      .resolvesOnce({ Subnets: [{ SubnetId: 'subnet-2' }] });

    const subnets = await new Ec2Client().describeSubnets({ subnetIds: ['subnet-1', 'subnet-2'] });

    expect(subnets.map((s) => s.SubnetId)).toEqual(['subnet-1', 'subnet-2']);
    expect(ec2.commandCalls(DescribeSubnetsCommand)[0].args[0].input).toMatchObject({ SubnetIds: ['subnet-1', 'subnet-2'] });
  });

  test('describeAvailabilityZones passes options and returns zones', async () => {
    ec2.on(DescribeAvailabilityZonesCommand).resolves({ AvailabilityZones: [{ ZoneName: 'us-east-1a' }] });
    const filters = [{ Name: 'state', Values: ['available'] }];

    const zones = await new Ec2Client().describeAvailabilityZones({ filters, allAvailabilityZones: true });

    expect(zones.map((z) => z.ZoneName)).toEqual(['us-east-1a']);
    expect(ec2.commandCalls(DescribeAvailabilityZonesCommand)[0].args[0].input).toEqual({
      ZoneNames: undefined,
      Filters: filters,
      AllAvailabilityZones: true,
    });
  });

  test('describe calls return empty arrays when the API returns nothing', async () => {
    ec2.on(DescribeVpcsCommand).resolves({});
    ec2.on(DescribeSubnetsCommand).resolves({});
    ec2.on(DescribeAvailabilityZonesCommand).resolves({});
    const client = new Ec2Client();

    await expect(client.describeVpcs()).resolves.toEqual([]);
    await expect(client.describeSubnets()).resolves.toEqual([]);
    await expect(client.describeAvailabilityZones()).resolves.toEqual([]);
  });
});
