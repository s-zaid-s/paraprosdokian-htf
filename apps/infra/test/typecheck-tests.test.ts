import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Plain `require`, matching the other script tests: a standalone CommonJS tool
// at the repo root with no type declarations.
const { findTestProjects } = require("../../../scripts/typecheck-tests");

describe("findTestProjects", () => {
  it("finds every workspace's test project in packages/ and apps/", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "typecheck-tests-"));
    const touch = (relative: string) => {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), "{}");
    };
    for (const file of [
      "packages/network/test/tsconfig.json",
      "packages/ecr/test/tsconfig.json",
      // Workspaces without a test project (e.g. the shared config packages) are skipped.
      "packages/config-eslint/package.json",
      "apps/infra/test/tsconfig.json",
    ]) {
      touch(file);
    }

    expect(findTestProjects(root)).toEqual(
      ["packages/ecr/test", "packages/network/test", "apps/infra/test"].map((dir) =>
        path.normalize(dir),
      ),
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("finds the real repo's test projects", () => {
    const found = findTestProjects().map((dir: string) => dir.split(path.sep).join("/"));

    expect(found).toEqual(
      expect.arrayContaining([
        "packages/ecr/test",
        "packages/eks-cluster/test",
        "packages/network/test",
        "packages/workloads/test",
        "apps/infra/test",
      ]),
    );
  });
});
