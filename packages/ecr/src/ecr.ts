import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { Construct } from "constructs";

export interface EcrConstructProps {
  readonly repositoryName: string;
}

/**
 * Private image repository for the firm's backend services.
 */
export class EcrConstruct extends Construct {
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcrConstructProps) {
    super(scope, id);

    this.repository = new ecr.Repository(this, "Repository", {
      repositoryName: props.repositoryName,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.KMS,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: "Expire untagged images after 14 days",
          tagStatus: ecr.TagStatus.UNTAGGED,
          maxImageAge: Duration.days(14),
        },
      ],
    });

    // Assumes semantic-version tags (e.g. v1.2.3); adjust the prefix to match your CI tagging scheme.
    this.repository.addLifecycleRule({
      description: "Retain only the last 20 tagged images",
      tagStatus: ecr.TagStatus.TAGGED,
      tagPrefixList: ["v"],
      maxImageCount: 20,
    });
  }
}
