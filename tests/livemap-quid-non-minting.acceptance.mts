// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, path, projected_element, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import { decode_view_state_snapshot, encode_view_state_snapshot } from "../src/api/livemap/livemap.document.view-state-codec.ts";
import type { HsonNode } from "../src/core/types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.quid-non-minting",
  title: "Registry document sparse QUID non-minting",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "sparse-identity", "non-minting", "externally-discoverable"]),
});
const events = create_test_event_emitter("livemap.quid-non-minting");
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
const Q1 = "000000qb1";
const Q2 = "000000qb2";
const plain = () => element('<main <item/> <item/> <item/>/>');
const sparse = () => element(`<main @${Q1} <item/> <item @${Q2}/> <item/>/>`);
function quids(root: HsonNode): string[] {
  const found: string[] = [];
  const walk = (node: HsonNode): void => {
    if (node.$_meta?.quid !== undefined) found.push(node.$_meta.quid);
    for (const child of node.$_content) if (typeof child === "object" && child !== null) walk(child);
  };
  walk(root);
  return found;
}

check("construction and read traversal do not mint QUIDs", () => {
  const map = plain();
  map.root();
  map.document.root();
  map.document.content();
  map.at([0]).snap();
  map.document.attrs.keys(path());
  assert.deepEqual(quids(map.root()), []);
});

check("missing and malformed QUID lookups do not mint", () => {
  const map = plain();
  assert.equal(map.document.byQuid("bad"), undefined);
  assert.equal(map.document.byQuid(Q1), undefined);
  assert.deepEqual(quids(map.root()), []);
});

check("attribute mutation does not mint document identity", () => {
  const map = plain();
  map.document.attrs.set(path(), "title", "ready");
  map.document.attrs.drop(path(), "title");
  assert.deepEqual(quids(map.root()), []);
});

check("content insertion and replacement keep incoming nodes QUID-free", () => {
  const map = plain();
  map.document.content.insert(path(0), 1, projected_element('<item/>'));
  map.document.content.replace(path(0), 0, projected_element('<item title="new"/>'));
  assert.deepEqual(quids(map.root()), []);
});

check("content movement and deletion do not mint", () => {
  const map = plain();
  map.document.content.move(path(0), 0, 2);
  map.document.content.remove(path(0), 1);
  assert.deepEqual(quids(map.root()), []);
});

check("portable registry capture and restore retain QUID absence", () => {
  const source = plain();
  const target = plain();
  registry_for_document_library(target).restore(registry_for_document_library(source).capture());
  assert.deepEqual(quids(target.root()), []);
});

check("view-state codec preserves QUID-free canonical content", () => {
  const source = plain();
  const decoded = decode_view_state_snapshot(encode_view_state_snapshot(source.capture()));
  assert.deepEqual(quids(decoded.root), []);
});

check("supplied sparse QUIDs leave all eligible gaps untouched", () => {
  const map = sparse();
  assert.deepEqual(quids(map.root()), [Q1, Q2]);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(map.document.byQuid(Q2)?.$_tag, "item");
});

check("sparse path mutations do not mint extra identities", () => {
  const map = sparse();
  map.document.attrs.set(path(0, 1), "title", "identified");
  map.document.content.insert(path(0), 1, projected_element('<item/>'));
  assert.deepEqual(quids(map.root()), [Q1, Q2]);
});

check("sparse movement preserves only supplied QUIDs", () => {
  const map = sparse();
  map.document.content.move(path(0), 1, 0);
  assert.deepEqual(quids(map.root()), [Q1, Q2]);
});

check("portable capture strips supplied sparse QUIDs without mutating source", () => {
  const map = sparse();
  assert.deepEqual(quids(map.capture().root), []);
  assert.deepEqual(quids(map.root()), [Q1, Q2]);
});

events.terminal("pass");
process.stdout.write(`# ${checks} registry non-minting checks passed\n`);
