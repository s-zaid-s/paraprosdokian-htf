// Plain `require`, not `import`, matching tsconfig-overrides.test.ts: the script
// is a standalone CommonJS Node tool at the repo root with no type declarations.
const { hermeticEnv, compareSnapshots, hasDrift } = require("../../../scripts/synth-snapshot");

describe("hermeticEnv", () => {
  const developerEnv = {
    PATH: "/usr/bin",
    HOME: "/home/dev",
    AWS_PROFILE: "personal-sandbox",
    AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
    AWS_SECRET_ACCESS_KEY: "secret",
    AWS_SESSION_TOKEN: "token",
    AWS_REGION: "us-west-2",
    AWS_DEFAULT_REGION: "us-west-2",
    CDK_DEFAULT_ACCOUNT: "111111111111",
    CDK_DEFAULT_REGION: "us-west-2",
  };

  it("removes every credential source the CDK CLI could use to override the account", () => {
    const env = hermeticEnv(developerEnv);

    for (const key of [
      "AWS_PROFILE",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_DEFAULT_REGION",
      "CDK_DEFAULT_REGION",
    ]) {
      expect(env).not.toHaveProperty(key);
    }
    expect(env.AWS_EC2_METADATA_DISABLED).toBe("true");
    expect(env.AWS_CONFIG_FILE).toBe(env.AWS_SHARED_CREDENTIALS_FILE);
  });

  it("pins the account/region that apps/infra/cdk.context.json has cached lookups for", () => {
    const env = hermeticEnv(developerEnv);

    expect(env.CDK_DEFAULT_ACCOUNT).toBe("892242895576");
    expect(env.AWS_REGION).toBe("eu-west-1");
  });

  it("keeps unrelated variables", () => {
    expect(hermeticEnv(developerEnv)).toMatchObject({ PATH: "/usr/bin", HOME: "/home/dev" });
  });
});

describe("compareSnapshots", () => {
  it("reports no drift for identical templates", () => {
    const templates = { "Stack.template.json": '{\n "Resources": {}\n}' };

    const result = compareSnapshots(templates, { ...templates });

    expect(result).toEqual({ added: [], removed: [], changed: [] });
    expect(hasDrift(result)).toBe(false);
  });

  it("reports added, removed and changed templates", () => {
    const committed = {
      "Kept.template.json": "{}",
      "Changed.template.json": '{"a":1}',
      "Removed.template.json": "{}",
    };
    const synthesized = {
      "Kept.template.json": "{}",
      "Changed.template.json": '{"a":2}',
      "Added.template.json": "{}",
    };

    const result = compareSnapshots(committed, synthesized);

    expect(result).toEqual({
      added: ["Added.template.json"],
      removed: ["Removed.template.json"],
      changed: ["Changed.template.json"],
    });
    expect(hasDrift(result)).toBe(true);
  });

  it("treats every synthesized template as added when no snapshot is committed", () => {
    const result = compareSnapshots({}, { "Stack.template.json": "{}" });

    expect(result.added).toEqual(["Stack.template.json"]);
    expect(hasDrift(result)).toBe(true);
  });

  it("ignores CRLF vs LF differences from Windows checkouts", () => {
    const result = compareSnapshots(
      { "Stack.template.json": '{\r\n "a": 1\r\n}' },
      { "Stack.template.json": '{\n "a": 1\n}' },
    );

    expect(hasDrift(result)).toBe(false);
  });
});
