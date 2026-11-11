import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { EcrConstruct } from "../src";

function synth(): Template {
  const stack = new Stack(new App(), "TestStack");
  new EcrConstruct(stack, "Ecr", { repositoryName: "test-backend" });
  return Template.fromStack(stack);
}

test("creates a KMS-encrypted, scan-on-push, immutable repository", () => {
  synth().hasResourceProperties("AWS::ECR::Repository", {
    RepositoryName: "test-backend",
    ImageScanningConfiguration: { ScanOnPush: true },
    ImageTagMutability: "IMMUTABLE",
    EncryptionConfiguration: { EncryptionType: "KMS" },
  });
});

test("retains the repository (and its images) when the stack is deleted", () => {
  synth().hasResource("AWS::ECR::Repository", {
    DeletionPolicy: "Retain",
    UpdateReplacePolicy: "Retain",
  });
});

test("expires untagged images and caps tagged image count", () => {
  const template = synth();
  const repos = template.findResources("AWS::ECR::Repository");
  const [repo] = Object.values(repos);
  const policy = JSON.parse(
    repo.Properties.LifecyclePolicy.LifecyclePolicyText,
  );
  expect(policy.rules).toEqual([
    expect.objectContaining({
      selection: expect.objectContaining({
        tagStatus: "untagged",
        countType: "sinceImagePushed",
        countNumber: 14,
      }),
    }),
    expect.objectContaining({
      selection: expect.objectContaining({
        tagStatus: "tagged",
        tagPrefixList: ["v"],
        countType: "imageCountMoreThan",
        countNumber: 20,
      }),
    }),
  ]);
});
