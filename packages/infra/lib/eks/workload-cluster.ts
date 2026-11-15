import * as eks from 'aws-cdk-lib/aws-eks-v2';

/**
 * The subset of an EKS cluster that workload constructs need in order to
 * deploy onto it.
 *
 * Workload constructs should accept an `IWorkloadCluster` rather than a
 * concrete cluster. This stops them from reaching into cluster-level concerns
 * (capacity, access entries, add-ons, ...) and lets them run against any
 * cluster that can apply manifests and Helm charts.
 *
 * The signatures mirror `eks.ICluster`, so any `eks.ICluster` (including one
 * imported with `eks.Cluster.fromClusterAttributes`) also satisfies this
 * interface.
 */
export interface IWorkloadCluster {
  /** Name of the EKS cluster. */
  readonly clusterName: string;

  /**
   * Applies Kubernetes resources to the cluster.
   *
   * @param id logical ID of the construct that manages the resources
   * @param manifest Kubernetes resource specifications
   */
  addManifest(id: string, ...manifest: Record<string, any>[]): eks.KubernetesManifest;

  /**
   * Installs a Helm chart into the cluster.
   *
   * @param id logical ID of the construct that manages the release
   * @param options chart, repository, values, namespace, ...
   */
  addHelmChart(id: string, options: eks.HelmChartOptions): eks.HelmChart;
}
