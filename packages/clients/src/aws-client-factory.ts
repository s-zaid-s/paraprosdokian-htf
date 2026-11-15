import { STSClientConfig } from '@aws-sdk/client-sts';
import { Ec2Client, IEc2Client } from './ec2-client';
import { EcrClient, IEcrClient } from './ecr-client';
import { EksClient, IEksClient } from './eks-client';
import { IStsClient, StsClient } from './sts-client';

/**
 * Static credentials or a credentials provider (e.g. `fromIni()` or
 * `fromTemporaryCredentials()` from `@aws-sdk/credential-providers`).
 * Every SDK client accepts the same type; it is taken from the STS config to
 * avoid a direct dependency on `@smithy/types`.
 */
export type AwsCredentials = NonNullable<STSClientConfig['credentials']>;

/** Configuration shared by every client the factory creates. */
export interface AwsClientConfig {
  /**
   * AWS region, e.g. `us-east-1`.
   * @default - the SDK's default resolution (`AWS_REGION` env var, shared config file, ...)
   */
  readonly region?: string;

  /**
   * Credentials for every client. If a provider is given, the same provider
   * instance is passed to every client.
   * @default - the SDK's default credential provider chain
   */
  readonly credentials?: AwsCredentials;
}

/**
 * Creates the repo's AWS clients with one shared region/credentials
 * configuration. Each `create*` call returns a new client, typed as its
 * interface so callers depend on the abstraction.
 */
export class AwsClientFactory {
  private readonly sdkConfig: AwsClientConfig;

  constructor(config: AwsClientConfig = {}) {
    // Only pass settings that were provided, so the SDK's own defaults apply
    // to anything left unset.
    this.sdkConfig = {
      ...(config.region !== undefined && { region: config.region }),
      ...(config.credentials !== undefined && { credentials: config.credentials }),
    };
  }

  public createStsClient(): IStsClient {
    return new StsClient({ ...this.sdkConfig });
  }

  public createEcrClient(): IEcrClient {
    return new EcrClient({ ...this.sdkConfig });
  }

  public createEksClient(): IEksClient {
    return new EksClient({ ...this.sdkConfig });
  }

  public createEc2Client(): IEc2Client {
    return new Ec2Client({ ...this.sdkConfig });
  }
}
