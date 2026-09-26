import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { create_schema_compiler_project_watch } from "../src/internal/hson-schema/compiler-project-watch.ts";
import { SchemaProjectSnapshot } from "../src/internal/hson-schema/project-snapshot.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson-schema-compiler-watch", title: "Hson Schema immutable project watch", category: "Tooling", runtime: "node",
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
});
await check("finite project adoption preserves old files and unchanged errors stay silent", async () => {
  const quiet = mkdtempSync(join(root, "tmp/schema-watch-quiet-"));
  const emitted: string[] = [];
  const config = join(quiet, "tsconfig.json");
  writeFileSync(config, JSON.stringify({ compilerOptions: { types: [], target: "ES2022", newLine: "lf", jsx: "react-jsx" }, files: ["./source.ts"] }));
  writeFileSync(join(quiet, "source.ts"), "export const value = 1;\n");
  const watcher = create_schema_compiler_project_watch(config, () => ({ schemas: [], overlays: [], diagnostics: ["current authoring error"] }), event => emitted.push(event.state));
  try {
    const seeded = spawnSync(process.execPath, [join(root, "dist/hson-schema.mjs"), "experimental-project", "--project", config], { encoding: "utf8", timeout: 60_000 });
    assert.equal(seeded.status, 0, seeded.stdout + seeded.stderr);
    const seed = JSON.parse(seeded.stdout.trim());
    const oldSource = join(dirname(seed.manifest), "sources/source.ts");
    const oldBytes = readFileSync(oldSource);
    await watcher.poll(); await watcher.poll(); await watcher.poll();
    assert.deepEqual(emitted, ["prepared", "current"]);
    writeFileSync(join(quiet, "source.ts"), "export const value = 2;\n");
    await watcher.poll(); await watcher.poll();
    assert.deepEqual(emitted, ["prepared", "current", "prepared", "current"]);
    assert.deepEqual(readFileSync(oldSource), oldBytes);
    const refused = spawnSync(process.execPath, [join(root, "dist/hson-schema.mjs"), "experimental-project", "--project", config], { encoding: "utf8", timeout: 60_000 });
    assert.equal(refused.status, 0, refused.stderr);
  } finally { watcher.stop(); rmSync(quiet, { recursive: true, force: true }); }
});
const authored = new Map<string, Buffer>();
const immutable = new Map<string, Buffer>();
function write(path: string, text: string): void {
  const file = join(project, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); authored.set(path, Buffer.from(text));
}
function remove(path: string): void { unlinkSync(join(project, path)); authored.delete(path); }
function preserve(): void {
  for (const [path, bytes] of authored) assert.deepEqual(readFileSync(join(project, path)), bytes, path);
  for (const [path, bytes] of immutable) assert.deepEqual(readFileSync(path), bytes, `Retired revision was mutated: ${path}`);
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
import type { SchemaType, HsonData } from 'hson-live';
declare const value: SchemaType<typeof S>;
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
        for (const path of [event.manifest, ...state.files.map((file: { path: string }) => join(dirname(event.manifest), file.path))]) immutable.set(path, readFileSync(path));
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
  await check("invalidating one declaration withdraws proof locally and retains the previous immutable revision", async () => {
    const previousProject = join(dirname(current.manifest), "tsconfig.json");
    const previousBytes = readFileSync(current.manifest);
    write("schema.ts", imports + 'export const S = Hson.schema`<props <`;\n' + schema("Twin") + schema("B", "b"));
    current = await next(); assert.deepEqual(names(current), ["B", "Twin"]); assert.ok(current.diagnostics.length);
    assert.notEqual(tsc().status, 0, "The precise consumer must stop checking against the stale S proof");
    assert.deepEqual(readFileSync(join(dirname(previousProject), "manifest.json")), previousBytes); passes(previousProject); preserve();
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
  await check("source deletion removes its files from the selected revision", async () => {
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
  await check("extended configuration membership changes are observed and frozen for old readers", async () => {
    const previousProject = join(dirname(current.manifest), "tsconfig.json");
    write("excluded/added.ts", imports + schema("Added"));
    write("tsconfig.json", JSON.stringify({ extends: "./base.json" }));
    write("base.json", JSON.stringify({ ...base, include: ["./*.ts", "./excluded/*.ts"] }));
    current = await next(); assert.ok(names(current).includes("Added")); passes(); passes(previousProject); preserve();
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
    write("precision.ts", `import { Hson, type HsonData, type SchemaType } from "hson-live";
export const Refined = Hson.schema\`<type "data" content <age <number <int true min 0>>>>\`;
export const Document = Hson.schema\`<type "document">\`;
const data: HsonData<typeof Refined> = Hson.data\`<age 4>\`;
declare const value: SchemaType<typeof Refined>;
// @ts-expect-error arithmetic erases the private refinement proof
const changed: SchemaType<typeof Refined>["age"] = value.age + 1;
// @ts-expect-error wrong Schema mode
const wrong: HsonData<typeof Document> = data;
void changed; void wrong;
`);
    current = await next(); passes(); preserve();
    remove("precision.ts"); current = await next(); passes(); preserve();
  });
  await check("package scope changes are observed", async () => {
    write("package.json", '{"type":"commonjs"}'); current = await next(); passes(); preserve();
    write("package.json", '{"type":"module"}'); current = await next(); passes(); preserve();
  });
  await check("prepared obsolete generation is discarded and cannot replace the newer saved revision", async () => {
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
  await check("an unowned selector replacement causes fatal safe failure", async () => {
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
