import { Cluster, DescribeClusterCommand, EKSClient, EKSClientConfig } from '@aws-sdk/client-eks';

/** Wrapper around the SDK `EKSClient`, exposing only the calls this repo uses. */
export class EksClient {
  private readonly client: EKSClient;

  /** @param configOrClient SDK client config (region, credentials, ...) or an existing `EKSClient` to reuse. */
  constructor(configOrClient: EKSClientConfig | EKSClient = {}) {
    this.client = configOrClient instanceof EKSClient ? configOrClient : new EKSClient(configOrClient);
  }

  /**
   * Describes a cluster (status, endpoint, certificate authority, version, ...).
   * Throws the SDK's `ResourceNotFoundException` if the cluster does not exist.
   */
  public async describeCluster(name: string): Promise<Cluster> {
    const { cluster } = await this.client.send(new DescribeClusterCommand({ name }));
    if (!cluster) {
      throw new Error(`EKS DescribeCluster returned no cluster for '${name}'`);
    }
    return cluster;
  }
}
