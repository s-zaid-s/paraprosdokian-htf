import { Cluster, DescribeClusterCommand, EKSClient, EKSClientConfig } from "@aws-sdk/client-eks";

/** The EKS operations this repo uses. Depend on this rather than `EksClient`. */
export interface IEksClient {
  /**
   * Describes a cluster (status, endpoint, certificate authority, version, ...).
   * Throws if the cluster does not exist (EKS's `ResourceNotFoundException`).
   */
  describeCluster(name: string): Promise<Cluster>;
}

/** `IEksClient` backed by the AWS SDK v3 `EKSClient`. */
export class EksClient implements IEksClient {
  private readonly client: EKSClient;

  /** @param configOrClient SDK client config (region, credentials, ...) or an existing `EKSClient` to reuse. */
  constructor(configOrClient: EKSClientConfig | EKSClient = {}) {
    this.client =
      configOrClient instanceof EKSClient ? configOrClient : new EKSClient(configOrClient);
  }

  public async describeCluster(name: string): Promise<Cluster> {
    const { cluster } = await this.client.send(new DescribeClusterCommand({ name }));
    if (!cluster) {
      throw new Error(`EKS DescribeCluster returned no cluster for '${name}'`);
    }
    return cluster;
  }
}
