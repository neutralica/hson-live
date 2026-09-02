import { resolve } from "node:path";
import { run_command_test_case } from "./command-test-case.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "schema.document-consumer",
  title: "Hson Schema document consumer",
  category: "Tooling",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "document", "consumer", "typescript"]),
});

const repositoryRoot = resolve(import.meta.dirname, "..");
run_command_test_case({
  suiteId: "schema.document-consumer",
  caseId: "built document schema accepts its isolated consumer project",
  title: "built document schema accepts its isolated consumer project",
  cwd: repositoryRoot,
  commands: [
    { command: "npm", args: ["run", "build"] },
    {
      command: process.execPath,
      args: [
        "--import=tsx",
        "scripts/hson-schema.mts",
        "build",
        "--project",
        "tests/fixtures/hson-schema-document/tsconfig.json",
      ],
    },
  ],
});
