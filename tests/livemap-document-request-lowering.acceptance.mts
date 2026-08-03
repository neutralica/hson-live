// @hson-live-external-test
import assert from "node:assert/strict";
import { hson, validate_document_path } from "../src/index.ts";
import { decode_livehost_canonical_commit } from "../src/api/livehost/livehost.protocol.ts";
import { prepare_document_graph_operation } from "../src/api/livemap/livemap.document.mutation.ts";
import {
  canonicalize_document_request_target,
  normalize_document_commit_target,
} from "../src/api/livemap/livemap.document.target.ts";
import { livemap_document_identity_overlay_for } from "../src/api/livemap/livemap.document.identity.ts";
import {
  LiveMapDocumentMutationError,
  LiveMapDocumentStagingError,
} from "../src/api/livemap/livemap.error.ts";
import type { ElementLiveMap } from "../src/types/livemap.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

const Q1 = "0000000000000701";
const Q2 = "0000000000000702";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error("Expected element LiveMap");
  return map;
}

function rawReplay(map: ElementLiveMap, ops: readonly unknown[]): unknown {
  return Reflect.apply(map.replay, map, [{
    changed: true,
    prevRev: map.rev,
    rev: map.rev + 1,
    ops,
  }]);
}

function canonicalEnvelope(target: unknown): unknown {
  return {
    logicalMapId: "unit-5",
    incarnationId: "request-lowering",
    mode: "element",
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "set-attr", target, name: "id", value: "x" }],
  };
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

check("path request remains a detached canonical path target", () => {
  const input = [0, 0];
  const map = element(`<main <section/>/>`);
  const commit = map.document.attrs.set({ kind: "path", path: input }, "id", "section");
  input[1] = 9;
  assert.deepEqual(commit.ops[0]?.target, { kind: "path", path: [0, 0] });
});

check("QUID request lowers to the exact current path", () => {
  const map = element(`<main <section @${Q1}/>/>`);
  const commit = map.document.attrs.set({ kind: "quid", quid: Q1 }, "id", "section");
  assert.deepEqual(commit.ops[0]?.target.path, [0, 0]);
});

check("QUID lowering retains a non-routing witness", () => {
  const map = element(`<main <section @${Q1}/>/>`);
  const commit = map.document.attrs.set({ kind: "quid", quid: Q1 }, "id", "section");
  assert.deepEqual(commit.ops[0]?.target.witness, { quid: Q1 });
});

check("path requests do not require or acquire a witness", () => {
  const map = element(`<main @${Q1}/>`);
  const commit = map.document.attrs.set({ kind: "path", path: [] }, "id", "main");
  assert.equal(commit.ops[0]?.target.witness, undefined);
});

check("missing QUID rejects without revision change", () => {
  const map = element(`<main/>`);
  assert.throws(
    () => map.document.attrs.set({ kind: "quid", quid: Q1 }, "id", "bad"),
    (error: unknown) => error instanceof LiveMapDocumentMutationError
      && error.code === "DOCUMENT_TARGET_NOT_FOUND",
  );
  assert.equal(map.rev, 0);
});

check("malformed QUID request rejects at request admission", () => {
  const map = element(`<main/>`);
  assert.throws(
    () => map.document.attrs.set({ kind: "quid", quid: "bad" }, "id", "bad"),
    (error: unknown) => error instanceof LiveMapDocumentMutationError
      && error.code === "INVALID_DOCUMENT_TARGET",
  );
});

check("matching witness validates the authoritative path", () => {
  const map = element(`<main <section @${Q1}/>/>`);
  rawReplay(map, [{
    domain: "graph",
    op: "set-attr",
    target: { kind: "path", path: [0, 0], witness: { quid: Q1 } },
    name: "id",
    value: "matched",
  }]);
  assert.equal(map.document.byQuid(Q1)?.$_attrs?.id, "matched");
});

check("active different QUID reports witness mismatch", () => {
  const map = element(`<main <section @${Q2}/>/>`);
  assert.throws(() => rawReplay(map, [{
    domain: "graph",
    op: "set-attr",
    target: { kind: "path", path: [0, 0], witness: { quid: Q1 } },
    name: "id",
    value: "bad",
  }]), (error: unknown) => error instanceof LiveMapDocumentStagingError
    && error.reasonCode === "DOCUMENT_WITNESS_MISMATCH");
});

check("QUID found elsewhere cannot reroute a valid path", () => {
  const map = element(`<main <a/> <b @${Q1}/>/>`);
  rawReplay(map, [{
    domain: "graph",
    op: "set-attr",
    target: { kind: "path", path: [0, 0], witness: { quid: Q1 } },
    name: "id",
    value: "path-wins",
  }]);
  assert.equal(map.document.attrs.get({ kind: "path", path: [0, 0] }, "id"), "path-wins");
  assert.equal(map.document.byQuid(Q1)?.$_attrs?.id, undefined);
});

check("invalid path is never repaired by a matching witness", () => {
  const map = element(`<main <a @${Q1}/>/>`);
  assert.throws(() => rawReplay(map, [{
    domain: "graph",
    op: "set-attr",
    target: { kind: "path", path: [0, 9], witness: { quid: Q1 } },
    name: "id",
    value: "bad",
  }]), (error: unknown) => error instanceof LiveMapDocumentStagingError
    && error.reasonCode === "DOCUMENT_PATH_OUT_OF_RANGE");
});

check("identity-free replay interprets a witnessed path", () => {
  const source = element(`<main @${Q1}/>`);
  const commit = source.document.attrs.set({ kind: "quid", quid: Q1 }, "id", "portable");
  const target = element(`<main/>`);
  target.replay(commit);
  assert.equal(target.document.attrs.get({ kind: "path", path: [] }, "id"), "portable");
});

check("canonical target objects and nested evidence are immutable", () => {
  const map = element(`<main @${Q1}/>`);
  const target = map.document.attrs.set({ kind: "quid", quid: Q1 }, "id", "x").ops[0]?.target;
  assert.equal(Object.isFrozen(target), true);
  assert.equal(Object.isFrozen(target?.path), true);
  assert.equal(Object.isFrozen(target?.witness), true);
});

check("request lowering does not mint identity", () => {
  const map = element(`<main <section/>/>`);
  map.document.attrs.set({ kind: "path", path: [0, 0] }, "id", "section");
  assert.equal(livemap_document_identity_overlay_for(map).size, 0);
});

check("attribute request family returns path-only operations", () => {
  const maps = [
    element(`<main @${Q1}/>`),
    element(`<main id="x" @${Q1}/>`),
    element(`<main @${Q1}/>`),
  ];
  const operations = [
    maps[0]!.document.attrs.set({ kind: "quid", quid: Q1 }, "id", "x").ops[0],
    maps[1]!.document.attrs.drop({ kind: "quid", quid: Q1 }, "id").ops[0],
    maps[2]!.document.attrs.replace({ kind: "quid", quid: Q1 }, { id: "x" }).ops[0],
  ];
  assert.ok(operations.every((operation) => operation?.target.kind === "path"));
});

check("content request family returns path-only operations", () => {
  const wrapper = element(`<x <y/>/>`).element.node().$_content[0];
  if (wrapper === undefined) throw new Error("Expected structural content wrapper");
  const replace = element(`<main @${Q1} <a/>/>`).document.content.replace({ kind: "quid", quid: Q1 }, 0, wrapper).ops[0];
  const insert = element(`<main @${Q1}/>`).document.content.insert({ kind: "quid", quid: Q1 }, 0, wrapper).ops[0];
  const remove = element(`<main @${Q1} <a/>/>`).document.content.remove({ kind: "quid", quid: Q1 }, 0).ops[0];
  const move = element(`<main @${Q1} <a/>/>`).document.content.move({ kind: "quid", quid: Q1 }, 0, 0);
  assert.ok([replace, insert, remove].every((operation) => operation?.target.kind === "path"));
  assert.equal(move.changed, false);
});

check("canonical operation planner rejects QUID-only construction", () => {
  const map = element(`<main @${Q1}/>`);
  assert.throws(() => prepare_document_graph_operation(map.root(), map.mode, {
    domain: "graph",
    op: "set-attr",
    target: { kind: "quid", quid: Q1 },
    name: "id",
    value: "bad",
  }), (error: unknown) => error instanceof LiveMapDocumentMutationError
    && error.code === "INVALID_DOCUMENT_COMMIT_TARGET");
});

check("canonical target normalizer rejects the request union QUID branch", () => {
  assert.throws(
    () => normalize_document_commit_target({ kind: "quid", quid: Q1 }, "set-attr"),
    (error: unknown) => error instanceof LiveMapDocumentMutationError
      && error.code === "INVALID_DOCUMENT_COMMIT_TARGET",
  );
});

check("current LiveHost canonical decoder rejects QUID-only targets", () => {
  assert.equal(decode_livehost_canonical_commit(canonicalEnvelope({ kind: "quid", quid: Q1 })), undefined);
});

check("current LiveHost canonical decoder accepts path targets", () => {
  const decoded = decode_livehost_canonical_commit(canonicalEnvelope({ kind: "path", path: [] }));
  assert.equal(field(decoded?.ops[0], "domain"), "graph");
});

check("direct lowering reads the installed sparse overlay", () => {
  const map = element(`<main <a @${Q1}/>/>`);
  const lowered = canonicalize_document_request_target(
    map.root(),
    map.mode,
    livemap_document_identity_overlay_for(map),
    { kind: "quid", quid: Q1 },
    "set-attr",
  );
  assert.deepEqual(lowered.target, { kind: "path", path: [0, 0], witness: { quid: Q1 } });
});

check("read-only byQuid returns a detached result without a commit", () => {
  const map = element(`<main @${Q1}/>`);
  const before = map.rev;
  const node = map.document.byQuid(Q1);
  if (node === undefined) throw new Error("Expected QUID lookup");
  node.$_attrs = { id: "detached" };
  assert.equal(map.rev, before);
  assert.equal(map.element.node().$_attrs, undefined);
});

check("malformed and absent read-only QUID lookups remain inert", () => {
  const map = element(`<main/>`);
  assert.equal(map.document.byQuid("bad"), undefined);
  assert.equal(map.document.byQuid(Q1), undefined);
  assert.equal(map.rev, 0);
});

check("canonical target JSON contains no unresolved QUID branch", () => {
  const target = Object.freeze({
    kind: "path" as const,
    path: validate_document_path([0, 1]),
    witness: Object.freeze({ quid: Q1 }),
  });
  assert.equal(JSON.stringify(target), `{"kind":"path","path":[0,1],"witness":{"quid":"${Q1}"}}`);
});

process.stdout.write(`# ${checks} document request-lowering checks passed\n`);
emit_hson_live_test_completion("livemap.document-request-lowering", checks, checks, 0);
