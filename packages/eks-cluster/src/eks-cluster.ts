import { Stack, Tags } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as eks from "aws-cdk-lib/aws-eks";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import { KubectlV32Layer } from "@aws-cdk/lambda-layer-kubectl-v32";
import { Construct } from "constructs";

export interface NodeGroupScaling {
  readonly min: number;
  readonly max: number;
  readonly desired: number;
}

export interface EksClusterConstructProps {
  readonly vpc: ec2.IVpc;
  /** Short, DNS-friendly name used as a prefix for cluster resources. */
  readonly clusterName: string;
  /**
   * Public CIDR blocks allowed to reach the Kubernetes API endpoint.
   * Leave empty to allow the endpoint to be reached from anywhere on the
   * internet (still protected by IAM/RBAC) - restrict this in production.
   * @default - unrestricted
   */
  readonly allowedPublicEndpointCidrs?: string[];
  /**
   * IAM principal (user or role ARN) to grant `system:masters`-equivalent
   * cluster admin access via an EKS access entry, so an operator can run
   * kubectl/helm against the cluster. If omitted, no extra principal is
   * granted and only the CDK deploy role can manage the cluster.
   * @default - none
   */
  // Not `?:` - the caller always passes this key (possibly `undefined`),
  // so under `exactOptionalPropertyTypes` it must be a required field whose
  // value can be `undefined`, not an optional field that must be omitted.
  readonly clusterAdminPrincipalArn: string | undefined;
  readonly systemInstanceType?: ec2.InstanceType;
  readonly appInstanceType?: ec2.InstanceType;
  readonly systemNodeGroupScaling?: NodeGroupScaling;
  readonly appNodeGroupScaling?: NodeGroupScaling;
}

/**
 * A production-shaped (but intentionally minimal) EKS cluster:
 * - KMS-encrypted Kubernetes secrets + full control-plane audit logging
 * - Two managed node groups (system vs. application workloads)
 * - Core addons managed by EKS (vpc-cni, kube-proxy, coredns, ebs-csi-driver)
 * - AWS Load Balancer Controller for ingress
 * - Cluster Autoscaler + metrics-server for elasticity and HPA support
 */
export class EksClusterConstruct extends Construct {
  public readonly cluster: eks.Cluster;
  public readonly secretsKey: kms.Key;
  public readonly systemNodeGroup: eks.Nodegroup;
  public readonly appNodeGroup: eks.Nodegroup;
  // Literal (non-tokenized) cluster name, safe to use as a map key (e.g. resource tags).
  private readonly clusterNamePhysical: string;

  constructor(scope: Construct, id: string, props: EksClusterConstructProps) {
    super(scope, id);

    this.clusterNamePhysical = props.clusterName;
    const region = Stack.of(this).region;

    this.secretsKey = new kms.Key(this, "SecretsKey", {
      description: `Envelope encryption key for ${props.clusterName} Kubernetes secrets`,
      enableKeyRotation: true,
      alias: `eks/${props.clusterName}/secrets`,
    });

    const publicCidrs = props.allowedPublicEndpointCidrs ?? [];
    const endpointAccess =
      publicCidrs.length > 0
        ? eks.EndpointAccess.PUBLIC_AND_PRIVATE.onlyFrom(...publicCidrs)
        : eks.EndpointAccess.PUBLIC_AND_PRIVATE;

    this.cluster = new eks.Cluster(this, "Cluster", {
      clusterName: props.clusterName,
      vpc: props.vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      version: eks.KubernetesVersion.V1_32,
      kubectlLayer: new KubectlV32Layer(this, "KubectlLayer"),
      // Node groups are added explicitly below instead of using default capacity.
      defaultCapacity: 0,
      secretsEncryptionKey: this.secretsKey,
      endpointAccess,
      clusterLogging: [
        eks.ClusterLoggingTypes.API,
        eks.ClusterLoggingTypes.AUDIT,
        eks.ClusterLoggingTypes.AUTHENTICATOR,
        eks.ClusterLoggingTypes.CONTROLLER_MANAGER,
        eks.ClusterLoggingTypes.SCHEDULER,
      ],
      authenticationMode: eks.AuthenticationMode.API_AND_CONFIG_MAP,
      albController: {
        version: eks.AlbControllerVersion.V2_8_2,
      },
      outputClusterName: true,
      outputConfigCommand: true,
    });

    if (props.clusterAdminPrincipalArn) {
      this.cluster.grantAccess("ClusterAdminAccess", props.clusterAdminPrincipalArn, [
        eks.AccessPolicy.fromAccessPolicyName("AmazonEKSClusterAdminPolicy", {
          accessScopeType: eks.AccessScopeType.CLUSTER,
        }),
      ]);
    }

    this.systemNodeGroup = this.addManagedNodeGroup("SystemNodeGroup", {
      nodegroupName: `${props.clusterName}-system`,
      instanceTypes: [
        props.systemInstanceType ??
          ec2.InstanceType.of(ec2.InstanceClass.M6I, ec2.InstanceSize.LARGE),
      ],
      scaling: props.systemNodeGroupScaling ?? { min: 2, max: 4, desired: 2 },
      labels: { role: "system" },
    });

    this.appNodeGroup = this.addManagedNodeGroup("AppNodeGroup", {
      nodegroupName: `${props.clusterName}-app`,
      instanceTypes: [
        props.appInstanceType ??
          ec2.InstanceType.of(ec2.InstanceClass.C6I, ec2.InstanceSize.XLARGE2),
      ],
      scaling: props.appNodeGroupScaling ?? { min: 2, max: 10, desired: 2 },
      labels: { workload: "backend" },
    });

    this.installCoreAddons();
    this.installClusterAutoscaler(region);
    this.installMetricsServer();
  }

  private addManagedNodeGroup(
    id: string,
    opts: {
      nodegroupName: string;
      instanceTypes: ec2.InstanceType[];
      scaling: NodeGroupScaling;
      labels: Record<string, string>;
    },
  ): eks.Nodegroup {
    // Dedicated role (instead of letting CDK auto-create one) so we can add
    // SSM Session Manager access without opening SSH on the nodes.
    const nodeRole = new iam.Role(this, `${id}Role`, {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSWorkerNodePolicy"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKS_CNI_Policy"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
      ],
    });

    const nodegroup = this.cluster.addNodegroupCapacity(id, {
      nodegroupName: opts.nodegroupName,
      nodeRole,
      instanceTypes: opts.instanceTypes,
      amiType: eks.NodegroupAmiType.AL2023_X86_64_STANDARD,
      capacityType: eks.CapacityType.ON_DEMAND,
      diskSize: 50,
      minSize: opts.scaling.min,
      maxSize: opts.scaling.max,
      desiredSize: opts.scaling.desired,
      labels: opts.labels,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      enableNodeAutoRepair: true,
      tags: {
        "k8s.io/cluster-autoscaler/enabled": "true",
        [`k8s.io/cluster-autoscaler/${this.clusterNamePhysical}`]: "owned",
      },
    });

    return nodegroup;
  }

  /** Converts the cluster's bootstrap components into EKS-managed addons. */
  private installCoreAddons(): void {
    const vpcCni = new eks.CfnAddon(this, "VpcCniAddon", {
      addonName: "vpc-cni",
      clusterName: this.cluster.clusterName,
      resolveConflicts: "OVERWRITE",
    });

    const kubeProxy = new eks.CfnAddon(this, "KubeProxyAddon", {
      addonName: "kube-proxy",
      clusterName: this.cluster.clusterName,
      resolveConflicts: "OVERWRITE",
    });

    const coreDns = new eks.CfnAddon(this, "CoreDnsAddon", {
      addonName: "coredns",
      clusterName: this.cluster.clusterName,
      resolveConflicts: "OVERWRITE",
    });
    // CoreDNS pods need somewhere to schedule.
    coreDns.node.addDependency(this.systemNodeGroup);

    const ebsCsiServiceAccount = this.cluster.addServiceAccount("EbsCsiServiceAccount", {
      name: "ebs-csi-controller-sa",
      namespace: "kube-system",
    });
    ebsCsiServiceAccount.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEBSCSIDriverPolicy"),
    );
    const ebsCsi = new eks.CfnAddon(this, "EbsCsiAddon", {
      addonName: "aws-ebs-csi-driver",
      clusterName: this.cluster.clusterName,
      resolveConflicts: "OVERWRITE",
      serviceAccountRoleArn: ebsCsiServiceAccount.role.roleArn,
    });
    ebsCsi.node.addDependency(this.systemNodeGroup, ebsCsiServiceAccount);

    Tags.of(vpcCni).add("component", "networking");
    Tags.of(kubeProxy).add("component", "networking");
  }

  /** Cluster Autoscaler lets the managed node groups react to pending pods. */
  private installClusterAutoscaler(region: string): void {
    const serviceAccount = this.cluster.addServiceAccount("ClusterAutoscalerServiceAccount", {
      name: "cluster-autoscaler",
      namespace: "kube-system",
    });

    serviceAccount.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "autoscaling:DescribeAutoScalingGroups",
          "autoscaling:DescribeAutoScalingInstances",
          "autoscaling:DescribeLaunchConfigurations",
          "autoscaling:DescribeScalingActivities",
          "autoscaling:DescribeTags",
          "ec2:DescribeInstanceTypes",
          "ec2:DescribeLaunchTemplateVersions",
          "eks:DescribeNodegroup",
        ],
        resources: ["*"],
      }),
    );
    serviceAccount.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "autoscaling:SetDesiredCapacity",
          "autoscaling:TerminateInstanceInAutoScalingGroup",
          "autoscaling:UpdateAutoScalingGroup",
        ],
        resources: ["*"],
        conditions: {
          StringEquals: {
            [`autoscaling:ResourceTag/k8s.io/cluster-autoscaler/${this.clusterNamePhysical}`]:
              "owned",
          },
        },
      }),
    );

    const chart = this.cluster.addHelmChart("ClusterAutoscaler", {
      chart: "cluster-autoscaler",
      repository: "https://kubernetes.github.io/autoscaler",
      namespace: "kube-system",
      release: "cluster-autoscaler",
      version: "9.46.6",
      values: {
        autoDiscovery: { clusterName: this.cluster.clusterName },
        awsRegion: region,
        rbac: {
          serviceAccount: {
            create: false,
            name: serviceAccount.serviceAccountName,
          },
        },
        extraArgs: {
          "balance-similar-node-groups": true,
          "skip-nodes-with-system-pods": false,
        },
      },
    });
    chart.node.addDependency(serviceAccount, this.systemNodeGroup);
  }

  /** metrics-server is required for HorizontalPodAutoscaler to function. */
  private installMetricsServer(): void {
    const chart = this.cluster.addHelmChart("MetricsServer", {
      chart: "metrics-server",
      repository: "https://kubernetes-sigs.github.io/metrics-server/",
      namespace: "kube-system",
      release: "metrics-server",
      version: "3.12.2",
    });
    chart.node.addDependency(this.systemNodeGroup);
  }
}
