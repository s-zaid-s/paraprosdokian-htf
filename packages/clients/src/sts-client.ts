import { GetCallerIdentityCommand, STSClient, STSClientConfig } from '@aws-sdk/client-sts';

/** The identity of the credentials in use. */
export interface CallerIdentity {
  /** AWS account ID. */
  readonly account: string;
  /** ARN of the calling principal. */
  readonly arn: string;
  /** Unique identifier of the calling principal. */
  readonly userId: string;
}

/** The STS operations this repo uses. Depend on this rather than `StsClient`. */
export interface IStsClient {
  /** Returns the account, ARN and user ID of the credentials in use. */
  getCallerIdentity(): Promise<CallerIdentity>;
}

/** `IStsClient` backed by the AWS SDK v3 `STSClient`. */
export class StsClient implements IStsClient {
  private readonly client: STSClient;

  /** @param configOrClient SDK client config (region, credentials, ...) or an existing `STSClient` to reuse. */
  constructor(configOrClient: STSClientConfig | STSClient = {}) {
    this.client = configOrClient instanceof STSClient ? configOrClient : new STSClient(configOrClient);
  }

  public async getCallerIdentity(): Promise<CallerIdentity> {
    const { Account, Arn, UserId } = await this.client.send(new GetCallerIdentityCommand({}));
    if (!Account || !Arn || !UserId) {
      throw new Error('STS GetCallerIdentity returned an incomplete identity');
    }
    return { account: Account, arn: Arn, userId: UserId };
  }
}
