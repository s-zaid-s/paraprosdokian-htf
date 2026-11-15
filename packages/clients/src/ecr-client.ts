import {
  BatchGetImageCommand,
  ECRClient,
  ECRClientConfig,
  Image,
  ImageDetail,
  ImageFailure,
  ImageIdentifier,
  paginateDescribeImages,
} from '@aws-sdk/client-ecr';

/** Result of `EcrClient.batchGetImage`. */
export interface BatchGetImageResult {
  /** Images that were found. */
  readonly images: Image[];
  /** Images that could not be retrieved (e.g. tag not found), with the reason. */
  readonly failures: ImageFailure[];
}

/** Wrapper around the SDK `ECRClient`, exposing only the calls this repo uses. */
export class EcrClient {
  private readonly client: ECRClient;

  /** @param configOrClient SDK client config (region, credentials, ...) or an existing `ECRClient` to reuse. */
  constructor(configOrClient: ECRClientConfig | ECRClient = {}) {
    this.client = configOrClient instanceof ECRClient ? configOrClient : new ECRClient(configOrClient);
  }

  /**
   * Describes images in a repository, following all pages.
   *
   * Note: ECR throws `ImageNotFoundException` if any requested image does not
   * exist. To check for existence without an exception, use `batchGetImage`.
   *
   * @param repositoryName the ECR repository
   * @param imageIds specific images to describe; omit to describe all images
   */
  public async describeImages(repositoryName: string, imageIds?: ImageIdentifier[]): Promise<ImageDetail[]> {
    const details: ImageDetail[] = [];
    for await (const page of paginateDescribeImages({ client: this.client }, { repositoryName, imageIds })) {
      details.push(...(page.imageDetails ?? []));
    }
    return details;
  }

  /**
   * Gets image manifests. Images that don't exist are reported in `failures`
   * rather than thrown, which makes this suitable for existence checks and
   * resolving a tag to a digest.
   *
   * @param repositoryName the ECR repository
   * @param imageIds the images to get, by tag and/or digest
   */
  public async batchGetImage(repositoryName: string, imageIds: ImageIdentifier[]): Promise<BatchGetImageResult> {
    const output = await this.client.send(new BatchGetImageCommand({ repositoryName, imageIds }));
    return { images: output.images ?? [], failures: output.failures ?? [] };
  }
}
