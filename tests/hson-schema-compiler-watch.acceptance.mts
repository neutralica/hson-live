import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { capture_schema_compiler_project, create_schema_compiler_project_watch, verify_schema_compiler_project } from "../src/internal/hson-schema/compiler-project-watch.ts";
import { check_schema_project } from "../src/internal/hson-schema/compiler-project-build.ts";
import { discover_hson_schema_declarations } from "../src/internal/hson-schema/schema-discovery.ts";
import { library_schema_attachment_plan } from "../src/internal/hson-schema/source-transformation.ts";
import { schema_tooling_fingerprint } from "../src/internal/hson-schema/tooling-fingerprint.ts";
import { SchemaProjectSnapshot } from "../src/internal/hson-schema/project-snapshot.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson-schema-compiler-watch", title: "Hson Schema current project watch", category: "Tooling", runtime: "node",
  tags: Object.freeze(["hson-schema", "typescript", "source-integrity", "watch"]),
});
const events = create_test_event_emitter("hson-schema-compiler-watch");
let checks = 0;
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  events.case_begin(name, name);
  try { await body(); events.case_end(name, "pass"); console.log(`ok ${++checks} - ${name}`); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
assert.equal(ts.version, "5.9.3");
const root = resolve(".");
mkdirSync(join(root, "tmp"), { recursive: true });
const project = mkdtempSync(join(root, "tmp/schema-compiler-watch-"));
process.once("exit", () => rmSync(project, { recursive: true, force: true }));
await check("snapshot fingerprints bind exact bytes and freshness checks never advance their baseline", () => {
  const file = join(project, "snapshot.txt");
  const original = Buffer.from("\uFEFFexport const x = 1;\r\n");
  writeFileSync(file, original);
  const snapshot = new SchemaProjectSnapshot();
  assert.equal(snapshot.readFile(file), "export const x = 1;\r\n");
  const fingerprint = snapshot.fingerprint();
  assert.ok(snapshot.isCurrent());
  writeFileSync(file, "export const x = 1;\r\n"); // Same decoded text, different authored bytes.
  assert.equal(snapshot.isCurrent(), false);
  assert.equal(snapshot.isCurrent(), false);
  assert.equal(snapshot.fingerprint(), fingerprint);
  assert.deepEqual(snapshot.readBytes(file), original);
  const newer = new SchemaProjectSnapshot(); newer.readFile(file);
  assert.notEqual(newer.fingerprint(), fingerprint);
  for (const bytes of [Buffer.from("\uFEFFconst x = '🙂';\r\n", "utf16le"), Buffer.from("\uFEFFconst x = '🙂';\r\n", "utf16le").swap16()]) {
    writeFileSync(file, bytes);
    const decoded = new SchemaProjectSnapshot();
    assert.equal(decoded.readFile(file), ts.sys.readFile(file));
    assert.deepEqual(decoded.readBytes(file), bytes);
  }
  unlinkSync(file);
  const missing = new SchemaProjectSnapshot(); missing.readFile(file);
  assert.equal(SchemaProjectSnapshot.matches(missing.records()), true);
  assert.equal(SchemaProjectSnapshot.matches(JSON.parse(JSON.stringify(missing.records()))), true);
});
await check("cross-file producer records cannot publish proof and invalidation withdraws governed read evidence", async () => {
  const directory = join(project, "producer-provenance"); mkdirSync(directory);
  const config = join(directory, "tsconfig.json");
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(config, JSON.stringify({ compilerOptions: { strict: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", types: [], declaration: true, outDir: "out", paths: {
    "hson-live": [join(root, "dist/index.d.ts")], "hson-live/hson": [join(root, "dist/hson-authoring.d.ts")],
    "hson-live/livemap": [join(root, "dist/api/livemap/index.d.ts")],
  } }, files: ["good.ts", "bad.ts", "consumer.ts"] }));
  const producer = 'import { Hson } from "hson-live";\r\nexport const S = Hson.schema`// ok\r\n<type "data" content <name "string">>`;\r\n';
  const invalid = producer.replace("// ok", "// \\8");
  const badPath = join(directory, "bad.ts"), consumerPath = join(directory, "consumer.ts");
  writeFileSync(join(directory, "good.ts"), producer); writeFileSync(badPath, invalid);
  const consumer = 'import { hsonLiveMap } from "hson-live";\r\nimport { S } from "./bad.js";\r\nconst map = hsonLiveMap.fromLibraries({ state: { data: { name: "Ada" } } });\r\nmap.data.must("state").schema.use(S);\r\nexport const name: string = map.data.must("state").at(["name"]).snap();\r\n';
  writeFileSync(consumerPath, consumer);
  const states: string[] = [];
  let fabricate = true;
  const watch = create_schema_compiler_project_watch(config, (_config, program) => {
    const checker = program.getTypeChecker();
    const good = discover_hson_schema_declarations(ts, program.getSourceFile(join(directory, "good.ts"))!, checker)[0]!;
    const bad = discover_hson_schema_declarations(ts, program.getSourceFile(badPath)!, checker)[0]!;
    assert.equal(good.eligible, true);
    assert.equal(good.declaration.getStart(), bad.declaration.getStart());
    assert.equal(good.declaration.getEnd(), bad.declaration.getEnd());
    const admitted = [good, bad].flatMap(found => found.eligible && found.source !== undefined ? [{
      sourceFile: found.sourceFile, declaration: found.declaration, name: found.name, source: found.source,
    }] : []);
    const schemas = fabricate ? [{ sourceFile: bad.sourceFile, declaration: good.declaration, name: good.name, source: good.source! }] : admitted;
    // Reproduce the original callback's downstream attachment assertion too.
    const facts = (fabricate ? [bad] : [good, bad].filter(found => found.eligible)).map(found => ({ declaration: found.declaration, mode: "data" as const }));
    const source = program.getSourceFile(consumerPath)!;
    const overlays = library_schema_attachment_plan(source, checker, facts).edits.map(edit => ({ file: source.fileName, ...edit }));
    return { schemas, overlays, diagnostics: fabricate || bad.eligible ? [] : [bad.admissionError!] };
  }, event => states.push(event.state));
  const output = join(directory, ".hson/compiler-input/tsconfig.json");
  const manifestPath = join(output, "manifest.json");
  const assertUnproven = (): void => {
    const current = capture_schema_compiler_project(config);
    assert.deepEqual(current.manifest.sources.find(source => source.source === "bad.ts")!.schemas, []);
    assert.equal([...current.files.keys()].some(file => file.includes("/evidence/bad.ts/")), false);
    assert.doesNotMatch(current.files.get(join(output, "sources/bad.ts"))!.toString(), /as unknown as __HsonSchema/);
    assert.doesNotMatch(current.files.get(join(output, "sources/consumer.ts"))!.toString(), /__hson_assert_library_schema/);
    assert.throws(() => verify_schema_compiler_project(config), /invalid Hson tagged template/);
    for (const emit of [false, true]) assert.throws(() => check_schema_project(config, current, emit), /not assignable to type 'string'/);
    assert.equal(existsSync(join(directory, "out/consumer.d.ts")), false);
  };
  try {
    await assert.rejects(watch.poll(), /not eligible for generated proof/);
    assert.deepEqual(states, []);
    assert.equal(existsSync(manifestPath), false);
    assert.throws(() => verify_schema_compiler_project(config), /Missing generated Hson project/);
    assert.equal(existsSync(join(directory, "out")), false);
    fabricate = false; await watch.poll(); assertUnproven();
    writeFileSync(badPath, producer); await watch.poll();
    const corrected = verify_schema_compiler_project(config);
    assert.equal(corrected.manifest.sources.flatMap(source => source.schemas).length, 2);
    assert.match(corrected.files.get(join(output, "sources/consumer.ts"))!.toString(), /__hson_assert_library_schema\(map, "state", S\)/);
    check_schema_project(config, corrected, false); check_schema_project(config, corrected, true);
    assert.match(readFileSync(join(directory, "out/consumer.d.ts"), "utf8"), /name: string/);
    rmSync(join(directory, "out"), { recursive: true });
    writeFileSync(consumerPath, consumer + 'const wrong: number = map.data.must("state").at(["name"]).snap();\r\n'); await watch.poll();
    assert.throws(() => check_schema_project(config, verify_schema_compiler_project(config), false), /Type 'string' is not assignable to type 'number'/);
    writeFileSync(consumerPath, consumer); await watch.poll();
    const priorManifest = readFileSync(manifestPath), priorStates = states.length;
    writeFileSync(badPath, invalid);
    assert.throws(() => verify_schema_compiler_project(config), /Stale generated Hson project/);
    fabricate = true; await assert.rejects(watch.poll(), /not eligible for generated proof/);
    assert.equal(states.length, priorStates);
    assert.deepEqual(readFileSync(manifestPath), priorManifest);
    assert.throws(() => verify_schema_compiler_project(config), /Stale generated Hson project/);
    fabricate = false; await watch.poll(); assertUnproven();
  } finally { watch.stop(); }
});
await check("unchanged invalid state is reused across watcher startup", async () => {
  const quiet = mkdtempSync(join(root, "tmp/schema-watch-quiet-"));
  const emitted: string[] = [];
  const config = join(quiet, "tsconfig.json");
  writeFileSync(config, JSON.stringify({ compilerOptions: { types: [], target: "ES2022", newLine: "lf", jsx: "react-jsx" }, files: ["./source.ts"] }));
  writeFileSync(join(quiet, "source.ts"), "export const value = 1;\n");
  const watcher = create_schema_compiler_project_watch(config, () => ({ schemas: [], overlays: [], diagnostics: ["current authoring error"] }), event => emitted.push(event.state));
  try {
    await watcher.poll(); await watcher.poll(); await watcher.poll();
    assert.deepEqual(emitted, ["prepared", "current"]);
    writeFileSync(join(quiet, "source.ts"), "export const value = 2;\n");
    await watcher.poll(); await watcher.poll();
    assert.deepEqual(emitted, ["prepared", "current", "prepared", "current"]);
    const currentManifest = join(quiet, ".hson/compiler-input/tsconfig.json/manifest.json");
    const currentBytes = readFileSync(currentManifest);
    const restarted = create_schema_compiler_project_watch(config, () => { throw new Error("unchanged invalid source must be reused"); }, event => emitted.push(event.state));
    try { await restarted.poll(); await restarted.poll(); } finally { restarted.stop(); }
    assert.equal(emitted.at(-1), "current");
    assert.deepEqual(readFileSync(currentManifest), currentBytes);
    const refused = spawnSync(process.execPath, [join(root, "dist/hson-schema.mjs"), "generate", "--project", config], { encoding: "utf8", timeout: 60_000 });
    assert.notEqual(refused.status, 0); // Reused invalid diagnostics remain honest.
  } finally { watcher.stop(); rmSync(quiet, { recursive: true, force: true }); }
});
await check("interrupted replacement cannot be verified or reused as current proof", async () => {
  const directory = mkdtempSync(join(root, "tmp/schema-interrupted-"));
  const config = join(directory, "tsconfig.json"), source = join(directory, "source.ts");
  writeFileSync(config, JSON.stringify({ compilerOptions: { types: [] }, files: ["source.ts"] }));
  writeFileSync(source, "export const value = 1;");
  const analyze = () => ({ schemas: [], overlays: [], diagnostics: [] });
  const first = create_schema_compiler_project_watch(config, analyze, () => {});
  const interrupted = create_schema_compiler_project_watch(config, analyze, () => {}, undefined, () => { throw new Error("simulated interruption"); });
  try {
    await first.poll(); first.stop();
    writeFileSync(source, "export const value = 2;");
    await assert.rejects(interrupted.poll(), /simulated interruption/);
    assert.throws(() => verify_schema_compiler_project(config), /incomplete or in progress/);
    const restarted = create_schema_compiler_project_watch(config, analyze, () => {});
    try { await assert.rejects(restarted.poll(), /incomplete or in progress/); } finally { restarted.stop(); }
    assert.equal(readFileSync(source, "utf8"), "export const value = 2;");
  } finally { first.stop(); interrupted.stop(); rmSync(directory, { recursive: true, force: true }); }
});
await check("unchanged valid watch restarts reuse exactly the same publication", async () => {
  const directory = mkdtempSync(join(root, "tmp/schema-restart-"));
  const config = join(directory, "tsconfig.json");
  writeFileSync(config, JSON.stringify({ compilerOptions: { types: [] }, files: ["source.ts"] }));
  writeFileSync(join(directory, "source.ts"), "export const value = 1;");
  let analyses = 0;
  const analyze = () => { analyses++; return { schemas: [], overlays: [], diagnostics: [] }; };
  try {
    let publication: string | undefined;
    for (let index = 0; index < 3; index++) {
      const events: string[] = [];
      const watch = create_schema_compiler_project_watch(config, analyze, event => events.push(event.state));
      try { await watch.poll(); await watch.poll(); } finally { watch.stop(); }
      const state = verify_schema_compiler_project(config);
      if (publication !== undefined) { assert.equal(state.manifest.publication, publication); assert.deepEqual(events, ["current"]); }
      publication = state.manifest.publication;
      assert.equal(existsSync(join(state.selected, "revisions")), false);
    }
    assert.equal(analyses, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
await check("tooling identity follows transitive implementation, build inputs and external TypeScript", () => {
  const tooling = join(project, "tooling");
  mkdirSync(join(tooling, "scripts"), { recursive: true });
  cpSync(join(root, "src"), join(tooling, "src"), { recursive: true });
  cpSync(join(root, "dist"), join(tooling, "dist"), { recursive: true });
  for (const file of ["scripts/hson-schema.mts", "scripts/build-hson-schema-cli.mjs", "tsconfig.json"]) cpSync(join(root, file), join(tooling, file));
  const current = schema_tooling_fingerprint(tooling);
  assert.equal(current, schema_tooling_fingerprint(root), "installation path does not affect identity");
  assert.equal(current, schema_tooling_fingerprint(tooling));
  for (const file of ["src/internal/hson-schema/compiler.ts", "src/internal/canonical-schema/verify.ts", "dist/internal/hson-schema/compiler.js", "scripts/hson-schema.mts", "scripts/build-hson-schema-cli.mjs", "tsconfig.json"]) {
    const path = join(tooling, file), before = readFileSync(path);
    writeFileSync(path, Buffer.concat([before, Buffer.from("\n// tooling edit\n")]));
    assert.notEqual(schema_tooling_fingerprint(tooling), current, file);
    writeFileSync(path, before);
  }
  writeFileSync(join(tooling, "unrelated.txt"), "not a tooling dependency");
  assert.equal(schema_tooling_fingerprint(tooling), current);
  assert.notEqual(schema_tooling_fingerprint(tooling, `${ts.version}-different`), current);
});
await check("tooling edits withdraw a prepared watch publication and require restart", async () => {
  const tooling = join(project, "tooling");
  const modulePath = join(tooling, "src/internal/hson-schema/compiler-project-watch.ts");
  const { create_schema_compiler_project_watch: createWatch, verify_schema_compiler_project: verifyProject } = await import(modulePath);
  const directory = join(project, "tooling-watch"); mkdirSync(directory);
  const config = join(directory, "tsconfig.json");
  writeFileSync(config, JSON.stringify({ compilerOptions: { types: [] }, files: ["source.ts"] }));
  writeFileSync(join(directory, "source.ts"), "export const value = 1;");
  const implementation = join(tooling, "src/internal/hson-schema/compiler.ts");
  const before = readFileSync(implementation), states: string[] = [];
  const watcher = createWatch(config, () => ({ schemas: [], overlays: [], diagnostics: [] }), (event: { state: string }) => states.push(event.state), async () => {
    writeFileSync(implementation, Buffer.concat([before, Buffer.from("\n// changed tooling\n")]));
  });
  try {
    await watcher.poll(); assert.deepEqual(states, ["prepared", "discarded"]);
    assert.equal(existsSync(join(directory, ".hson/compiler-input/tsconfig.json/manifest.json")), false);
    await assert.rejects(watcher.poll(), /tooling changed while running.*Restart/);
    const generated = spawnSync(process.execPath, ["--import=tsx", join(tooling, "scripts/hson-schema.mts"), "generate", "--project", config], { encoding: "utf8", timeout: 60_000 });
    assert.equal(generated.status, 0, generated.stdout + generated.stderr);
    const manifest = JSON.parse(readFileSync(join(directory, ".hson/compiler-input/tsconfig.json/manifest.json"), "utf8"));
    assert.equal(manifest.toolingFingerprint, schema_tooling_fingerprint(tooling));
    assert.throws(() => verifyProject(config), /tooling changed while running.*Restart/);
  } finally { watcher.stop(); writeFileSync(implementation, before); }
});
await check("stale tooling and external TypeScript identities require ordinary regeneration", async () => {
  const directory = join(project, "freshness"); mkdirSync(directory);
  const config = join(directory, "tsconfig.json");
  writeFileSync(config, JSON.stringify({ compilerOptions: { types: [] }, files: ["source.ts"] }));
  writeFileSync(join(directory, "source.ts"), "export const value = 1;");
  let analyses = 0;
  const watch = create_schema_compiler_project_watch(config, () => { analyses++; return { schemas: [], overlays: [], diagnostics: [] }; }, () => {});
  const path = join(directory, ".hson/compiler-input/tsconfig.json/manifest.json");
  const edit = (field: string, value: string): void => {
    const { contentDigest: _digest, ...contents } = JSON.parse(readFileSync(path, "utf8"));
    contents[field] = value;
    writeFileSync(path, JSON.stringify({ ...contents, contentDigest: createHash("sha256").update(JSON.stringify(contents)).digest("hex") }));
  };
  try {
    await watch.poll(); await watch.poll(); assert.equal(analyses, 1);
    for (const identity of [createHash("sha256").update("different tooling contents").digest("hex"), schema_tooling_fingerprint(root, `${ts.version}-different`)]) {
      edit("toolingFingerprint", identity);
      assert.throws(() => verify_schema_compiler_project(config), /Stale Hson compiler tooling/);
      await watch.poll(); assert.equal(verify_schema_compiler_project(config).manifest.toolingFingerprint, schema_tooling_fingerprint());
    }
    assert.equal(analyses, 3);
    const original = readFileSync(path);
    edit("owner", "unowned-project");
    await assert.rejects(watch.poll(), /ownership/);
    assert.notDeepEqual(readFileSync(path), original);
    writeFileSync(path, original);
    const source = join(directory, ".hson/compiler-input/tsconfig.json/sources/source.ts");
    const before = readFileSync(source); writeFileSync(source, "user edit");
    await assert.rejects(watch.poll(), /Unowned\/edited/);
    assert.equal(readFileSync(source, "utf8"), "user edit");
    writeFileSync(source, before); await watch.poll(); assert.equal(analyses, 3);
  } finally { watch.stop(); }
});
const authored = new Map<string, Buffer>();
function write(path: string, text: string): void {
  const file = join(project, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); authored.set(path, Buffer.from(text));
}
function remove(path: string): void { unlinkSync(join(project, path)); authored.delete(path); }
function preserve(): void {
  for (const [path, bytes] of authored) assert.deepEqual(readFileSync(join(project, path)), bytes, path);
  assert.equal(existsSync(join(output, "revisions")), false);
}
const schema = (name: string, value = "a") => `export const ${name} = Hson.schema\`<type "data" content <value <exact "${value}">>>\`;\n`;
const imports = 'import { Hson } from "hson-live";\r\n';
const valid = () => imports + schema("S") + schema("Twin") + schema("B", "b");
const base = { compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
  target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", types: [], baseUrl: ".",
  paths: { "hson-live": [join(root, "dist/index.d.ts")], "hson-live/hson": [join(root, "dist/hson-authoring.d.ts")] } } };
write("base.json", JSON.stringify(base));
write("tsconfig.json", JSON.stringify({ extends: "./base.json", include: ["./*.ts", "./moved/*.ts"] }));
write("package.json", '{"type":"module"}\n');
write("schema.ts", imports + 'export const S = Hson.schema`<props <');
write("consumer.ts", `import { S, Twin } from './schema.js';
import type { JsonFromSchema, HsonData } from 'hson-live';
declare const value: JsonFromSchema<typeof S>;
const exact: 'a' = value.value;
// @ts-expect-error exact Schema value
const wrong: 'b' = value.value;
declare const first: HsonData<typeof S>;
// @ts-expect-error nominal identities remain separate even with identical content
const second: HsonData<typeof Twin> = first;
void exact; void wrong; void second;
`);
const output = join(project, ".hson/compiler-input/tsconfig.json");
const selector = join(output, "tsconfig.json");
type Event = { state: string; revision: string; project: string; manifest: string; diagnostics: string[]; schemas: number };
let beforePublish: ((event: Event) => void) | undefined;
let stderr = "";
const child = spawn(process.execPath, [join(root, "dist/hson-schema.mjs"), "watch", "--project", join(project, "tsconfig.json")], {
  cwd: root, env: { ...process.env, HSON_SCHEMA_WATCH_TEST_BARRIER: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"],
});
assert.ok(child.stdout && child.stderr);
const received: Event[] = [];
let wake: (() => void) | undefined;
let lines = "";
child.stdout.on("data", (chunk: Buffer) => {
  lines += chunk.toString();
  while (lines.includes("\n")) { const end = lines.indexOf("\n"); const line = lines.slice(0, end); lines = lines.slice(end + 1);
    if (line.startsWith('{')) { received.push(JSON.parse(line)); wake?.(); }
  }
});
child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
child.on("exit", () => wake?.());
child.on("message", message => {
  try { beforePublish?.(message as Event); child.send({ proceed: true }); }
  catch (error) { stderr += String(error); child.kill("SIGTERM"); child.send({ proceed: true }); }
});
async function next(state = "current"): Promise<Event> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const index = received.findIndex(event => event.state === state);
    if (index >= 0) {
      const event = received.splice(index, 1)[0]!;
      if (event.state === "current") {
        const state = JSON.parse(readFileSync(event.manifest, "utf8"));
        assert.equal(state.revision, event.revision);

      }
      return event;
    }
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Watcher exited: ${stderr}`);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timed out waiting for ${state}: ${stderr}`);
    await new Promise<void>(accept => { const timer = setTimeout(accept, remaining); wake = () => { clearTimeout(timer); wake = undefined; accept(); }; });
  }
}
function manifest(event: Event) { return JSON.parse(readFileSync(event.manifest, "utf8")); }
function names(event: Event): string[] { return manifest(event).sources.flatMap((source: { schemas: { name: string }[] }) => source.schemas.map(schema => schema.name)).sort(); }
function tsc(path = selector): ReturnType<typeof spawnSync> { return spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", path, "--pretty", "false"], { encoding: "utf8", timeout: 60_000 }); }
function passes(path = selector): void { const result = tsc(path); assert.equal(result.status, 0, String(result.stdout) + String(result.stderr)); }
let current: Event;
try {
  await check("initially unterminated Schema publishes unproved current state and stays alive", async () => {
    current = await next(); assert.equal(current.schemas, 0); assert.ok(current.diagnostics.length); preserve();
  });
  await check("repairing that same file restores precise stock TypeScript value and nominal identity", async () => {
    write("schema.ts", valid()); current = await next(); assert.deepEqual(names(current), ["B", "S", "Twin"], JSON.stringify(current)); passes(); preserve();
  });
  await check("invalidating one declaration removes stale proof while preserving independent evidence", async () => {
    write("schema.ts", imports + 'export const S = Hson.schema`<props <`;\n' + schema("Twin") + schema("B", "b"));
    current = await next(); assert.deepEqual(names(current), ["B", "Twin"]); assert.ok(current.diagnostics.length);
    assert.notEqual(tsc().status, 0, "The precise consumer must stop checking against the stale S proof");
    assert.equal(existsSync(join(output, "evidence/schema.ts/S.hson-schema.generated.ts")), false); preserve();
  });
  await check("repair restores proof without restart", async () => { write("schema.ts", valid()); current = await next(); passes(); preserve(); });
  await check("new included source is discovered without touching known sources", async () => {
    write("new.ts", imports + schema("New")); current = await next(); assert.ok(names(current).includes("New")); passes(); preserve();
  });
  await check("moving a source retires its old generated paths and selects only the new identity", async () => {
    mkdirSync(join(project, "moved")); renameSync(join(project, "new.ts"), join(project, "moved/new.ts"));
    authored.set("moved/new.ts", authored.get("new.ts")!); authored.delete("new.ts");
    current = await next(); const state = manifest(current);
    assert.ok(!state.files.some((file: { path: string }) => file.path.startsWith("evidence/new.ts/") || file.path === "sources/new.ts"));
    assert.ok(state.files.some((file: { path: string }) => file.path.startsWith("evidence/moved/new.ts/"))); passes(); preserve();
  });
  await check("source deletion removes its files from the current publication", async () => {
    remove("moved/new.ts"); current = await next(); assert.ok(!names(current).includes("New")); passes(); preserve();
  });
  await check("independent export rename and removal reconcile evidence", async () => {
    write("schema.ts", imports + schema("S") + schema("Twin") + schema("Renamed", "b")); current = await next(); assert.deepEqual(names(current), ["Renamed", "S", "Twin"]);
    write("schema.ts", imports + schema("S") + schema("Twin")); current = await next(); assert.deepEqual(names(current), ["S", "Twin"]); passes(); preserve();
  });
  await check("a duplicate name during editing withdraws only the ambiguous declarations", async () => {
    write("schema.ts", imports + schema("S") + schema("S", "changed") + schema("Twin"));
    current = await next(); assert.deepEqual(names(current), ["Twin"]); assert.ok(current.diagnostics.length); preserve();
    write("schema.ts", imports + schema("S") + schema("Twin")); current = await next(); passes(); preserve();
  });
  await check("extended configuration membership changes replace current inputs", async () => {
    write("excluded/added.ts", imports + schema("Added"));
    write("tsconfig.json", JSON.stringify({ extends: "./base.json" }));
    write("base.json", JSON.stringify({ ...base, include: ["./*.ts", "./excluded/*.ts"] }));
    current = await next(); assert.ok(names(current).includes("Added")); passes(); preserve();
    write("base.json", JSON.stringify({ ...base, include: ["./*.ts"] })); current = await next(); assert.ok(!names(current).includes("Added")); passes(); preserve();
  });
  await check("broken config withdraws proof and editing only that config recovers", async () => {
    write("base.json", '{"compilerOptions":'); current = await next(); assert.ok(current.diagnostics.length); assert.equal(current.schemas, 0);
    write("base.json", JSON.stringify({ ...base, include: ["./*.ts"] })); current = await next(); passes(); preserve();
  });
  await check("failed import lookups recover when a dependency outside the include glob is created", async () => {
    write("importer.ts", 'export { value } from "./deps/later.js";\n');
    current = await next(); assert.ok(current.diagnostics.some(message => message.includes("later")));
    write("deps/later.ts", 'export const value = 42;\n');
    current = await next(); assert.ok(!current.diagnostics.length); passes(); preserve();
    remove("importer.ts"); remove("deps/later.ts"); current = await next(); passes(); preserve();
  });
  await check("empty membership selects a current empty project and recovers on config repair", async () => {
    write("base.json", JSON.stringify({ ...base, include: ["./not-yet-created/*.ts"] }));
    current = await next(); assert.equal(current.schemas, 0); assert.ok(current.diagnostics.length); passes(); preserve();
    write("base.json", JSON.stringify({ ...base, include: ["./*.ts"] })); current = await next(); passes(); preserve();
  });
  await check("static proof overlays, document mode and refinement evidence share the existing compiler", async () => {
    write("precision.ts", `import { Hson, type HsonAuthored, type HsonData, type HsonDocument, type JsonFromSchema } from "hson-live";
export const Refined = Hson.schema\`<type "data" content <age <number <int true min 0>>>>\`;
export const Document = Hson.schema\`<type "document">\`;
export const Text = Hson.schema\`<type "document" content "string">\`;
const authoredText: HsonAuthored = Hson.document\`"hello"\`;
const text: HsonDocument<typeof Text> = Text.certify(authoredText);
Text.certify(text);
const data: HsonData<typeof Refined> = Hson.data\`<age 4>\`;
declare const value: JsonFromSchema<typeof Refined>;
const changed: JsonFromSchema<typeof Refined>["age"] = value.age + 1;
// @ts-expect-error wrong Schema mode
const wrong: HsonData<typeof Document> = data;
void changed; void wrong;
`);
    current = await next();
    assert.equal(current.diagnostics.length, 1);
    assert.match(current.diagnostics[0]!, /precision\.ts:\d+:\d+: Schema mode does not match HsonData\./);
    passes(); preserve();
    remove("precision.ts"); current = await next(); passes(); preserve();
  });
  await check("direct certification failures publish authored locations and recover in the next watch publication", async () => {
    const candidate = (value: string) => `${imports}import { S } from "./schema.js"; import type { HsonData } from "hson-live";\nconst page: HsonData<typeof S> = Hson.data\`<value "${value}">\`;\nS.certify(page); S.certify(page);\n`;
    write("candidate.ts", candidate("wrong"));
    current = await next();
    assert.equal(current.diagnostics.length, 1);
    assert.match(current.diagnostics[0]!, /candidate\.ts:3:\d+: Static Hson does not satisfy S/);
    assert.match(current.diagnostics[0]!, /expected.*a.*received.*wrong/);
    assert.deepEqual(manifest(current).diagnostics, current.diagnostics);
    preserve();
    write("candidate.ts", candidate("a"));
    current = await next(); assert.deepEqual(current.diagnostics, []); passes(); preserve();
    const previousSchema = readFileSync(join(project, "schema.ts"), "utf8");
    write("schema.ts", imports + schema("S", "changed") + schema("Twin") + schema("B", "b"));
    current = await next(); assert.equal(current.diagnostics.length, 1);
    assert.match(current.diagnostics[0]!, /expected.*changed.*received.*a/);
    write("schema.ts", previousSchema);
    current = await next(); assert.deepEqual(current.diagnostics, []); passes(); preserve();
    remove("candidate.ts"); current = await next(); passes(); preserve();
  });
  await check("package scope changes are observed", async () => {
    write("package.json", '{"type":"commonjs"}'); current = await next(); passes(); preserve();
    write("package.json", '{"type":"module"}'); current = await next(); passes(); preserve();
  });
  await check("prepared obsolete publication is discarded and cannot replace the newer saved revision", async () => {
    const oldSelector = readFileSync(selector, "utf8");
    let staleManifest: string | undefined;
    beforePublish = event => {
      beforePublish = undefined; staleManifest = event.manifest;
      writeFileSync(join(dirname(event.manifest), "unowned-note.txt"), "keep me");
      assert.equal(readFileSync(selector, "utf8"), oldSelector); write("schema.ts", valid());
    };
    write("schema.ts", imports + 'export const S = Hson.schema`<props <`;\n' + schema("Twin"));
    await next("discarded"); current = await next(); assert.deepEqual(names(current), ["B", "S", "Twin"], JSON.stringify(current));
    assert.ok(staleManifest && !existsSync(staleManifest));
    assert.equal(readFileSync(join(dirname(staleManifest), "unowned-note.txt"), "utf8"), "keep me"); passes(); preserve();
  });
  await check("unowned neighbors are preserved across publication", async () => {
    writeFileSync(join(output, "keep.txt"), "user owned");
    write("schema.ts", valid() + "// saved change\n"); current = await next(); assert.equal(readFileSync(join(output, "keep.txt"), "utf8"), "user owned"); preserve();
  });
  await check("an edited generated config causes fatal safe failure", async () => {
    writeFileSync(selector, '{"files":[]}\n');
    write("schema.ts", valid() + "// next saved change\n");
    await new Promise<void>((accept, reject) => {
      const timer = setTimeout(() => reject(new Error("Watcher failed to terminate on ownership conflict")), 60_000);
      child.once("exit", () => { clearTimeout(timer); accept(); });
    });
    assert.notEqual(child.exitCode, 0); assert.match(stderr, /ownership|unowned|manifest/i);
    assert.equal(readFileSync(selector, "utf8"), '{"files":[]}\n'); assert.equal(readFileSync(join(output, "keep.txt"), "utf8"), "user owned"); preserve();
  });
  events.terminal("pass");
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM"); if (child.connected) child.send({ proceed: true });
    await new Promise<void>(accept => { const timer = setTimeout(() => child.kill("SIGKILL"), 3000); child.once("exit", () => { clearTimeout(timer); accept(); }); });
  }
  rmSync(project, { recursive: true, force: true });
}
