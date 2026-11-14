// Plain `require`, not `import` - the script is a standalone CommonJS Node
// tool (consistent with scripts/check-config-versions.js) with no type
// declarations of its own. It lives at the repo root (not in this package),
// so the path climbs out of apps/infra/test back to the monorepo root.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const {
  getBaseFlags,
  findUndocumentedOverrides,
  findConsumingTsconfigFiles,
} = require("../../../scripts/check-tsconfig-overrides");

describe("getBaseFlags", () => {
  it("returns only the compilerOptions keys set to true", () => {
    const raw = JSON.stringify({
      compilerOptions: {
        strict: true,
        isolatedModules: true,
        noUnusedLocals: false,
        target: "ES2022",
      },
    });

    expect(getBaseFlags(raw)).toEqual(["strict", "isolatedModules"]);
  });
});

describe("findUndocumentedOverrides", () => {
  const baseFlags = ["strict", "exactOptionalPropertyTypes"];

  it("flags a disabled base flag with no nearby comment", () => {
    const raw = ["{", '  "compilerOptions": {', '    "strict": false', "  }", "}"].join("\n");

    const violations = findUndocumentedOverrides(baseFlags, raw);

    expect(violations).toEqual([{ flag: "strict", line: 3 }]);
  });

  it("allows a disabled base flag when justified by a comment on the line above", () => {
    const raw = [
      "{",
      '  "compilerOptions": {',
      "    // legacy package predates null-safety work, see HTF-999",
      '    "strict": false',
      "  }",
      "}",
    ].join("\n");

    expect(findUndocumentedOverrides(baseFlags, raw)).toEqual([]);
  });

  it("allows a disabled base flag when justified by a trailing comment", () => {
    const raw = [
      "{",
      '  "compilerOptions": {',
      '    "strict": false // see HTF-999 for context',
      "  }",
      "}",
    ].join("\n");

    expect(findUndocumentedOverrides(baseFlags, raw)).toEqual([]);
  });

  it("does not flag flags the base config never turns on", () => {
    const raw = ["{", '  "compilerOptions": {', '    "noUnusedLocals": false', "  }", "}"].join(
      "\n",
    );

    expect(findUndocumentedOverrides(baseFlags, raw)).toEqual([]);
  });
});

describe("findConsumingTsconfigFiles", () => {
  it("covers every workspace in packages/ and apps/, including their test configs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tsconfig-overrides-"));
    const touch = (relative: string) => {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, relative), "{}");
    };
    for (const file of [
      "tsconfig.json",
      "tsconfig.base.json",
      "packages/network/tsconfig.json",
      "packages/network/test/tsconfig.json",
      "packages/config-eslint/package.json",
      "apps/infra/tsconfig.json",
      "apps/infra/test/tsconfig.json",
    ]) {
      touch(file);
    }

    const found = findConsumingTsconfigFiles(root).map((file: string) => path.relative(root, file));

    expect(found.sort()).toEqual(
      [
        "tsconfig.json",
        "packages/network/tsconfig.json",
        "packages/network/test/tsconfig.json",
        "apps/infra/tsconfig.json",
        "apps/infra/test/tsconfig.json",
      ]
        .map((file) => path.normalize(file))
        .sort(),
    );
    fs.rmSync(root, { recursive: true, force: true });
  });
});
