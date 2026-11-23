import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { checkHsonDiagnostics } from "../scripts/check-hson-diagnostics.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "validation.hson-diagnostics", title: "Configured Hson source diagnostics", category: "Tooling",
  runtime: "node", tags: Object.freeze(["diagnostics", "source-ownership", "typescript"]),
});

const root = realpathSync(mkdtempSync(join(tmpdir(), "hson-diagnostics-")));
const project = "tsconfig.json";
const entry = join(root, "entry.ts");
const dependency = join(root, "dependency.mts");
const prefix = 'import { Hson } from "hson-live";\n';
const clean = 'export const value = Hson.canonical`1`;\n';
const broken = 'export const value = Hson.canonical`+1`;\n';
const code = "HSON_NUMBER_LEADING_PLUS";
const expect = (diagnostic: string) => `// @hson-expect-error ${diagnostic}\n`;
const writeProject = (files = ["entry.ts"]) => writeFileSync(join(root, project), JSON.stringify({
  compilerOptions: {
    target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [],
    paths: { "hson-live": [resolve(import.meta.dirname, "../dist/index.d.ts")] },
  },
  files,
}));
const check = (label: string, status: 0 | 1, patterns: readonly RegExp[], sources = [entry], projects = [project]) => {
  const { failures } = checkHsonDiagnostics(root, projects, sources, []);
  const output = failures.join("\n");
  assert.equal(Number(failures.length > 0), status, output);
  for (const pattern of patterns) assert.match(output, pattern);
  console.log(`ok - ${label} (status ${status})`);
  return failures;
};

try {
  writeProject();
  writeFileSync(entry, prefix + clean);
  check("clean configured TypeScript", 0, []);
  writeFileSync(entry, prefix + broken);
  const parsed = ts.getParsedCommandLineOfConfigFile(join(root, project), {}, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => assert.fail(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
  });
  assert.ok(parsed);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  assert.deepEqual(ts.getPreEmitDiagnostics(program), []);
  check("unexpected Hson diagnostic despite zero TypeScript diagnostics", 1,
    [/entry\.ts:2:\d+-2:\d+ \[HSON_NUMBER_LEADING_PLUS\].*tokenize-hson/]);

  writeFileSync(entry, prefix + expect(code) + broken);
  check("exact expectation consumes its diagnostic", 0, []);
  writeFileSync(entry, prefix + expect(code) + broken + 'Hson.canonical`+2`;\n');
  assert.equal(check("expectation consumes only one diagnostic", 1, [/invalid Hson number "\+2"/]).length, 1);
  writeFileSync(entry, prefix + expect(code) + clean);
  check("unused expectation", 1, [/HSON_EXPECT_ERROR_UNUSED/]);
  writeFileSync(entry, prefix + expect("HSON_OTHER") + broken);
  check("wrong diagnostic code", 1, [/HSON_EXPECT_ERROR_UNUSED/, /HSON_NUMBER_LEADING_PLUS/]);
  writeFileSync(entry, prefix + expect("") + broken);
  check("invalid expectation", 1, [/HSON_EXPECT_ERROR_INVALID/, /HSON_NUMBER_LEADING_PLUS/]);
  writeFileSync(entry, prefix + "// @ts-expect-error Negative TypeScript assignment.\n" + broken.replace("value =", "value: never ="));
  check("a TypeScript expectation leaves Hson diagnostics visible", 1, [/^entry\.ts:3:.*HSON_NUMBER_LEADING_PLUS/]);

  const future = join(root, "future.hson");
  const ordinary = join(root, "ordinary.hson");
  writeFileSync(entry, prefix + clean);
  writeFileSync(future, "// @hson-diagnostics-ignore-file\n+1\n");
  writeFileSync(ordinary, "+2\n");
  assert.equal(check("standalone suppression does not hide another source", 1,
    [/^ordinary\.hson:1:.*HSON_NUMBER_LEADING_PLUS/], [entry, future, ordinary]).length, 1);
  writeFileSync(ordinary, "2\n");
  check("leading standalone directive suppresses that file", 0, [], [entry, future, ordinary]);
  writeFileSync(future, "0\n// @hson-diagnostics-ignore-file\n+1\n");
  check("non-leading standalone directive does not suppress", 1,
    [/^future\.hson:.*HSON_NUMBER_LEADING_PLUS/], [entry, future, ordinary]);

  writeFileSync(entry, prefix + 'export const Schema = Hson.schema`<type "data" root <unknown "string">>`;\n');
  check("local Schema authoring producer", 1, [/UNKNOWN_SCHEMA_MEMBER/]);
  writeFileSync(entry, prefix + 'export const Schema = Hson.sche\\u006da`<type "data" root <unknown "string">>`;\n');
  check("Schema discovery uses the TypeScript binding for escaped spelling", 1, [/UNKNOWN_SCHEMA_MEMBER/]);

  writeFileSync(entry, 'export { value } from "./dependency.mjs";\n');
  writeFileSync(dependency, prefix + broken);
  check("diagnostic in a dependency outside the configured roots", 1, [/^dependency\.mts:2:.*HSON_NUMBER_LEADING_PLUS/], [entry, dependency]);
  writeFileSync(dependency, prefix + clean);
  check("source correction clears the dependency diagnostic", 0, [], [entry, dependency]);

  writeFileSync(entry, prefix + 'import { Profile } from "./dependency.mjs";\nProfile.certify(Hson.data`<name 42>`);\n');
  writeFileSync(dependency, prefix + 'export const Profile = Hson.schema`<type "data" root <object <name "string">>>`;\n');
  check("project Schema diagnostics use a declaration from a source dependency", 1, [/Static Hson does not satisfy Profile/], [entry, dependency]);
  writeFileSync(entry, prefix + 'import { Missing } from "./dependency.mjs";\nMissing.certify(Hson.data`<name 42>`);\n');
  check("missing export evidence cannot hide a project diagnostic", 1, [/HSON_ANALYSIS_IMPORT.*Missing/], [entry, dependency]);

  rmSync(dependency);
  writeFileSync(entry, '// @ts-expect-error Deliberately missing module.\nexport { value } from "./dependency.mjs";\n');
  check("TypeScript suppression leaves missing dependency evidence visible", 1, [/HSON_ANALYSIS_IMPORT.*dependency\.mjs/]);

  writeFileSync(entry, 'import { Hson } from "missing-hson";\nexport const value = Hson.event`invalid`;\n');
  check("missing Event import cannot settle as clean", 1, [/HSON_ANALYSIS_IMPORT.*missing-hson/]);
  writeFileSync(entry, prefix + 'export const value = Hson.event`<hson:event on:click local:${"go"} <> >`;\n');
  check("configured Event import enables Event diagnostics", 1, [/HSON_TAGGED_TEMPLATE_REQUIRED/]);

  writeFileSync(entry, prefix + clean);
  check("missing project", 1, [/HSON_ANALYSIS_PROJECT.*analysis did not run/], [entry], ["missing.json"]);
  writeProject(["missing.ts"]);
  check("missing configured root", 1, [/HSON_ANALYSIS_PROJECT.*missing\.ts/, /entry\.ts.*No configured TypeScript project/]);
  writeProject();
  writeFileSync(dependency, prefix + clean);
  check("unowned maintained source", 1, [/dependency\.mts.*No configured TypeScript project/], [entry, dependency]);
} finally {
  rmSync(root, { recursive: true, force: true });
}
