#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { ParaprosdokianHtfStack } from "../lib/paraprosdokian-htf-stack";

const app = new cdk.App();

// Build the env object without explicit `undefined` keys so it satisfies
// `exactOptionalPropertyTypes` (an absent key is fine; `undefined` isn't).
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;

new ParaprosdokianHtfStack(app, "ParaprosdokianHtfStack", {
  // EKS requires a concrete account/region at synth time (subnet AZ lookups,
  // availability-zone-aware resources, etc.), so default to the CLI's
  // configured account/region rather than leaving the stack environment-agnostic.
  env: {
    ...(account !== undefined ? { account } : {}),
    ...(region !== undefined ? { region } : {}),
  },
});
