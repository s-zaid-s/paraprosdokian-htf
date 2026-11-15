import { Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { INetwork, NetworkConstruct } from '../../lib';

// A downstream construct that depends only on the INetwork contract.
class DownstreamConsumer extends Construct {
  constructor(scope: Construct, id: string, network: INetwork) {
    super(scope, id);
    new ec2.CfnSecurityGroupIngress(this, 'Ingress', {
      groupId: network.securityGroups[0].securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 443,
      toPort: 443,
      cidrIp: '0.0.0.0/0',
    });
    new ec2.Instance(this, 'Instance', {
      vpc: network.vpc,
      vpcSubnets: { subnets: network.privateSubnets },
      securityGroup: network.securityGroups[0],
      instanceType: new ec2.InstanceType('t3.micro'),
      machineImage: new ec2.AmazonLinuxImage(),
    });
  }
}

describe('NetworkConstruct', () => {
  test('satisfies INetwork and exposes consistent values', () => {
    const stack = new Stack();
    const network: INetwork = new NetworkConstruct(stack, 'Network');

    expect(network.vpcId).toBe(network.vpc.vpcId);
    expect(network.publicSubnets).toHaveLength(2);
    expect(network.privateSubnets).toHaveLength(2);
    expect(network.securityGroups).toHaveLength(1);
  });

  test('synthesizes the VPC, subnets and security group', () => {
    // Environment-agnostic stacks are limited to 2 AZs, so pin an env to get 3.
    const stack = new Stack(undefined, 'Stack', { env: { account: '123456789012', region: 'us-east-1' } });
    new NetworkConstruct(stack, 'Network', { cidr: '10.1.0.0/16', maxAzs: 3 });
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.hasResourceProperties('AWS::EC2::VPC', { CidrBlock: '10.1.0.0/16' });
    template.resourceCountIs('AWS::EC2::Subnet', 6);
    template.resourceCountIs('AWS::EC2::SecurityGroup', 1);
  });

  test('downstream constructs can consume it via INetwork', () => {
    const stack = new Stack();
    const network = new NetworkConstruct(stack, 'Network');
    new DownstreamConsumer(stack, 'Consumer', network);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::EC2::Instance', 1);
    template.resourceCountIs('AWS::EC2::SecurityGroupIngress', 1);
  });

  test('INetwork can be satisfied by an imported VPC (no NetworkConstruct)', () => {
    const stack = new Stack();
    // Use well-formed IDs and the stack's AZs so CloudFormation template
    // validation doesn't flag the fixtures.
    const vpc = ec2.Vpc.fromVpcAttributes(stack, 'Imported', {
      vpcId: 'vpc-0123456789abcdef0',
      availabilityZones: stack.availabilityZones.slice(0, 1),
      publicSubnetIds: ['subnet-0123456789abcdef0'],
      privateSubnetIds: ['subnet-0123456789abcdef1'],
    });
    const imported: INetwork = {
      vpc,
      vpcId: vpc.vpcId,
      publicSubnets: vpc.publicSubnets,
      privateSubnets: vpc.privateSubnets,
      securityGroups: [ec2.SecurityGroup.fromSecurityGroupId(stack, 'Sg', 'sg-0123456789abcdef0')],
    };
    new DownstreamConsumer(stack, 'Consumer', imported);

    Template.fromStack(stack).resourceCountIs('AWS::EC2::Instance', 1);
  });
});
