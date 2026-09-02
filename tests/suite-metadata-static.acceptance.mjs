import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

function read_metadata(source) {
  const matches = [...source.matchAll(/export const HSON_LIVE_TEST_METADATA = Object\.freeze\((\{[\s\S]*?\})\);/g)];
  if (matches.length !== 1) throw new Error("Expected exactly one literal suite metadata object.");
  const literal = matches[0][1];
  const grammar = /^\{\s*id:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*category:\s*"([^"]+)",\s*runtime:\s*"([^"]+)",\s*tags:\s*Object\.freeze\(\[\s*(?:(?:"[^"]*"\s*,\s*)*"[^"]*"\s*)?\]\),?\s*\}$/;
  const parsed = grammar.exec(literal);
  if (parsed === null) throw new Error("Suite metadata must use the exact static literal grammar.");
  const [, id, title, category, runtime] = parsed;
  if (!id || !title || !category) throw new Error("Suite metadata requires id, title, and category.");
  if (!new Set(["node", "node-synthetic-dom", "node-real-websocket", "node-real-websocket-process"]).has(runtime)) throw new Error("Invalid suite runtime.");
  return id;
}

const valid = 'export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "one", title: "One", category: "Core", runtime: "node", tags: Object.freeze(["x"]) });';
assert.equal(read_metadata(valid), "one");
assert.throws(() => read_metadata(valid.replace('"one"', 'makeId()')), /static|requires/);
assert.throws(() => read_metadata(valid.replace('title: "One"', 'title: makeTitle()')), /static/);
assert.throws(() => read_metadata(valid + valid), /exactly one/);
assert.throws(() => read_metadata(valid.replace('id: "one", ', "")), /static|requires/);
assert.throws(() => read_metadata(valid.replace('"node"', '"browser"')), /runtime/);
assert.throws(() => read_metadata(valid.replace('Object.freeze(["x"])', '[tag]')), /static|tags/);
assert.throws(() => { const ids = [read_metadata(valid), read_metadata(valid.replace('"one"', '"one"'))]; if (new Set(ids).size !== ids.length) throw new Error("Duplicate suite ID"); }, /Duplicate/);

const repositoryRoot = resolve(import.meta.dirname, "..");
const launcherSource = await readFile(resolve(repositoryRoot, "src", "_tests", "test-launchers.ts"), "utf8");
// This comparison is migration scaffolding and can leave with the old manifest in Phase 2C.
const transitionalLaunchers = [...launcherSource.matchAll(/launcher\(\{([\s\S]*?)\}\),/g)]
  .map((match) => {
    const id = /\bid:\s*"([^"]+)"/.exec(match[1])?.[1];
    const modulePath = /\brepositoryModule:\s*"([^"]+)"/.exec(match[1])?.[1];
    assert.ok(id && modulePath, "transitional launcher blocks must expose literal IDs and modules");
    return { id, modulePath };
  });
assert.equal(new Set(transitionalLaunchers.map(({ modulePath }) => modulePath)).size, transitionalLaunchers.length);
for (const { id, modulePath } of transitionalLaunchers) {
  assert.equal(read_metadata(await readFile(resolve(repositoryRoot, modulePath), "utf8")), id);
}

async function acceptance_sources(directory) {
  const sources = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) sources.push(...await acceptance_sources(path));
    else if (entry.isFile() && /\.acceptance\.(?:mjs|mts)$/.test(entry.name)) sources.push(path);
  }
  return sources;
}

const metadataIds = [];
for (const path of await acceptance_sources(resolve(repositoryRoot, "tests"))) {
  if (path === resolve(import.meta.filename)) continue;
  const source = await readFile(path, "utf8");
  if (source.includes("export const HSON_LIVE_TEST_METADATA")) metadataIds.push(read_metadata(source));
}
assert.equal(new Set(metadataIds).size, metadataIds.length, "executable suite metadata IDs must be unique");
console.log(JSON.stringify({
  suiteMetadataStaticAcceptance: "passed",
  transitionalLaunchersChecked: transitionalLaunchers.length,
  executableMetadataObjectsChecked: metadataIds.length,
}));
