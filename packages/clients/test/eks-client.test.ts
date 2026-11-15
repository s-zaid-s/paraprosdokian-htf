import { DescribeClusterCommand, EKSClient, ResourceNotFoundException } from '@aws-sdk/client-eks';
import { mockClient } from 'aws-sdk-client-mock';
import { EksClient } from '../src';

const eks = mockClient(EKSClient);
beforeEach(() => eks.reset());

describe('EksClient', () => {
  test('describeCluster returns the cluster', async () => {
    eks.on(DescribeClusterCommand, { name: 'prod' }).resolves({ cluster: { name: 'prod', status: 'ACTIVE' } });

    await expect(new EksClient().describeCluster('prod')).resolves.toMatchObject({ name: 'prod', status: 'ACTIVE' });
  });

  test('describeCluster throws when no cluster is returned', async () => {
    eks.on(DescribeClusterCommand).resolves({});

    await expect(new EksClient().describeCluster('prod')).rejects.toThrow("no cluster for 'prod'");
  });

  test('describeCluster propagates ResourceNotFoundException', async () => {
    eks.on(DescribeClusterCommand).rejects(new ResourceNotFoundException({ message: 'not found', $metadata: {} }));

    await expect(new EksClient().describeCluster('missing')).rejects.toBeInstanceOf(ResourceNotFoundException);
  });
});
