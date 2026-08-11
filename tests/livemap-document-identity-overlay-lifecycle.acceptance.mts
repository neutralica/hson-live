// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { ElementLiveMap, LiveMapCommitObservation } from "../src/types/livemap.types.ts";
import {
  livemap_document_identity_accounting,
  livemap_document_identity_overlay_build_count,
  livemap_document_identity_overlay_for,
} from "../src/api/livemap/livemap.document.identity.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const Q1 = "000000201";
const Q2 = "000000202";
const Q3 = "000000203";
const rootTarget = { kind: "path", path: [] } as const;

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error("Expected element map");
  return map;
}

function graph(tag: string, quid: string, child?: Readonly<{ tag: string; quid: string }>): HsonNode {
  const content: HsonNode[] = child === undefined
    ? []
    : [{ $_tag: "_hson_elem", $_content: [{ $_tag: child.tag, $_content: [], $_meta: { quid: child.quid } }] }];
  return {
    $_tag: "_hson_root",
    $_content: [{
      $_tag: "_hson_elem",
      $_content: [{ $_tag: tag, $_content: content, $_meta: { quid } }],
    }],
  };
}

function invalidCapture(root: HsonNode): unknown {
  return { kind: "hson-document", version: 2, mode: "element", rev: 0, root };
}

check("construction completes exactly one overlay build", () => {
  const before = livemap_document_identity_overlay_build_count();
  const map = element(`<main @${Q1}/>`);
  assert.equal(livemap_document_identity_overlay_build_count(), before + 1);
  assert.equal(livemap_document_identity_overlay_for(map).size, 1);
});

check("accepted attr mutation reconciles without a full overlay rebuild", () => {
  const map = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_accounting();
  map.document.attrs.set(rootTarget, "id", "changed");
  const after = livemap_document_identity_accounting();
  assert.equal(after.fullBuilds, before.fullBuilds);
  assert.equal(after.reconciliations, before.reconciliations + 1);
});

check("accepted attr mutation atomically retains the exact overlay with the new root", () => {
  const map = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_overlay_for(map);
  map.document.attrs.set(rootTarget, "id", "changed");
  const after = livemap_document_identity_overlay_for(map);
  assert.equal(after, before);
  assert.equal(after.quidAtPath(validate_document_path([])), Q1);
});

check("capture serializes graph identity but not the derived overlay", () => {
  const map = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_overlay_build_count();
  const capture = map.capture();
  assert.deepEqual(Object.keys(capture).sort(), ["kind", "mode", "rev", "root", "version"]);
  assert.equal(JSON.stringify(capture.root).includes(Q1), true);
  assert.equal(livemap_document_identity_overlay_build_count(), before);
});

check("document.byQuid lifecycle reads never rebuild the overlay", () => {
  const map = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_overlay_build_count();
  map.document.byQuid(Q1);
  map.document.byQuid(Q2);
  assert.equal(livemap_document_identity_overlay_build_count(), before);
});

check("install builds its candidate overlay once before publication", () => {
  const source = element(`<article @${Q2}/>`);
  const target = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_overlay_build_count();
  target.install(source.capture());
  assert.equal(livemap_document_identity_overlay_build_count(), before + 1);
  assert.equal(target.document.byQuid(Q2)?.$_tag, "article");
});

check("restore builds its candidate overlay once and installs the exact revision", () => {
  const source = element(`<article @${Q2}/>`);
  source.document.attrs.set(rootTarget, "id", "one");
  source.document.attrs.set(rootTarget, "id", "two");
  const target = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_overlay_build_count();
  target.restore(source.capture());
  assert.equal(livemap_document_identity_overlay_build_count(), before + 1);
  assert.equal(target.rev, 2);
  assert.equal(target.document.byQuid(Q2)?.$_attrs?.id, "two");
});

check("single-operation replay reconciles without a full overlay rebuild", () => {
  const source = element(`<main @${Q1}/>`);
  const commit = source.document.attrs.set(rootTarget, "id", "replayed");
  const target = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_overlay_build_count();
  target.replay(commit);
  assert.equal(livemap_document_identity_overlay_build_count(), before);
  assert.equal(target.document.byQuid(Q1)?.$_attrs?.id, "replayed");
});

check("replace-root replay builds and installs one candidate overlay", () => {
  const source = element(`<article @${Q2}/>`);
  const producer = element(`<main @${Q1}/>`);
  const commit = producer.install(source.capture());
  const target = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_overlay_build_count();
  target.replay(commit);
  assert.equal(livemap_document_identity_overlay_build_count(), before + 1);
  assert.equal(target.document.byQuid(Q2)?.$_tag, "article");
});

check("duplicate install candidates reject before any overlay publication", () => {
  const target = element(`<main @${Q1}/>`);
  const duplicate = graph("main", Q2, { tag: "span", quid: Q2 });
  const before = livemap_document_identity_overlay_build_count();
  assert.throws(() => Reflect.apply(target.install, target, [invalidCapture(duplicate)]));
  assert.equal(livemap_document_identity_overlay_build_count(), before);
});

check("duplicate candidate failure leaves root unchanged", () => {
  const target = element(`<main @${Q1}/>`);
  const before = target.root();
  assert.throws(() => Reflect.apply(target.install, target, [invalidCapture(graph("main", Q2, { tag: "span", quid: Q2 }))]));
  assert.deepEqual(target.root(), before);
});

check("duplicate candidate failure leaves revision unchanged", () => {
  const target = element(`<main @${Q1}/>`);
  assert.throws(() => Reflect.apply(target.install, target, [invalidCapture(graph("main", Q2, { tag: "span", quid: Q2 }))]));
  assert.equal(target.rev, 0);
});

check("duplicate candidate failure leaves the exact overlay installed", () => {
  const target = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_overlay_for(target);
  assert.throws(() => Reflect.apply(target.install, target, [invalidCapture(graph("main", Q2, { tag: "span", quid: Q2 }))]));
  assert.equal(livemap_document_identity_overlay_for(target), before);
  assert.deepEqual(before.pathForQuid(Q1), []);
});

check("duplicate candidate failure publishes no commit or snapshot", () => {
  const target = element(`<main @${Q1}/>`);
  const events: LiveMapCommitObservation[] = [];
  target.commits.observe((event) => events.push(event));
  assert.throws(() => Reflect.apply(target.install, target, [invalidCapture(graph("main", Q2, { tag: "span", quid: Q2 }))]));
  assert.deepEqual(events, []);
});

check("malformed candidate failure preserves root revision overlay and publication", () => {
  const target = element(`<main @${Q1}/>`);
  const rootBefore = target.root();
  const overlayBefore = livemap_document_identity_overlay_for(target);
  const events: LiveMapCommitObservation[] = [];
  target.commits.observe((event) => events.push(event));
  assert.throws(() => Reflect.apply(target.restore, target, [invalidCapture(graph("bad", "short"))]));
  assert.deepEqual(target.root(), rootBefore);
  assert.equal(target.rev, 0);
  assert.equal(livemap_document_identity_overlay_for(target), overlayBefore);
  assert.deepEqual(events, []);
});

check("failed QUID request performs no candidate overlay build", () => {
  const target = element(`<main @${Q1}/>`);
  const before = livemap_document_identity_overlay_build_count();
  assert.throws(() => target.document.attrs.set({ kind: "quid", quid: Q2 }, "id", "bad"));
  assert.equal(livemap_document_identity_overlay_build_count(), before);
  assert.equal(target.rev, 0);
});

check("QUID-free accepted transitions retain an empty overlay without rebuilding", () => {
  const target = element(`<main/>`);
  const overlayBefore = livemap_document_identity_overlay_for(target);
  const before = livemap_document_identity_overlay_build_count();
  target.document.attrs.set(rootTarget, "id", "clean");
  assert.equal(livemap_document_identity_overlay_build_count(), before);
  assert.equal(livemap_document_identity_overlay_for(target), overlayBefore);
  assert.equal(livemap_document_identity_overlay_for(target).size, 0);
});

check("supplied sparse QUIDs remain exact across insertion", () => {
  const target = element(`<main @${Q1}/>`);
  target.document.content.insert(rootTarget, 0, {
    $_tag: "_hson_elem",
    $_content: [{ $_tag: "span", $_content: [], $_meta: { quid: Q2 } }],
  });
  const overlay = livemap_document_identity_overlay_for(target);
  assert.equal(overlay.size, 2);
  assert.deepEqual(overlay.pathForQuid(Q1), []);
  assert.deepEqual(overlay.pathForQuid(Q2), [0, 0]);
});

check("removal retires only removed sparse identity", () => {
  const target = element(`<main @${Q1} <span @${Q2}/> <b @${Q3}/>/>`);
  target.document.content.remove({ kind: "path", path: [0] }, 0);
  const overlay = livemap_document_identity_overlay_for(target);
  assert.equal(overlay.size, 2);
  assert.equal(overlay.pathForQuid(Q2), undefined);
  assert.deepEqual(overlay.pathForQuid(Q3), [0, 0]);
});

check("commit observers see the already-installed root and overlay", () => {
  const target = element(`<main @${Q1}/>`);
  let witnessed: string | undefined;
  target.commits.observe((event) => {
    if (event.kind === "commit") witnessed = target.document.byQuid(Q2)?.$_tag;
  });
  target.install(element(`<article @${Q2}/>`).capture());
  assert.equal(witnessed, "article");
  assert.equal(target.document.byQuid(Q1), undefined);
});

check("canonical no-op candidates reconcile without rebuild revision or publication", () => {
  const target = element(`<main @${Q1} id="same"/>`);
  const events: LiveMapCommitObservation[] = [];
  target.commits.observe((event) => events.push(event));
  const before = livemap_document_identity_overlay_build_count();
  const commit = target.document.attrs.set(rootTarget, "id", "same");
  assert.equal(livemap_document_identity_overlay_build_count(), before);
  assert.equal(commit.changed, false);
  assert.equal(target.rev, 0);
  assert.deepEqual(events, []);
});

check("installed sparse QUID values survive capture and restore exactly", () => {
  const source = element(`<main @${Q1} <span @${Q2}/>/` + `>`);
  const target = element(`<aside @${Q3}/>`);
  target.restore(source.capture());
  assert.equal(target.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(target.document.byQuid(Q2)?.$_tag, "span");
  assert.equal(target.document.byQuid(Q3), undefined);
});

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livemap.document-identity-overlay-lifecycle", checks, checks, 0);
