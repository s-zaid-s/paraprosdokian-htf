import { App, Stack } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as eks from "aws-cdk-lib/aws-eks";
import { Template } from "aws-cdk-lib/assertions";
import { KubectlV32Layer } from "@aws-cdk/lambda-layer-kubectl-v32";
import {
  BackendWorkloadConstruct,
  BackendWorkloadConstructProps,
} from "../src";

type Manifest = {
  kind: string;
  metadata: { name: string; namespace?: string };
  spec?: any;
};

/** Synthesizes the workload onto a bare cluster and returns its manifests. */
function synthManifests(
  props: Partial<BackendWorkloadConstructProps> = {},
): Manifest[] {
  const stack = new Stack(new App(), "TestStack");
  const cluster = new eks.Cluster(stack, "Cluster", {
    vpc: new ec2.Vpc(stack, "Vpc"),
    version: eks.KubernetesVersion.V1_32,
    kubectlLayer: new KubectlV32Layer(stack, "KubectlLayer"),
    defaultCapacity: 0,
  });
  new BackendWorkloadConstruct(stack, "BackendWorkload", {
    cluster,
    ...props,
  });

  const resources = Template.fromStack(stack).findResources(
    "Custom::AWSCDK-EKS-KubernetesResource",
  );
  return Object.values(resources)
    .map((r) => r.Properties.Manifest)
    // Manifests containing tokens (e.g. CDK-managed aws-auth) are Fn::Join
    // objects; the workload's own manifests are plain JSON strings.
    .filter((m): m is string => typeof m === "string")
    .flatMap((m) => JSON.parse(m) as Manifest[]);
}

function byKind(manifests: Manifest[], kind: string): Manifest {
  const found = manifests.find((m) => m.kind === kind);
  if (!found) throw new Error(`no ${kind} manifest synthesized`);
  return found;
}

test("deploys the full backend resource set", () => {
  const kinds = synthManifests().map((m) => m.kind).sort();
  expect(kinds).toEqual(
    [
      "Deployment",
      "HorizontalPodAutoscaler",
      "Ingress",
      "Namespace",
      "PodDisruptionBudget",
      "ResourceQuota",
      "Service",
    ].sort(),
  );
});

test("places everything in the 'backend' namespace by default", () => {
  const manifests = synthManifests();
  expect(byKind(manifests, "Namespace").metadata.name).toBe("backend");
  for (const m of manifests.filter((m) => m.kind !== "Namespace")) {
    expect(m.metadata.namespace).toBe("backend");
  }
});

test("honours a custom namespace", () => {
  const manifests = synthManifests({ namespace: "pricing" });
  expect(byKind(manifests, "Namespace").metadata.name).toBe("pricing");
  expect(byKind(manifests, "Deployment").metadata.namespace).toBe("pricing");
});

test("runs the placeholder image unless one is provided", () => {
  const imageOf = (manifests: Manifest[]) =>
    byKind(manifests, "Deployment").spec.template.spec.containers[0].image;

  expect(imageOf(synthManifests())).toBe("public.ecr.aws/nginx/nginx:stable");
  expect(
    imageOf(synthManifests({ placeholderImage: "example.com/backend:v1" })),
  ).toBe("example.com/backend:v1");
});

test("sets resource requests/limits and health probes on the container", () => {
  const container = byKind(synthManifests(), "Deployment").spec.template.spec
    .containers[0];
  expect(container.resources.requests).toBeDefined();
  expect(container.resources.limits).toBeDefined();
  expect(container.readinessProbe).toBeDefined();
  expect(container.livenessProbe).toBeDefined();
});

test("exposes the service through an internet-facing ALB", () => {
  const ingress = byKind(synthManifests(), "Ingress") as Manifest & {
    metadata: { annotations: Record<string, string> };
  };
  expect(ingress.metadata.annotations).toMatchObject({
    "kubernetes.io/ingress.class": "alb",
    "alb.ingress.kubernetes.io/scheme": "internet-facing",
  });
});

test("can deploy onto an imported (existing) cluster", () => {
  const stack = new Stack(new App(), "WorkloadsOnlyStack");
  const cluster = eks.Cluster.fromClusterAttributes(stack, "Imported", {
    clusterName: "existing-cluster",
    kubectlRoleArn: "arn:aws:iam::111111111111:role/kubectl",
    kubectlLayer: new KubectlV32Layer(stack, "KubectlLayer"),
  });
  new BackendWorkloadConstruct(stack, "BackendWorkload", { cluster });

  const manifests = Template.fromStack(stack).findResources(
    "Custom::AWSCDK-EKS-KubernetesResource",
  );
  const kinds = Object.values(manifests).flatMap(
    (r) => (JSON.parse(r.Properties.Manifest) as Manifest[]).map((m) => m.kind),
  );
  expect(kinds.sort()).toEqual(
    [
      "Deployment",
      "HorizontalPodAutoscaler",
      "Ingress",
      "Namespace",
      "PodDisruptionBudget",
      "ResourceQuota",
      "Service",
    ].sort(),
  );
});
