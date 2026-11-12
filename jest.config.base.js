// Shared Jest config every package/app's jest.config.js re-exports
// (`module.exports = require('../../jest.config.base')`), so test running
// behavior stays identical across the monorepo without copy-pasting it.
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  setupFilesAfterEnv: ["aws-cdk-lib/testhelpers/jest-autoclean"],
};
