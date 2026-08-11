// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { ElementLiveMap, LiveMapGraphOp } from "../src/types/livemap.types.ts";
import {
  livemap_document_identity_overlay_build_count,
  livemap_document_identity_overlay_for,
  replace_livemap_document_identity_overlay_effects,
} from "../src/api/livemap/livemap.document.identity.ts";
import { prepare_document_graph_operation } from "../src/api/livemap/livemap.document.mutation.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const Q1 = "000000401";
const Q2 = "000000402";
const Q3 = "000000403";
const Q4 = "000000404";
const path = (...parts: number[]) => validate_document_path(parts);
const target = (...parts: number[]) => Object.freeze({ kind: "path" as const, path: path(...parts) });

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error("Expected element map");
  return map;
}

function ordinary(tag: string, quid?: string, child?: HsonNode): HsonNode {
  return {
    $_tag: tag,
    $_content: child === undefined ? [] : [{ $_tag: "_hson_elem", $_content: [child] }],
    ...(quid === undefined ? {} : { $_meta: { quid } }),
  };
}

function branch(tag: string, quid?: string, child?: HsonNode): HsonNode {
  return { $_tag: "_hson_elem", $_content: [ordinary(tag, quid, child)] };
}

function prepare(map: ElementLiveMap, operation: LiveMapGraphOp) {
  return prepare_document_graph_operation(
    map.root(),
    map.mode,
    operation,
    livemap_document_identity_overlay_for(map),
  );
}

check("set-attr preserves target identity without replacing the overlay", () => {
  const map = element(`<main @${Q1}/>`);
  const overlay = livemap_document_identity_overlay_for(map);
  const planned = prepare(map, { domain: "graph", op: "set-attr", target: target(), name: "id", value: "x" });
  assert.equal(planned.overlay, overlay);
  assert.deepEqual(planned.identityEffects, [{ kind: "preserved", quid: Q1, path: [] }]);
});

check("remove-attr preserves target identity", () => {
  const map = element(`<main @${Q1} id="x"/>`);
  const planned = prepare(map, { domain: "graph", op: "remove-attr", target: target(), name: "id" });
  assert.deepEqual(planned.identityEffects, [{ kind: "preserved", quid: Q1, path: [] }]);
});

check("replace-attrs preserves target identity", () => {
  const map = element(`<main @${Q1}/>`);
  const planned = prepare(map, { domain: "graph", op: "replace-attrs", target: target(), attrs: { title: "x" } });
  assert.deepEqual(planned.identityEffects, [{ kind: "preserved", quid: Q1, path: [] }]);
});

check("QUID-free attr operations produce no identity effects", () => {
  const map = element(`<main/>`);
  const planned = prepare(map, { domain: "graph", op: "set-attr", target: target(), name: "id", value: "x" });
  assert.deepEqual(planned.identityEffects, []);
  assert.equal(planned.overlay.size, 0);
});

check("insert introduces supplied sparse identity", () => {
  const map = element(`<main @${Q1}/>`);
  const planned = prepare(map, { domain: "graph", op: "insert-content", target: target(), index: 0, content: branch("span", Q2) });
  assert.deepEqual(planned.overlay.pathForQuid(Q2), [0, 0]);
  assert.deepEqual(planned.identityEffects, [{ kind: "introduced", quid: Q2, path: [0, 0] }]);
});

check("insert shifts later sparse siblings", () => {
  const map = element(`<main <b @${Q2}/>/` + `>`);
  const planned = prepare(map, { domain: "graph", op: "insert-content", target: target(0), index: 0, content: ordinary("i") });
  assert.deepEqual(planned.overlay.pathForQuid(Q2), [0, 1]);
  assert.deepEqual(planned.identityEffects, [{ kind: "moved", quid: Q2, from: [0, 0], to: [0, 1] }]);
});

check("inserted descendant paths retain their relative suffix", () => {
  const map = element(`<main/>`);
  const planned = prepare(map, {
    domain: "graph", op: "insert-content", target: target(), index: 0,
    content: branch("section", Q2, { $_tag: "b", $_content: [], $_meta: { quid: Q3 } }),
  });
  assert.deepEqual(planned.overlay.pathForQuid(Q2), [0, 0]);
  assert.deepEqual(planned.overlay.pathForQuid(Q3), [0, 0, 0, 0]);
});

check("replace retires every old subtree identity", () => {
  const map = element(`<main <section @${Q2} <b @${Q3}/>/` + `>/` + `>`);
  const planned = prepare(map, { domain: "graph", op: "replace-content", target: target(0), index: 0, replacement: ordinary("i") });
  assert.equal(planned.overlay.pathForQuid(Q2), undefined);
  assert.equal(planned.overlay.pathForQuid(Q3), undefined);
  assert.equal(planned.identityEffects.filter((effect) => effect.kind === "retired").length, 2);
});

check("replace introduces every incoming subtree identity", () => {
  const map = element(`<main <i/>/>`);
  const planned = prepare(map, { domain: "graph", op: "replace-content", target: target(0), index: 0, replacement: ordinary("b", Q2) });
  assert.deepEqual(planned.overlay.pathForQuid(Q2), [0, 0]);
  assert.equal(planned.identityEffects[0]?.kind, "introduced");
});

check("replacement with the same supplied QUID derives retirement then introduction", () => {
  const map = element(`<main <i @${Q2}/>/` + `>`);
  const planned = prepare(map, { domain: "graph", op: "replace-content", target: target(0), index: 0, replacement: ordinary("b", Q2) });
  assert.deepEqual(planned.identityEffects.map((effect) => effect.kind), ["retired", "introduced"]);
  assert.deepEqual(planned.overlay.pathForQuid(Q2), [0, 0]);
});

check("remove retires a complete sparse subtree", () => {
  const map = element(`<main <section @${Q2} <b @${Q3}/>/` + `>/` + `>`);
  const planned = prepare(map, { domain: "graph", op: "remove-content", target: target(), index: 0 });
  assert.equal(planned.overlay.size, 0);
  assert.equal(planned.identityEffects.filter((effect) => effect.kind === "retired").length, 2);
});

check("remove shifts later sparse siblings down once", () => {
  const map = element(`<main <a/> <b @${Q2}/>/` + `>`);
  const planned = prepare(map, { domain: "graph", op: "remove-content", target: target(0), index: 0 });
  assert.deepEqual(planned.overlay.pathForQuid(Q2), [0, 0]);
  assert.deepEqual(planned.identityEffects, [{ kind: "moved", quid: Q2, from: [0, 1], to: [0, 0] }]);
});

check("forward move preserves moved subtree identity", () => {
  const map = element(`<main <a @${Q2}/> <b/> <c/>/>`);
  const planned = prepare(map, { domain: "graph", op: "move-content", target: target(0), from: 0, to: 2 });
  assert.deepEqual(planned.overlay.pathForQuid(Q2), [0, 2]);
  assert.equal(planned.identityEffects[0]?.kind, "moved");
});

check("forward move shifts intervening sparse siblings once", () => {
  const map = element(`<main <a/> <b @${Q2}/> <c @${Q3}/>/` + `>`);
  const planned = prepare(map, { domain: "graph", op: "move-content", target: target(0), from: 0, to: 2 });
  assert.deepEqual(planned.overlay.pathForQuid(Q2), [0, 0]);
  assert.deepEqual(planned.overlay.pathForQuid(Q3), [0, 1]);
});

check("backward move preserves and relocates subtree identity", () => {
  const map = element(`<main <a/> <b/> <c @${Q2}/>/` + `>`);
  const planned = prepare(map, { domain: "graph", op: "move-content", target: target(0), from: 2, to: 0 });
  assert.deepEqual(planned.overlay.pathForQuid(Q2), [0, 0]);
});

check("move keeps descendant suffixes intact", () => {
  const map = element(`<main <a/> <section @${Q2} <b @${Q3}/>/` + `>/` + `>`);
  const planned = prepare(map, { domain: "graph", op: "move-content", target: target(0), from: 1, to: 0 });
  assert.deepEqual(planned.overlay.pathForQuid(Q2), [0, 0]);
  assert.deepEqual(planned.overlay.pathForQuid(Q3), [0, 0, 0, 0]);
});

check("same-position move retains the exact overlay and derives no effects", () => {
  const map = element(`<main <a @${Q2}/>/` + `>`);
  const overlay = livemap_document_identity_overlay_for(map);
  const planned = prepare(map, { domain: "graph", op: "move-content", target: target(0), from: 0, to: 0 });
  assert.equal(planned.overlay, overlay);
  assert.deepEqual(planned.identityEffects, []);
});

check("QUID-free structural changes retain the empty overlay", () => {
  const map = element(`<main <a/>/>`);
  const overlay = livemap_document_identity_overlay_for(map);
  map.document.content.insert(target(0), 1, ordinary("b"));
  assert.equal(livemap_document_identity_overlay_for(map), overlay);
});

check("whole-root replacement evidence retires old and introduces replacement claims", () => {
  const before = element(`<main @${Q1}/>`);
  const after = element(`<article @${Q4}/>`);
  assert.deepEqual(
    replace_livemap_document_identity_overlay_effects(
      livemap_document_identity_overlay_for(before),
      livemap_document_identity_overlay_for(after),
    ).map((effect) => effect.kind),
    ["retired", "introduced"],
  );
});

check("ordinary operation sequence performs no full overlay reconstruction", () => {
  const map = element(`<main @${Q1} <a @${Q2}/>/>`);
  const before = livemap_document_identity_overlay_build_count();
  map.document.attrs.set(target(), "id", "x");
  map.document.content.insert(target(0), 0, ordinary("b", Q3));
  map.document.content.move(target(0), 0, 1);
  map.document.content.remove(target(0), 0);
  assert.equal(livemap_document_identity_overlay_build_count(), before);
});

check("incremental candidate overlay agrees with a fresh diagnostic scan", () => {
  const map = element(`<main @${Q1} <a @${Q2}/>/>`);
  map.document.content.insert(target(0), 0, ordinary("b", Q3));
  const overlay = livemap_document_identity_overlay_for(map);
  assert.deepEqual(overlay.pathForQuid(Q1), []);
  assert.deepEqual(overlay.pathForQuid(Q2), [0, 1]);
  assert.deepEqual(overlay.pathForQuid(Q3), [0, 0]);
});

check("ordinary attributes cannot write QUID metadata", () => {
  const map = element(`<main @${Q1}/>`);
  assert.throws(() => map.document.attrs.set(target(), "hson:quid", Q2), /system metadata/);
  assert.deepEqual(livemap_document_identity_overlay_for(map).pathForQuid(Q1), []);
});

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livemap.document-operation-identity-effects", checks, checks, 0);
