# paraprosdokian-htf

An AWS CDK (TypeScript) app that provisions a production-shaped, but
intentionally minimal, Amazon EKS cluster to serve as the backend platform
for an HFT (high-frequency trading) firm.

## Architecture

```
NetworkConstruct     3-AZ VPC: public / private-with-egress / isolated subnets,
                     VPC flow logs, S3 gateway endpoint, ECR/STS/logs/EKS
                     interface endpoints (keeps control traffic off the public
                     internet), 1 NAT gateway per AZ for HA egress.

EksClusterConstruct  EKS cluster (K8s 1.32) with:
                       - KMS-encrypted Kubernetes secrets (envelope encryption)
                       - Full control-plane audit logging to CloudWatch
                       - Two managed node groups: "system" (m6i.large) and
                         "app" (c6i.2xlarge, labeled workload=backend)
                       - Nodes use IMDSv2, SSM Session Manager (no SSH),
                         AL2023 AMIs, node auto-repair
                       - EKS-managed addons: vpc-cni, kube-proxy, coredns,
                         aws-ebs-csi-driver (IRSA)
                       - AWS Load Balancer Controller (built-in construct)
                       - Cluster Autoscaler + metrics-server (Helm, IRSA)
                       - Optional EKS access entry for a human cluster admin

EcrConstruct         Private, KMS-encrypted, scan-on-push ECR repository with
                     lifecycle rules for image retention.

BackendWorkload      The "basic backend": a namespace with a ResourceQuota, a
Construct            Deployment (liveness/readiness probes, resource
                     requests/limits), a PodDisruptionBudget, a ClusterIP
                     Service, an ALB Ingress, and a HorizontalPodAutoscaler.
                     Ships with a placeholder image - point it at your own
                     image in the ECR repo once you have one.
```

## Configuration (cdk.json context)

| Key                          | Purpose                                                                 | Default              |
| ---------------------------- | ----------------------------------------------------------------------- | -------------------- |
| `clusterName`                | Name prefix for the cluster, node groups, ECR repo, KMS alias           | `paraprosdokian-htf` |
| `allowedPublicEndpointCidrs` | CIDR blocks allowed to reach the public Kubernetes API endpoint         | `[]` (unrestricted)  |
| `clusterAdminPrincipalArn`   | IAM user/role ARN to grant cluster-admin access via an EKS access entry | `null` (none)        |

Override any of these at the CLI, e.g.:

```sh
npx cdk deploy -c clusterAdminPrincipalArn=arn:aws:iam::111111111111:user/alice \
  -c allowedPublicEndpointCidrs='["203.0.113.0/24"]'
```

## Deploying

```sh
npm install
npm run build
npx cdk bootstrap   # once per account/region
npx cdk deploy
```

After deploy, configure kubectl (the `UpdateKubeconfigCommand` stack output
has the exact command):

```sh
aws eks update-kubeconfig --name paraprosdokian-htf --region <region>
kubectl get nodes
kubectl -n backend get deploy,svc,ingress,hpa
```

Push your own image and point the Deployment at it:

```sh
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
docker build -t <account>.dkr.ecr.<region>.amazonaws.com/paraprosdokian-htf-backend:v1 .
docker push <account>.dkr.ecr.<region>.amazonaws.com/paraprosdokian-htf-backend:v1
kubectl -n backend set image deployment/backend-api backend-api=<account>.dkr.ecr.<region>.amazonaws.com/paraprosdokian-htf-backend:v1
```

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk synth` emits the synthesized CloudFormation template
