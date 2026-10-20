import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parts_member_cases, parts_member_echo_cases } from "./fixtures/parts-members-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "parts-members", title: "Direct governed Parts member selection", category: "LiveMap", runtime: "node",
  tags: Object.freeze(["public-api", "libraries", "typescript", "declarations", "worker", "authority"]),
});

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "hson-parts-members-"));
try {
  const compiler = join(root, "node_modules/typescript/bin/tsc");
  execFileSync(process.execPath, [compiler, "-p", join(root, "tsconfig.json"), "--outDir", join(temporary, "dist"),
    "--declarationMap", "false", "--sourceMap", "false"], { stdio: "inherit" });
  cpSync(join(root, "package.json"), join(temporary, "package.json"));
  cpSync(join(root, "tests/parts-members.types.ts"), join(temporary, "consumer.ts"));
  symlinkSync(join(root, "node_modules"), join(temporary, "node_modules"), "dir");
  for (const exact of ["false", "true"]) {
    execFileSync(process.execPath, [compiler, "--noEmit", "--strict", "--noUncheckedIndexedAccess",
      "--noPropertyAccessFromIndexSignature", "--target", "ESNext", "--module", "NodeNext",
      "--exactOptionalPropertyTypes", exact, join(temporary, "consumer.ts")], { stdio: "inherit" });
  }
  const editorFile = join(temporary, "editor.ts");
  const source = `import { hsonLiveMap } from "hson-live/livemap";
const loc = hsonLiveMap.locus.create({ components: { parts: {
  heading: { kind: "document", document: "<h1/>" }, submit: { kind: "document", document: "<button/>" }
} } });
loc.parts.components.`;
  writeFileSync(editorFile, source);
  const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
    noUncheckedIndexedAccess: true, noPropertyAccessFromIndexSignature: true };
  const service = ts.createLanguageService({
    getCompilationSettings: () => options, getScriptFileNames: () => [editorFile], getScriptVersion: () => "0",
    getScriptSnapshot: file => ts.sys.fileExists(file) ? ts.ScriptSnapshot.fromString(readFileSync(file, "utf8")) : undefined,
    getCurrentDirectory: () => temporary, getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
  });
  try {
    const names = service.getCompletionsAtPosition(editorFile, source.length, {})?.entries.map(entry => entry.name);
    for (const name of ["heading", "submit", "at", "snap", "schema"]) assert.ok(names?.includes(name), name);
    for (const name of ["render", "members", "parts", "unknown"]) assert.equal(names?.includes(name), false, name);
  } finally { service.dispose(); }
  // Verify actual package exports and one shared runtime through separately emitted entrypoints.
  writeFileSync(join(temporary, "runtime.mjs"), `
import assert from 'node:assert/strict';
import { hsonLiveMap as root } from 'hson-live';
import { hsonLiveMap } from 'hson-live/livemap';
assert.equal(root, hsonLiveMap);
const map = hsonLiveMap.fromLibraries({components: {parts: {submit: {kind: 'document', document: '<button/>'}}}});
assert.equal(map.parts.components.submit.snap().document, '<button/>');
assert.equal('render' in map.parts.components.submit, false);
const loc = hsonLiveMap.locus.create({components: {parts: {submit: {kind: 'document', document: '<button/>'}}}});
await loc.parts.components.submit.set({document: '<button "Updated"/>'});
assert.equal(loc.parts.components.submit.snap().document, '<button "Updated"/>');
loc.dispose();
`);
  execFileSync(process.execPath, [join(temporary, "runtime.mjs")], { stdio: "inherit" });
} finally { rmSync(temporary, { recursive: true, force: true }); }
await parts_member_cases();
await parts_member_echo_cases();
const worker = repository_typescript_worker(new URL("./fixtures/parts-members.worker.mts", import.meta.url));
try {
  assert.deepEqual(await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => reject(Error(`Worker exited ${code}`)));
  }), { passed: true, isMainThread: false, hasDocument: false });
} finally { await worker.terminate(); }
console.log("Parts members: strict emitted package declarations (both optional modes), completions, entrypoints, Node and Worker passed.");
