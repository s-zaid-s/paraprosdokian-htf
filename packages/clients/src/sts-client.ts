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

/** Wrapper around the SDK `STSClient`, exposing only the calls this repo uses. */
export class StsClient {
  private readonly client: STSClient;

  /** @param configOrClient SDK client config (region, credentials, ...) or an existing `STSClient` to reuse. */
  constructor(configOrClient: STSClientConfig | STSClient = {}) {
    this.client = configOrClient instanceof STSClient ? configOrClient : new STSClient(configOrClient);
  }

  /** Returns the account, ARN and user ID of the credentials in use. */
  public async getCallerIdentity(): Promise<CallerIdentity> {
    const { Account, Arn, UserId } = await this.client.send(new GetCallerIdentityCommand({}));
    if (!Account || !Arn || !UserId) {
      throw new Error('STS GetCallerIdentity returned an incomplete identity');
    }
    return { account: Account, arn: Arn, userId: UserId };
  }
}
