// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, projected_element } from "./helpers/mirror-unit6.mts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { livemap_document_identity_overlay_for } from "../src/api/livemap/livemap.document.identity.ts";
import type { LiveMapGraphOp, LiveMapDocumentLibrary } from "../src/types/livemap.types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-request-lowering",
  title: "Registry document request lowering",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "path", "request", "identity", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.document-request-lowering");
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
const Q1 = "000000701";
const fixture = () => element(`<main <item @${Q1}/> <item/>/>`);
const target = (...parts: number[]) => ({ kind: "path" as const, path: validate_document_path(parts) });
const op = (map: LiveMapDocumentLibrary, mutate: () => { operations: readonly { operation: LiveMapGraphOp }[] }): LiveMapGraphOp => {
  const entry = mutate().operations[0];
  if (entry === undefined) throw new Error("Missing document operation");
  return entry.operation;
};

check("attribute requests lower to canonical path targets", () => {
  const map = fixture();
  const operation = op(map, () => map.document.attrs.set(target(0, 0, 0), "title", "ready"));
  assert.equal(operation.op, "set-attr");
  assert.deepEqual(operation.target.path, [0, 0, 0]);
  assert.equal(operation.target.kind, "path");
});

check("request path arrays are detached from caller mutation", () => {
  const map = fixture();
  const input = [0, 0, 0];
  const operation = op(map, () => map.document.attrs.set({ kind: "path", path: input }, "n", 1));
  input[2] = 99;
  if (operation.op === "replace-root") throw new Error("Expected path target");
  assert.deepEqual(operation.target.path, [0, 0, 0]);
  assert.equal(Object.isFrozen(operation.target.path), true);
});

check("raw-QUID request targets reject without a commit", () => {
  const map = fixture();
  const before = map.capture();
  assert.throws(() => map.document.attrs.set({ kind: "quid", quid: Q1 } as never, "x", 1));
  assert.deepEqual(map.capture(), before);
});

check("malformed paths reject at request admission", () => {
  const map = fixture();
  const before = map.rev;
  assert.throws(() => map.document.attrs.set({ kind: "path", path: [-1] }, "bad", true));
  assert.equal(map.rev, before);
});

check("identified nodes still use paths without implicit witnesses", () => {
  const map = fixture();
  const operation = op(map, () => map.document.attrs.set(target(0, 0, 0), "id", "x"));
  if (operation.op === "replace-root") throw new Error("Expected path target");
  assert.equal(Reflect.get(operation.target, "witness"), undefined);
  assert.deepEqual(livemap_document_identity_overlay_for(map.document).pathForQuid(Q1), [0, 0, 0]);
});

check("attribute request family emits path-only operations", () => {
  const map = fixture();
  const operations = [
    op(map, () => map.document.attrs.set(target(0), "a", 1)),
    op(map, () => map.document.attrs.setMany(target(0), { b: 2 })),
    op(map, () => map.document.attrs.drop(target(0), "a")),
    op(map, () => map.document.attrs.clear(target(0))),
  ];
  assert.ok(operations.every((operation) => operation.op !== "replace-root" && operation.target.kind === "path"));
});

check("content request family emits path-only operations", () => {
  const map = fixture();
  const operations = [
    op(map, () => map.document.content.insert(target(0, 0), 1, projected_element('<item/>'))),
    op(map, () => map.document.content.move(target(0, 0), 0, 1)),
    op(map, () => map.document.content.replace(target(0, 0), 0, projected_element('<item title="new"/>'))),
    op(map, () => map.document.content.remove(target(0, 0), 0)),
  ];
  assert.ok(operations.every((operation) => operation.op !== "replace-root" && operation.target.kind === "path"));
});

check("read-only QUID lookup returns detached diagnostic material", () => {
  const map = fixture();
  const value = map.document.byQuid(Q1);
  if (value === undefined) throw new Error("Missing test identity");
  value.$_tag = "changed";
  assert.equal(map.document.byQuid(Q1)?.$_tag, "item");
  assert.equal(map.rev, 0);
});

check("absent or malformed QUID lookups remain inert", () => {
  const map = fixture();
  assert.equal(map.document.byQuid("absent"), undefined);
  assert.equal(map.document.byQuid("000000999"), undefined);
  assert.equal(map.rev, 0);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry document request checks passed\n`);
