// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { livemap_document_identity_overlay_for } from "../src/api/livemap/livemap.document.identity.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-target-boundary",
  title: "Registry document target boundary",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "path", "identity", "registry", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-target-boundary");
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}
const Q1 = "000000801";
const fixture = () => element(`<main @${Q1} <section <item/>/>/>`);
const target = (...parts: number[]) => ({ kind: "path" as const, path: validate_document_path(parts) });

check("selected library requests publish named map-global operations", () => {
  const library = fixture();
  const map = registry_for_document_library(library);
  const observed: string[] = [];
  map.commits.observe((commit) => { for (const entry of commit.operations) observed.push(entry.library); });
  const commit = library.document.attrs.set(target(0), "title", "ready");
  assert.equal(commit.kind, "map");
  assert.deepEqual(observed, ["page"]);
  assert.equal(commit.operations[0]?.library, "page");
});

check("canonical operation targets contain paths rather than QUID addresses", () => {
  const library = fixture();
  const commit = library.document.attrs.set(target(0), "title", "ready");
  const operation = commit.operations[0]?.operation;
  assert.equal(operation?.op, "set-attr");
  if (operation === undefined) throw new Error("Missing path operation");
  assert.equal(operation.target.kind, "path");
  assert.deepEqual(operation.target.path, [0]);
  assert.equal(Reflect.get(operation.target, "quid"), undefined);
  assert.equal(Reflect.get(operation.target, "witness"), undefined);
});

check("nested path requests preserve their exact canonical coordinate", () => {
  const library = fixture();
  const commit = library.document.attrs.set(target(0, 0, 0, 0, 0), "nested", true);
  const operation = commit.operations[0]?.operation;
  if (operation === undefined) throw new Error("Missing path operation");
  assert.deepEqual(operation.target.path, [0, 0, 0, 0, 0]);
});

check("accepted target paths are frozen and detached from caller arrays", () => {
  const library = fixture();
  const input = [0];
  const commit = library.document.attrs.set({ kind: "path", path: input }, "x", 1);
  input[0] = 9;
  const operation = commit.operations[0]?.operation;
  if (operation === undefined) throw new Error("Missing path operation");
  assert.deepEqual(operation.target.path, [0]);
  assert.equal(Object.isFrozen(operation.target.path), true);
});

check("raw QUID target shape rejects before mutation", () => {
  const library = fixture();
  const before = library.capture();
  assert.throws(() => library.document.attrs.set({ kind: "quid", quid: Q1 } as never, "bad", true));
  assert.deepEqual(library.capture(), before);
});

check("invalid paths do not reroute through an existing QUID", () => {
  const library = fixture();
  const before = library.capture();
  assert.throws(() => library.document.attrs.set({ kind: "path", path: [99] }, "bad", true));
  assert.deepEqual(library.capture(), before);
  assert.deepEqual(livemap_document_identity_overlay_for(library.document).pathForQuid(Q1), [0]);
});

check("path requests do not mint QUID metadata in sparse gaps", () => {
  const library = fixture();
  library.document.attrs.set(target(0, 0, 0), "gap", true);
  assert.equal(livemap_document_identity_overlay_for(library.document).size, 1);
  assert.equal(JSON.stringify(library.root()).match(/"quid"/g)?.length, 1);
});

check("operation serialization is deterministic and path first", () => {
  const left = fixture();
  const right = fixture();
  const a = left.document.attrs.set(target(0), "n", 1).operations;
  const b = right.document.attrs.set(target(0), "n", 1).operations;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(a).includes('"kind":"quid"'), false);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry document target checks passed\n`);
