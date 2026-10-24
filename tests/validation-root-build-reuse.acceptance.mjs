import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as configuration from "../scripts/validation-config.mjs";
import { assertInventory, createInventory, repositoryRoot } from "../scripts/validation-inventory.mjs";
import { runStages } from "../scripts/validation-execution.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "validation.root-build-reuse", title: "Invocation-scoped root build prerequisites", category: "Tooling",
  runtime: "node", tags: Object.freeze(["build", "freshness", "failure-propagation", "standalone"]),
});

const consumers = configuration.rootBuildPrerequisites;
const names = Object.keys(consumers);
const scripts = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")).scripts;
for (const [name, body] of Object.entries(consumers)) assert.equal(scripts[name], `npm run build && ${body}`);
const inventory = assertInventory(createInventory());
for (const [name, body] of Object.entries(consumers)) {
  const path = body.split(" ").at(-1);
  assert(inventory.commands[name].suites.includes(path));
  assert(inventory.suites.find(suite => suite.identity === path).destinations.some(route => route.registration === name && route.invocation === "direct"));
}
assert(createInventory(repositoryRoot, { ...configuration, rootBuildPrerequisites: {
  ...consumers, [names[0]]: consumers[names[0]] + " --new-coverage",
} }).errors.some(error => error.includes("Root build prerequisite wrapper changed")));
assert(createInventory(repositoryRoot, { ...configuration, gateCommands: (scripts, mode) =>
  configuration.gateCommands(scripts, mode).filter(name => name !== "build"),
}).errors.some(error => error.includes("Root build prerequisite must precede")));

// Real npm wrappers and real child processes in tiny isolated projects. Only the
// expensive compiler bodies are substitutes; the separate integration run uses
// the unchanged original suites. No repository inputs/outputs are mutated here.
mkdirSync(resolve(repositoryRoot, "tmp"), { recursive: true });
const temporary = mkdtempSync(resolve(repositoryRoot, "tmp/validation-root-build-reuse-"));
let checks = 0;
async function check(name, body) { await body(); console.log(`ok ${++checks} - ${name}`); }
function fixture({ buildTail = "", bodyTail = "" } = {}) {
  const root = mkdtempSync(resolve(temporary, "project-"));
  for (const dir of ["scripts", "tests"]) mkdirSync(resolve(root, dir));
  const put = (file, text) => writeFileSync(resolve(root, file), text);
  const pkg = { type: "module", private: true, scripts: {
    build: "node --import=tsx scripts/hson-schema.mts build --project tsconfig.json && node scripts/build-hson-schema-cli.mjs && node scripts/build-fixture.mjs",
    ...Object.fromEntries(names.map(name => [name, scripts[name]])),
  } };
  put("package.json", JSON.stringify(pkg));
  put("source.ts", "export const value = 1;\n");
  put("dependency.d.ts", "export declare const dependency: 1;\n");
  put("tsconfig.json", '{"compilerOptions":{"declaration":true}}\n');
  put("scripts/verify-fixture.mjs", `import {readFileSync} from 'node:fs'; import {dirname,resolve} from 'node:path';
export function verify_schema_compiler_project(project) {
  const root=dirname(project), manifest=JSON.parse(readFileSync(resolve(root,'.hson/compiler-input/tsconfig.json/manifest.json'),'utf8'));
  if(manifest.dependency!==readFileSync(resolve(root,'dependency.d.ts'),'utf8')) throw new Error('Stale Hson compiler dependency');
}`);
  put("scripts/hson-schema.mts", `import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
mkdirSync('dist/internal/hson-schema',{recursive:true}); mkdirSync('.hson/compiler-input/tsconfig.json',{recursive:true});
for(const [path,text] of Object.entries({
  'dist/index.js':'export const value = 1;', 'dist/index.d.ts':'export declare const value: 1;',
  'dist/index.js.map':'{"version":3}', 'dist/hson-authoring.d.ts':'export declare const authoring: true;',
  'dist/hson-schema.mjs':'// compiler placeholder', '.hson/compiler-input/tsconfig.json/tsconfig.json':'{}',
  '.hson/compiler-input/tsconfig.json/manifest.json':JSON.stringify({publication:'current',dependency:readFileSync('dependency.d.ts','utf8')}),
})) writeFileSync(path,text);
writeFileSync('dist/internal/hson-schema/compiler-project-watch.js',readFileSync('scripts/verify-fixture.mjs','utf8'));`);
  put("scripts/build-hson-schema-cli.mjs", "import {writeFileSync} from 'node:fs'; writeFileSync('dist/hson-schema.mjs','// packaged CLI');");
  put("scripts/build-fixture.mjs", `import {appendFileSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
// Final generation legitimately republishes compiler inputs after the CLI writer.
writeFileSync('.hson/compiler-input/tsconfig.json/manifest.json',readFileSync('.hson/compiler-input/tsconfig.json/manifest.json'));
appendFileSync('trace.jsonl',JSON.stringify({type:'build'})+'\\n');
${buildTail}`);
  for (const [name, body] of Object.entries(consumers)) {
    put(body.split(" ").at(-1), `import assert from 'node:assert/strict';
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
assert.equal(readFileSync('dist/index.d.ts','utf8'),'export declare const value: 1;');
assert.equal(JSON.parse(readFileSync('.hson/compiler-input/tsconfig.json/manifest.json','utf8')).publication,'current');
appendFileSync('trace.jsonl',JSON.stringify({type:'body',name:${JSON.stringify(name)}})+'\\n');
${bodyTail}`);
  }
  const inputFiles = ["package.json", "source.ts", "tsconfig.json", "scripts/hson-schema.mts", "scripts/build-hson-schema-cli.mjs",
    "scripts/build-fixture.mjs", "scripts/verify-fixture.mjs", ...Object.values(consumers).map(body => body.split(" ").at(-1))];
  const identify = () => ({ sourceSha256: createHash("sha256").update(Buffer.concat(inputFiles.map(file => readFileSync(resolve(root, file))))).digest("hex") });
  const rows = (selected = ["build", ...names]) => selected.map(name => ({ name, command: pkg.scripts[name] }));
  const trace = () => existsSync(resolve(root, "trace.jsonl")) ? readFileSync(resolve(root, "trace.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
  const run = (stages = rows(), extra = {}) => runStages({ root, mode: "root-build-fixture", configuration: { consumers }, preflight() {},
    stages, rootBuildPrerequisites: consumers, identify, ...extra });
  const mutate = source => ({ name: "mutate", executable: process.execPath, args: ["--input-type=module", "-e", source] });
  return { root, put, rows, trace, run, mutate, identify };
}
try {
  await check("each unchanged standalone wrapper builds before executing its suite", () => {
    for (const name of names) {
      const f = fixture();
      assert(!existsSync(resolve(f.root, "dist")));
      const result = spawnSync("npm", ["run", name], { cwd: f.root, encoding: "utf8", timeout: 30_000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(f.trace(), [{ type: "build" }, { type: "body", name }]);
    }
  });
  await check("one orchestrated root build executes all three original wrapper destinations", async () => {
    const f = fixture(), result = await f.run();
    assert.equal(result.exitStatus, 0);
    assert.equal(result.report.rootBuildInvocations, 1);
    assert.equal(result.report.rootBuildReuses, 3);
    assert.deepEqual(f.trace(), [{ type: "build" }, ...names.map(name => ({ type: "body", name }))]);
    assert(result.report.stages.every(stage => stage.status === "passed"));
    for (const row of result.report.stages.slice(2)) {
      assert.equal(row.command, scripts[row.name]);
      assert.equal(row.executedCommand, consumers[row.name]);
      assert.equal(row.rootBuildPrerequisite.stage, "build");
    }
    const second = await f.run(f.rows([names[0]]));
    assert.notEqual(second.exitStatus, 0, "previous run's intact outputs cannot authorize another run");
    assert.match(second.report.stages[1].error, /this validation invocation/);
    assert.notEqual(second.reportPath, result.reportPath);
    assert.equal(f.trace().length, 4);
  });
  await check("failed standalone prerequisite never executes its body", () => {
    const f = fixture({ buildTail: "process.exit(19);" });
    const result = spawnSync("npm", ["run", names[0]], { cwd: f.root, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 19);
    assert.deepEqual(f.trace(), [{ type: "build" }]);
  });
  await check("unrelated stage names never inherit prerequisite handling", async () => {
    const f = fixture();
    const unrelated = { name: "toString", executable: process.execPath, args: ["-e", "process.exit(0)"] };
    const result = await f.run([f.rows()[0], unrelated, ...f.rows(names)]);
    assert.equal(result.exitStatus, 0);
    assert.equal(result.report.rootBuildInvocations, 1);
    assert.equal(result.report.rootBuildReuses, 3);
    assert.equal(result.report.stages[2].status, "passed");
  });
  await check("failed orchestrated prerequisite cannot be reused even when continuation is requested", async () => {
    const f = fixture({ buildTail: "process.exit(19);" });
    const stages = f.rows(); stages[0].continueOnFailure = true;
    const result = await f.run(stages);
    assert.notEqual(result.exitStatus, 0);
    assert.equal(result.report.stages[1].exitStatus, 19);
    assert.match(result.report.stages[2].error, /Missing successful root build/);
    assert.deepEqual(f.trace(), [{ type: "build" }]);
  });
  for (const [name, buildTail, pattern] of [
    ["missing emitted declaration", "rmSync('dist/index.d.ts');", /Missing root build prerequisite artifact/],
    ["missing non-sentinel JavaScript map", "rmSync('dist/index.js.map');", /Missing published root build output: dist\/index.js.map/],
    ["missing non-sentinel declaration", "rmSync('dist/hson-authoring.d.ts');", /Missing published root build output: dist\/hson-authoring.d.ts/],
    ["modified emitted runtime", "writeFileSync('dist/index.js','export const value = 2;');", /Modified published root build output: dist\/index.js/],
    ["modified later CLI output", "writeFileSync('dist/hson-schema.mjs','// modified');", /Modified published root build output: dist\/hson-schema.mjs/],
    ["missing producer evidence", "writeFileSync(process.env.HSON_VALIDATION_BUILD_PUBLICATION,'');", /Missing successful root build publication evidence/],
    ["missing generated inputs", "rmSync('.hson',{recursive:true});", /Missing root build prerequisite artifact/],
    ["incomplete publication", "writeFileSync('.hson/compiler-input/tsconfig.json/.publishing.json','{}');", /publication is incomplete/],
    ["source changed during build", "writeFileSync('source.ts','export const value = 2;');", /inputs changed during build/],
    ["config changed during build", "writeFileSync('tsconfig.json','{}');", /inputs changed during build/],
  ]) await check(`${name} prevents prerequisite admission`, async () => {
    const f = fixture({ buildTail }), result = await f.run();
    assert.notEqual(result.exitStatus, 0);
    assert.match(result.report.stages[1].error, pattern);
    assert.equal(result.report.stages[2].status, "skipped");
    assert.deepEqual(f.trace(), [{ type: "build" }]);
  });
  for (const [name, source, pattern] of [
    ["source edit", "writeFileSync('source.ts','export const value = 2;');", /is stale/],
    ["config edit", "writeFileSync('tsconfig.json','{}');", /is stale/],
    ["package edit", "writeFileSync('package.json',readFileSync('package.json','utf8')+' ');", /is stale/],
    ["build tool edit", "writeFileSync('scripts/build-fixture.mjs','// changed');", /is stale/],
    ["compiler dependency edit outside Git identity", "writeFileSync('dependency.d.ts','export declare const dependency: 2;');", /Stale Hson compiler dependency/],
    ["deleted declaration", "rmSync('dist/index.d.ts');", /Missing root build prerequisite artifact/],
    ["deleted non-sentinel map", "rmSync('dist/index.js.map');", /conflicting writer/],
    ["deleted non-sentinel declaration", "rmSync('dist/hson-authoring.d.ts');", /conflicting writer/],
    ["modified emitted runtime", "writeFileSync('dist/index.js','export const value = 2;');", /conflicting writer/],
    ["generated input edit", "writeFileSync('.hson/compiler-input/tsconfig.json/manifest.json','{}');", /conflicting writer/],
    ["equal-byte output rewrite", "writeFileSync('dist/index.js',readFileSync('dist/index.js'));", /conflicting writer/],
    ["new output", "writeFileSync('dist/new.js','// extra');", /conflicting writer/],
    ["symlink output", "symlinkSync('../source.ts','dist/alias.js');", /Unsafe root build artifact/],
  ]) await check(`${name} stops the dependent body`, async () => {
    const f = fixture();
    const result = await f.run([f.rows()[0], f.mutate(`import {readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs'; ${source}`), ...f.rows(names)]);
    assert.notEqual(result.exitStatus, 0);
    assert.match(result.report.stages[3].error, pattern);
    assert.deepEqual(f.trace(), [{ type: "build" }]);
  });
  await check("toolchain identity change prevents reuse", async () => {
    const f = fixture();
    const result = await f.run([f.rows()[0], f.mutate("import {writeFileSync} from 'node:fs'; writeFileSync('tool-version','changed');"), ...f.rows(names)], {
      identify: () => ({ ...f.identify(), typescript: existsSync(resolve(f.root, "tool-version")) ? "new" : "old" }),
    });
    assert.notEqual(result.exitStatus, 0);
    assert.match(result.report.stages[3].error, /is stale/);
    assert.deepEqual(f.trace(), [{ type: "build" }]);
  });
  await check("a consumer writing shared outputs fails and fences later consumers", async () => {
    const f = fixture({ bodyTail: "writeFileSync('dist/index.js',readFileSync('dist/index.js'));" }), result = await f.run();
    assert.notEqual(result.exitStatus, 0);
    assert.match(result.report.stages[2].error, /conflicting writer/);
    assert.equal(result.report.stages[3].status, "skipped");
    assert.deepEqual(f.trace(), [{ type: "build" }, { type: "body", name: names[0] }]);
  });
  await check("a compiler dependency changed during a consumer fails its final freshness check", async () => {
    const f = fixture({ bodyTail: "writeFileSync('dependency.d.ts','export declare const dependency: 2;');" }), result = await f.run();
    assert.notEqual(result.exitStatus, 0);
    assert.match(result.report.stages[2].error, /Stale Hson compiler dependency/);
    assert.equal(result.report.stages[3].status, "skipped");
    assert.deepEqual(f.trace(), [{ type: "build" }, { type: "body", name: names[0] }]);
  });
  await check("original suite failure still stops subsequent execution", async () => {
    const f = fixture({ bodyTail: "process.exit(23);" }), result = await f.run();
    assert.equal(result.exitStatus, 23);
    assert.equal(result.report.stages[3].status, "skipped");
    assert.equal(result.report.rootBuildReuses, 0);
    assert.deepEqual(f.trace(), [{ type: "build" }, { type: "body", name: names[0] }]);
  });
  await check("wrapper drift is refused rather than dropping newly added coverage", async () => {
    const f = fixture(), stages = f.rows(); stages[1].command += " && node tests/new.acceptance.mts";
    const result = await f.run(stages);
    assert.notEqual(result.exitStatus, 0);
    assert.match(result.report.stages[2].error, /wrapper changed/);
    assert.deepEqual(f.trace(), [{ type: "build" }]);
  });
  console.log(JSON.stringify({ rootBuildReuse: "passed", checks, standaloneWrappers: names.length }));
} finally { rmSync(temporary, { recursive: true, force: true }); }
