import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { readMetadata } from "../scripts/validation-inventory.mjs";
function read_metadata(source) {
  const metadata = readMetadata(source);
  if (!metadata) throw new Error("Expected exactly one literal suite metadata object.");
  return metadata.id;
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
async function acceptance_sources(directory) {
  const sources = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "historical") sources.push(...await acceptance_sources(path));
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
  executableMetadataObjectsChecked: metadataIds.length,
}));
