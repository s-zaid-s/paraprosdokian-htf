import * as eks from "aws-cdk-lib/aws-eks";
import { Construct } from "constructs";

export interface BackendWorkloadConstructProps {
  /**
   * Cluster to deploy onto. Only `addManifest` is used, so any `ICluster`
   * works: the cluster created by `@paraprosdokian-htf/eks-cluster`, or an
   * existing one imported with `eks.Cluster.fromClusterAttributes` (e.g. from
   * a separate workloads stack).
   */
  readonly cluster: eks.ICluster;
  readonly namespace?: string;
  /** Image to run until the firm pushes its own build to the ECR repo. */
  readonly placeholderImage?: string;
}

/**
 * A minimal but production-patterned workload: namespace with resource
 * quotas, a Deployment with health probes, a ClusterIP Service, an
 * internet-facing ALB Ingress, and a HorizontalPodAutoscaler. This is the
 * "basic backend" the HFT firm's clients/services talk to; swap the
 * placeholder image for a real one pushed to the ECR repository.
 */
export class BackendWorkloadConstruct extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: BackendWorkloadConstructProps,
  ) {
    super(scope, id);

    const namespace = props.namespace ?? "backend";
    const appLabel = { app: "backend-api" };
    const image = props.placeholderImage ?? "public.ecr.aws/nginx/nginx:stable";

    const namespaceManifest = props.cluster.addManifest("BackendNamespace", {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: namespace },
    });

    const resourceQuota = props.cluster.addManifest("BackendResourceQuota", {
      apiVersion: "v1",
      kind: "ResourceQuota",
      metadata: { name: "backend-quota", namespace },
      spec: {
        hard: {
          "requests.cpu": "8",
          "requests.memory": "16Gi",
          "limits.cpu": "16",
          "limits.memory": "32Gi",
          pods: "50",
        },
      },
    });
    resourceQuota.node.addDependency(namespaceManifest);

    const deployment = props.cluster.addManifest("BackendDeployment", {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "backend-api", namespace, labels: appLabel },
      spec: {
        replicas: 2,
        selector: { matchLabels: appLabel },
        template: {
          metadata: { labels: appLabel },
          spec: {
            containers: [
              {
                name: "backend-api",
                image,
                ports: [{ containerPort: 80 }],
                resources: {
                  requests: { cpu: "250m", memory: "256Mi" },
                  limits: { cpu: "1", memory: "512Mi" },
                },
                readinessProbe: {
                  httpGet: { path: "/", port: 80 },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                },
                livenessProbe: {
                  httpGet: { path: "/", port: 80 },
                  initialDelaySeconds: 15,
                  periodSeconds: 20,
                },
              },
            ],
          },
        },
      },
    });
    deployment.node.addDependency(namespaceManifest);

    const podDisruptionBudget = props.cluster.addManifest("BackendPdb", {
      apiVersion: "policy/v1",
      kind: "PodDisruptionBudget",
      metadata: { name: "backend-api-pdb", namespace },
      spec: {
        minAvailable: 1,
        selector: { matchLabels: appLabel },
      },
    });
    podDisruptionBudget.node.addDependency(deployment);

    const service = props.cluster.addManifest("BackendService", {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "backend-api", namespace },
      spec: {
        type: "ClusterIP",
        selector: appLabel,
        ports: [{ port: 80, targetPort: 80, protocol: "TCP" }],
      },
    });
    service.node.addDependency(deployment);

    const ingress = props.cluster.addManifest("BackendIngress", {
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: {
        name: "backend-api",
        namespace,
        annotations: {
          "kubernetes.io/ingress.class": "alb",
          "alb.ingress.kubernetes.io/scheme": "internet-facing",
          "alb.ingress.kubernetes.io/target-type": "ip",
          "alb.ingress.kubernetes.io/healthcheck-path": "/",
        },
      },
      spec: {
        rules: [
          {
            http: {
              paths: [
                {
                  path: "/",
                  pathType: "Prefix",
                  backend: {
                    service: { name: "backend-api", port: { number: 80 } },
                  },
                },
              ],
            },
          },
        ],
      },
    });
    ingress.node.addDependency(service);

    const hpa = props.cluster.addManifest("BackendHpa", {
      apiVersion: "autoscaling/v2",
      kind: "HorizontalPodAutoscaler",
      metadata: { name: "backend-api", namespace },
      spec: {
        scaleTargetRef: {
          apiVersion: "apps/v1",
          kind: "Deployment",
          name: "backend-api",
        },
        minReplicas: 2,
        maxReplicas: 10,
        metrics: [
          {
            type: "Resource",
            resource: {
              name: "cpu",
              target: { type: "Utilization", averageUtilization: 70 },
            },
          },
        ],
      },
    });
    hpa.node.addDependency(deployment);
  }
}
