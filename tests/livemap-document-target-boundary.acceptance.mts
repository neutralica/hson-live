import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_node } from "../src/internal/exact-runtime-node-admission.ts";
// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/index.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { prepare_document_graph_operation } from "../src/api/livemap/livemap.document.mutation.ts";
import {
  LiveMapDocumentMutationError,
  LiveMapDocumentStagingError,
} from "../src/api/livemap/livemap.error.ts";
import type {
  DocumentLiveMap,
  LiveMapDocumentCommitTarget,
  LiveMapGraphOp,
} from "../src/types/livemap.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

const Q1 = "000000601";
const Q2 = "000000602";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-target-boundary",
  title: "Document request and commit target boundary",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "path", "quid", "witness", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-target-boundary");
let checks = 0;
function check(name: string, run: () => void): void {

  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): DocumentLiveMap {
  const map = admit_exact_runtime_livemap_node(parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true }));
  if (map.mode !== "document") throw new Error("Expected element map");
  return map;
}

function multiNodeDocument(source: string): DocumentLiveMap {
  const map = admit_exact_runtime_livemap_node(parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true }));
  if (map.mode !== "document") throw new Error("Expected multiNodeDocument map");
  return map;
}

const commitTarget = (
  parts: readonly number[],
  witness?: string,
): LiveMapDocumentCommitTarget => Object.freeze({
  kind: "path",
  path: validate_document_path(parts),
  ...(witness === undefined ? {} : { witness: Object.freeze({ quid: witness }) }),
});

function rawReplay(map: DocumentLiveMap | DocumentLiveMap, ops: readonly unknown[]): unknown {
  return Reflect.apply(map.replay, map, [{
    changed: true,
    prevRev: map.rev,
    rev: map.rev + 1,
    ops,
  }]);
}

function allQuids(root: ReturnType<DocumentLiveMap["root"]>): readonly string[] {
  const result: string[] = [];
  const walk = (node: typeof root): void => {
    const quid = node.$_meta?.quid;
    if (quid !== undefined) result.push(quid);
    for (const item of node.$_content) if (is_Node(item)) walk(item);
  };
  walk(root);
  return result;
}

check("path requests produce path-authoritative canonical commit targets", () => {
  const map = element(`<main/>`);
  const commit = map.document.attrs.set({ kind: "path", path: [0] }, "id", "main");
  const operation = commit.ops[0];
  assert.equal(operation?.op, "set-attr");
  assert.deepEqual(operation?.op === "set-attr" && operation.target, { kind: "path", path: [0] });
});

check("path requests do not acquire an implicit identity witness", () => {
  const map = element(`<main @${Q1}/>`);
  const commit = map.document.attrs.set({ kind: "path", path: [0] }, "id", "main");
  const operation = commit.ops[0];
  assert.equal(operation?.op === "set-attr" && operation.target.witness, undefined);
});

check("path requests remain path-authoritative on identified nodes", () => {
  const map = element(`<main @${Q1}/>`);
  const commit = map.document.attrs.set({ kind: "path", path: [0] }, "id", "main");
  const operation = commit.ops[0];
  assert.deepEqual(operation?.op === "set-attr" && operation.target, {
    kind: "path", path: [0],
  });
});

check("nested path requests record the exact current canonical path", () => {
  const map = element(`<main <section @${Q1}/>/>`);
  const commit = map.document.attrs.set({ kind: "path", path: [0, 0, 0] }, "id", "nested");
  const operation = commit.ops[0];
  assert.deepEqual(operation?.op === "set-attr" && operation.target.path, [0, 0, 0]);
});

check("request path arrays are detached before the commit is returned", () => {
  const input = [0];
  const map = multiNodeDocument(`<a/> <guard/>`);
  const commit = map.document.attrs.set({ kind: "path", path: input }, "id", "a");
  input[0] = 9;
  const operation = commit.ops[0];
  assert.deepEqual(operation?.op === "set-attr" && operation.target.path, [0]);
});

check("canonical target path values are frozen", () => {
  const map = element(`<main @${Q1}/>`);
  const operation = map.document.attrs.set({ kind: "path", path: [0] }, "id", "main").ops[0];
  if (operation?.op !== "set-attr") throw new Error("Expected set-attr");
  assert.equal(Object.isFrozen(operation.target), true);
  assert.equal(Object.isFrozen(operation.target.path), true);
  assert.equal(operation.target.witness, undefined);
});

check("matching active witness is rejected by public replay", () => {
  const map = multiNodeDocument(`<a @${Q1}/> <guard/>`);
  assert.throws(() => rawReplay(map, [{
    domain: "graph", op: "set-attr", target: commitTarget([0], Q1), name: "id", value: "matched",
  }]), /QUID witness/i);
  assert.equal(map.document.attrs.get({ kind: "path", path: [0] }, "id"), undefined);
  assert.equal(map.rev, 0);
});

check("active different QUID witness is rejected by public replay", () => {
  const map = multiNodeDocument(`<a @${Q2}/> <guard/>`);
  assert.throws(() => rawReplay(map, [{
    domain: "graph", op: "set-attr", target: commitTarget([0], Q1), name: "id", value: "bad",
  }]), /QUID witness/i);
  assert.equal(map.rev, 0);
});

check("path-authoritative replay needs no witness evidence", () => {
  const map = multiNodeDocument(`<a/> <guard/>`);
  rawReplay(map, [{
    domain: "graph", op: "set-attr", target: commitTarget([0]), name: "id", value: "identity-free",
  }]);
  assert.equal(map.document.attrs.get({ kind: "path", path: [0] }, "id"), "identity-free");
});

check("a witness found elsewhere is rejected without rerouting", () => {
  const map = multiNodeDocument(`<a/> <b @${Q1}/>`);
  assert.throws(() => rawReplay(map, [{
    domain: "graph", op: "set-attr", target: commitTarget([0], Q1), name: "id", value: "path-wins",
  }]), /QUID witness/i);
  assert.equal(map.document.attrs.get({ kind: "path", path: [0] }, "id"), undefined);
  assert.equal(map.document.attrs.get({ kind: "path", path: [1] }, "id"), undefined);
});

check("an invalid path is rejected without identity routing", () => {
  const map = multiNodeDocument(`<a @${Q1}/> <guard/>`);
  assert.throws(() => rawReplay(map, [{
    domain: "graph", op: "set-attr", target: commitTarget([9]), name: "id", value: "bad",
  }]), (error: unknown) => error instanceof LiveMapDocumentStagingError
    && error.reasonCode === "DOCUMENT_PATH_OUT_OF_RANGE");
});

check("path replay cannot make a primitive a valid attribute target", () => {
  const map = multiNodeDocument(`"text" <a @${Q1}/>`);
  assert.throws(() => rawReplay(map, [{
    domain: "graph", op: "set-attr", target: commitTarget([0, 0]), name: "id", value: "bad",
  }]), (error: unknown) => error instanceof LiveMapDocumentStagingError
    && error.reasonCode === "DOCUMENT_TARGET_KIND");
});

check("malformed witnesses reject at public replay admission", () => {
  const map = multiNodeDocument(`<a/> <guard/>`);
  assert.throws(() => rawReplay(map, [{
    domain: "graph",
    op: "set-attr",
    target: { kind: "path", path: [0], witness: { quid: "short" } },
    name: "id",
    value: "bad",
  }]), /QUID witness/i);
});

check("canonical operation planning rejects a QUID-only target", () => {
  const map = element(`<main @${Q1}/>`);
  assert.throws(() => prepare_document_graph_operation(map.root(), map.mode, {
    domain: "graph", op: "set-attr", target: { kind: "quid", quid: Q1 }, name: "id", value: "bad",
  }), (error: unknown) => error instanceof LiveMapDocumentMutationError
    && error.code === "INVALID_DOCUMENT_COMMIT_TARGET");
});

check("raw-QUID replay is rejected at the canonical boundary", () => {
  const map = element(`<main @${Q1}/>`);
  assert.throws(() => rawReplay(map, [{
    domain: "graph", op: "set-attr", target: { kind: "quid", quid: Q1 }, name: "id", value: "legacy",
  }]), (error: unknown) => error instanceof LiveMapDocumentStagingError
    && error.reasonCode === "INVALID_DOCUMENT_COMMIT_TARGET");
  assert.equal(map.rev, 0);
});

check("a missing raw-QUID replay target is rejected as an invalid target shape", () => {
  const map = element(`<main/>`);
  assert.throws(() => rawReplay(map, [{
    domain: "graph", op: "set-attr", target: { kind: "quid", quid: Q1 }, name: "id", value: "bad",
  }]), (error: unknown) => error instanceof LiveMapDocumentStagingError
    && error.reasonCode === "INVALID_DOCUMENT_COMMIT_TARGET");
});

check("canonical operation objects never contain a QUID-only target", () => {
  const map = element(`<main @${Q1} <span/>/>`);
  const operations = [
    map.document.attrs.set({ kind: "path", path: [0] }, "id", "one").ops[0],
    map.document.attrs.drop({ kind: "path", path: [0] }, "id").ops[0],
    map.document.content.remove({ kind: "path", path: [0] }, 0).ops[0],
  ];
  assert.ok(operations.every((operation) => operation !== undefined
    && operation.target.kind === "path"
    && !("quid" in operation.target)));
});

check("path-authoritative requests do not mint QUID metadata", () => {
  const map = element(`<main <section/>/>`);
  map.document.attrs.set({ kind: "path", path: [0, 0, 0] }, "id", "section");
  assert.deepEqual(allQuids(map.root()), []);
});

check("path requests preserve sparse gaps without minting", () => {
  const map = element(`<main <section @${Q1}/> <aside/>/>`);
  map.document.attrs.set({ kind: "path", path: [0, 0, 0] }, "id", "section");
  assert.deepEqual(allQuids(map.root()), [Q1]);
});

check("identity-free replay accepts a path commit from a quidded source", () => {
  const source = multiNodeDocument(`<a @${Q1}/> <guard/>`);
  const commit = source.document.attrs.set({ kind: "path", path: [0] }, "id", "portable");
  const target = multiNodeDocument(`<a/> <guard/>`);
  target.replay(commit);
  assert.equal(target.document.attrs.get({ kind: "path", path: [0] }, "id"), "portable");
  assert.deepEqual(allQuids(target.root()), []);
});

check("caller mutation of an operation-shaped target cannot affect accepted state", () => {
  const pathInput = [0];
  const map = multiNodeDocument(`<a/> <guard/>`);
  const commit = map.document.attrs.set({ kind: "path", path: pathInput }, "id", "stable");
  pathInput.push(9);
  const operation = commit.ops[0];
  assert.deepEqual(operation?.op === "set-attr" && operation.target.path, [0]);
  assert.equal(map.document.attrs.get({ kind: "path", path: [0] }, "id"), "stable");
});

check("canonical target JSON is deterministic and path-first", () => {
  const targetValue = commitTarget([2, 0], Q1);
  assert.equal(JSON.stringify(targetValue), `{"kind":"path","path":[2,0],"witness":{"quid":"${Q1}"}}`);
});

process.stdout.write(`# ${checks} document request/commit target boundary checks passed\n`);
testEvents.terminal("pass");
