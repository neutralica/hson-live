import { resolve } from "node:path";
import { run_command_test_case } from "./command-test-case.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "schema.mvp-consumer",
  title: "Hson Schema MVP consumer",
  category: "Tooling",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "consumer", "typescript", "verification"]),
});

const repositoryRoot = resolve(import.meta.dirname, "..");
run_command_test_case({
  suiteId: "schema.mvp-consumer",
  caseId: "built Hson Schema accepts its isolated MVP consumer project",
  title: "built Hson Schema accepts its isolated MVP consumer project",
  cwd: repositoryRoot,
  commands: [
    { command: "npm", args: ["run", "build"] },
    {
      command: process.execPath,
      args: [
        "--import=tsx",
        "scripts/hson-schema.mts",
        "check",
        "--project",
        "tests/fixtures/hson-schema-mvp/tsconfig.json",
      ],
    },
  ],
});
