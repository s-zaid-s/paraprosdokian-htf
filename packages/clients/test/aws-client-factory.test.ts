import { DescribeAvailabilityZonesCommand, EC2Client } from '@aws-sdk/client-ec2';
import { BatchGetImageCommand, ECRClient } from '@aws-sdk/client-ecr';
import { DescribeClusterCommand, EKSClient } from '@aws-sdk/client-eks';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { mockClient } from 'aws-sdk-client-mock';
import { AwsClientFactory, Ec2Client, EcrClient, EksClient, StsClient } from '../src';

const sts = mockClient(STSClient);
const ecr = mockClient(ECRClient);
const eks = mockClient(EKSClient);
const ec2 = mockClient(EC2Client);

beforeEach(() => {
  for (const m of [sts, ecr, eks, ec2]) m.reset();
  sts.on(GetCallerIdentityCommand).resolves({ Account: '1', Arn: 'a', UserId: 'u' });
  ecr.on(BatchGetImageCommand).resolves({});
  eks.on(DescribeClusterCommand).resolves({ cluster: { name: 'c' } });
  ec2.on(DescribeAvailabilityZonesCommand).resolves({});
});

/** Calls one method on each client and returns the SDK clients that served the calls. */
async function sdkClientsFrom(factory: AwsClientFactory) {
  await factory.createStsClient().getCallerIdentity();
  await factory.createEcrClient().batchGetImage('repo', [{ imageTag: 't' }]);
  await factory.createEksClient().describeCluster('c');
  await factory.createEc2Client().describeAvailabilityZones();
  return [sts, ecr, eks, ec2].map((m) => m.call(0).thisValue as STSClient | ECRClient | EKSClient | EC2Client);
}

const staticCredentials = { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' };

describe('AwsClientFactory', () => {
  test('creates the SDK-backed implementation of each interface', () => {
    const factory = new AwsClientFactory({ region: 'eu-west-1' });

    expect(factory.createStsClient()).toBeInstanceOf(StsClient);
    expect(factory.createEcrClient()).toBeInstanceOf(EcrClient);
    expect(factory.createEksClient()).toBeInstanceOf(EksClient);
    expect(factory.createEc2Client()).toBeInstanceOf(Ec2Client);
  });

  test('applies the shared region and credentials to all four clients', async () => {
    const clients = await sdkClientsFrom(new AwsClientFactory({ region: 'eu-west-1', credentials: staticCredentials }));

    for (const client of clients) {
      await expect(client.config.region()).resolves.toBe('eu-west-1');
      await expect(client.config.credentials()).resolves.toMatchObject(staticCredentials);
    }
  });

  test('passes the same credentials provider instance to every client', async () => {
    const provider = jest.fn(async () => staticCredentials);

    const clients = await sdkClientsFrom(new AwsClientFactory({ region: 'eu-west-1', credentials: provider }));

    for (const client of clients) {
      await expect(client.config.credentials()).resolves.toMatchObject(staticCredentials);
    }
    // All four SDK clients resolved credentials through the one shared
    // provider (each client caches its result, so once per client).
    expect(provider).toHaveBeenCalledTimes(4);
  });

  test('leaves unset options to the SDK defaults', async () => {
    const previous = process.env.AWS_REGION;
    process.env.AWS_REGION = 'ap-southeast-2';
    try {
      const clients = await sdkClientsFrom(new AwsClientFactory({ credentials: staticCredentials }));

      for (const client of clients) {
        await expect(client.config.region()).resolves.toBe('ap-southeast-2');
      }
    } finally {
      if (previous === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = previous;
    }
  });

  test('returns a new client on every call', () => {
    const factory = new AwsClientFactory({ region: 'eu-west-1' });

    expect(factory.createEksClient()).not.toBe(factory.createEksClient());
  });
});
