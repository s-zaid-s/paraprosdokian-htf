import sharedConfig from "@htf/config-eslint";

export default [
  {
    ignores: ["cdk.out/**", "node_modules/**", "**/*.d.ts", "**/*.js"],
  },
  ...sharedConfig,
];
