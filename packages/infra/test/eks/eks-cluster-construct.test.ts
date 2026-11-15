import { Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as eks from 'aws-cdk-lib/aws-eks-v2';
import { Construct } from 'constructs';
import { EksClusterConstruct, IWorkloadCluster, NetworkConstruct } from '../../lib';

// A workload construct that depends only on the IWorkloadCluster contract.
class Workload extends Construct {
  constructor(scope: Construct, id: string, cluster: IWorkloadCluster) {
    super(scope, id);
    cluster.addManifest('Namespace', {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: 'workload', labels: { cluster: cluster.clusterName } },
    });
    cluster.addHelmChart('Nginx', {
      chart: 'nginx',
      repository: 'https://helm.nginx.com/stable',
      namespace: 'workload',
    });
  }
}

function createCluster() {
  const stack = new Stack();
  const network = new NetworkConstruct(stack, 'Network');
  const cluster = new EksClusterConstruct(stack, 'Eks', { network, clusterName: 'test-cluster' });
  return { stack, network, cluster };
}

describe('EksClusterConstruct', () => {
  test('creates the cluster in the network private subnets with the expected version', () => {
    const { stack, network } = createCluster();
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::EKS::Cluster', {
      Name: 'test-cluster',
      Version: '1.35',
      ResourcesVpcConfig: Match.objectLike({
        SubnetIds: network.privateSubnets.map((s) => stack.resolve(s.subnetId)),
      }),
    });
  });

  test('exposes the cluster name through IWorkloadCluster', () => {
    const { stack, cluster } = createCluster();
    const workloadCluster: IWorkloadCluster = cluster;

    expect(stack.resolve(workloadCluster.clusterName)).toEqual(stack.resolve(cluster.cluster.clusterName));
  });

  test('workload constructs can apply manifests and Helm charts via IWorkloadCluster', () => {
    const { stack, cluster } = createCluster();
    new Workload(stack, 'Workload', cluster);
    const template = Template.fromStack(stack);

    // The manifest references clusterName (a token), so it synthesizes as an
    // Fn::Join rather than a plain string; inspect its serialized form.
    const manifests = Object.values(template.findResources('Custom::AWSCDK-EKS-KubernetesResource'))
      .map((r) => JSON.stringify(r.Properties.Manifest));
    const namespace = manifests.find((m) => m.includes('Namespace'));
    expect(namespace).toBeDefined();
    expect(namespace).toContain(stack.resolve(cluster.cluster.clusterName).Ref);
    template.hasResourceProperties('Custom::AWSCDK-EKS-HelmChart', {
      Chart: 'nginx',
      Namespace: 'workload',
    });
  });

  test('an imported eks.ICluster also satisfies IWorkloadCluster', () => {
    const stack = new Stack();
    const imported: eks.ICluster = eks.Cluster.fromClusterAttributes(stack, 'Imported', {
      clusterName: 'existing-cluster',
      kubectlProvider: eks.KubectlProvider.fromKubectlProviderAttributes(stack, 'Kubectl', {
        serviceToken: 'arn:aws:lambda:us-east-1:123456789012:function:kubectl',
      }),
    });
    const workloadCluster: IWorkloadCluster = imported;
    new Workload(stack, 'Workload', workloadCluster);

    expect(workloadCluster.clusterName).toBe('existing-cluster');
    Template.fromStack(stack).resourceCountIs('Custom::AWSCDK-EKS-HelmChart', 1);
  });
});
