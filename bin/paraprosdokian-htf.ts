#!/opt/homebrew/opt/node/bin/node
import * as cdk from "aws-cdk-lib/core";
import { ParaprosdokianHtfStack } from "../lib/paraprosdokian-htf-stack";

const app = new cdk.App();
type RuntimeGlobal = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};
const environment = (globalThis as RuntimeGlobal).process?.env ?? {};

new ParaprosdokianHtfStack(app, "ParaprosdokianHtfStack", {
  // EKS requires a concrete account/region at synth time (subnet AZ lookups,
  // availability-zone-aware resources, etc.), so default to the CLI's
  // configured account/region rather than leaving the stack environment-agnostic.
  env: {
    account: environment.CDK_DEFAULT_ACCOUNT,
    region: environment.CDK_DEFAULT_REGION,
  },
});
