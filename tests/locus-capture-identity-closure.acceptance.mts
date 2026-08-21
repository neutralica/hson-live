// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { is_Node } from "../src/core/node-guards.ts";
import {
  decode_view_state_snapshot,
  encode_view_state_snapshot,
} from "../src/api/livemap/livemap.document.view-state-codec.ts";
import {
  decode_locus_graph_content,
  encode_locus_graph_content,
} from "../src/api/locus/locus.graph-content-codec.ts";
import {
  decode_locus_document_snapshot,
  encode_locus_document_snapshot,
} from "../src/api/locus/locus.document-snapshot.ts";
import {
  capture_locus_bootstrap,
  install_locus_bootstrap,
} from "../src/api/locus/locus.bootstrap.ts";
import {
  _create_livetree_runtime_test_handle,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import type { ClassifiedLiveMap, ElementLiveMap } from "../src/types/livemap.types.ts";
import { element, path, projected_element, raw_node } from "./helpers/reflect-unit6.mts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

const Q1 = "000000v91";
const Q2 = "000000v92";
let checks = 0;

function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function mustElement(map: ReturnType<typeof hson.liveMap.fromHson>): ElementLiveMap {
  if (map.mode !== "element") throw new Error("Expected element LiveMap");
  return map;
}

function mustClassifiedElement(map: ClassifiedLiveMap): ElementLiveMap {
  if (map.mode !== "element") throw new Error("Expected element LiveMap");
  return map;
}

check("view-state is a durable exact-metadata capture", () => {
  const source = element(`<main @${Q1}/>`);
  const decoded = decode_view_state_snapshot(encode_view_state_snapshot(source.capture()));
  assert.equal(canonical_hson_graph_equal(decoded.root, source.root()), true);
});

check("view-state bytes do not carry same-epoch provenance", () => {
  const source = element(`<main @${Q1}/>`);
  const decoded = decode_view_state_snapshot(encode_view_state_snapshot(source.capture({ identity: "same-epoch" })));
  assert.throws(
    () => source.restore(decoded, { identity: "same-epoch" }),
    (error: unknown) => typeof error === "object" && error !== null
      && "code" in error && error.code === "SAME_EPOCH_PROVENANCE_REQUIRED",
  );
});

check("a persistence-checkpoint restart admits metadata into a new local map", () => {
  const source = element(`<main @${Q1}/>`);
  const checkpoint = encode_view_state_snapshot(source.capture({ identity: "preserve-metadata" }));
  const capture = decode_view_state_snapshot(checkpoint);
  const restarted = element(`<main/>`);
  restarted.restore(capture, { identity: "preserve-metadata" });
  assert.equal(restarted.document.byQuid(Q1)?.$_tag, "main");
});

check("a persistence restart does not adopt the old local capability", () => {
  const source = element(`<main @${Q1}/>`);
  const capability = source.capture({ identity: "same-epoch" });
  const restarted = element(`<main/>`);
  restarted.restore(decode_view_state_snapshot(encode_view_state_snapshot(capability)));
  assert.throws(
    () => restarted.install(capability, { identity: "same-epoch" }),
    (error: unknown) => typeof error === "object" && error !== null
      && "code" in error && error.code === "FOREIGN_IDENTITY_EPOCH",
  );
});

check("graph-content codec preserves detached QUID metadata", () => {
  const node = projected_element(`<i @${Q1}/>`);
  const decoded = decode_locus_graph_content(encode_locus_graph_content(node));
  assert.equal(is_Node(decoded) && decoded.$_meta?.quid, Q1);
  assert.notEqual(decoded, node);
});

check("graph-content admission creates fresh map-local lookup", () => {
  const decoded = decode_locus_graph_content(
    encode_locus_graph_content(projected_element(`<i @${Q1}/>`)),
  );
  const target = element(`<main <b/>/>`);
  target.document.content.insert(path(0), 0, decoded);
  assert.equal(target.document.byQuid(Q1)?.$_tag, "i");
});

check("graph-content bytes never mint absent QUIDs", () => {
  const decoded = decode_locus_graph_content(encode_locus_graph_content(projected_element(`<i/>`)));
  assert.equal(JSON.stringify(decoded).includes("quid"), false);
});

check("view-state Locus snapshots retain exact metadata", () => {
  const source = element(`<main @${Q1}/>`);
  const snapshot = encode_locus_document_snapshot(
    { logicalMapId: "unit7-view", incarnationId: "inc-view" },
    source.capture(),
    { format: "view-state" },
  );
  const decoded = decode_locus_document_snapshot(snapshot);
  assert.equal(canonical_hson_graph_equal(decoded.root, source.root()), true);
});

check("HSON Locus snapshots retain exact metadata", () => {
  const source = element(`<main @${Q1}/>`);
  const snapshot = encode_locus_document_snapshot(
    { logicalMapId: "unit7-hson", incarnationId: "inc-hson" },
    source.capture(),
    { format: "hson" },
  );
  const decoded = decode_locus_document_snapshot(snapshot);
  assert.equal(decoded.root.$_content.length > 0, true);
  assert.equal(JSON.stringify(decoded.root).includes(Q1), true);
});

check("Locus bootstrap installs metadata into a new mirror epoch", () => {
  const source = element(`<main @${Q1}/>`);
  const host = hson.locus.create({ map: source, logicalMapId: "unit7-bootstrap" });
  const bootstrap = capture_locus_bootstrap(host, "unit7:bootstrap", "/unit7");
  const installed = install_locus_bootstrap(bootstrap);
  assert.equal(installed.map.mode, "element");
  if (installed.map.mode !== "element") throw new Error("Expected element bootstrap mirror");
  assert.equal(installed.map.document.byQuid(Q1)?.$_tag, "main");
});

check("bootstrap logical identity is not same-epoch node provenance", () => {
  const source = element(`<main @${Q1}/>`);
  const capability = source.capture({ identity: "same-epoch" });
  const host = hson.locus.create({ map: source, logicalMapId: "unit7-bootstrap-proof" });
  const installed = install_locus_bootstrap(capture_locus_bootstrap(host, "unit7:proof", "/unit7-proof"));
  const mirror = mustClassifiedElement(installed.map);
  assert.throws(
    () => mirror.install(capability, { identity: "same-epoch" }),
    (error: unknown) => typeof error === "object" && error !== null
      && "code" in error && error.code === "FOREIGN_IDENTITY_EPOCH",
  );
});

check("path-authoritative replay survives an identity-free checkpoint", () => {
  const source = element(`<main @${Q1}/>`);
  const checkpoint = source.capture({ identity: "strip" });
  const commit = source.document.attrs.set({ kind: "quid", quid: Q1 }, "data-tail", "kept");
  const mirror = element(`<main/>`);
  mirror.restore(checkpoint, { identity: "strip" });
  mirror.replay(commit);
  assert.equal(mirror.element.node().$_attrs?.["data-tail"], "kept");
});

check("path replay does not recreate stripped identity", () => {
  const source = element(`<main @${Q1}/>`);
  const checkpoint = source.capture({ identity: "strip" });
  const commit = source.document.attrs.set({ kind: "quid", quid: Q1 }, "data-tail", "kept");
  const mirror = element(`<main/>`);
  mirror.restore(checkpoint, { identity: "strip" });
  mirror.replay(commit);
  assert.equal(mirror.document.byQuid(Q1), undefined);
});

check("initial reflection admits canonical QUID claims", () => {
  const map = element(`<main @${Q1}/>`);
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), map);
  assert.equal(binding.tree.quid, Q1);
  binding.dispose();
});

check("initial reflection rejects an active runtime collision", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const first = _reflect_document_for_runtime_test(runtime, element(`<main @${Q1}/>`));
  assert.throws(() => _reflect_document_for_runtime_test(runtime, element(`<aside @${Q1}/>`)));
  first.dispose();
});

check("valid same-epoch restore retains an exact reflected node", () => {
  const map = element(`<main @${Q1} <i @${Q2}/>/>`);
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), map);
  const child = raw_node(binding.tree.node, [0, 0]);
  const capability = map.capture({ identity: "same-epoch" });
  map.document.attrs.set({ kind: "quid", quid: Q2 }, "data-v", 1);
  map.restore(capability, { identity: "same-epoch" });
  assert.equal(raw_node(binding.tree.node, [0, 0]), child);
  binding.dispose();
});

check("a new mirror with the same QUID bytes has a new exact node", () => {
  const left = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), element(`<main @${Q1}/>`));
  const right = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), element(`<main @${Q1}/>`));
  assert.notEqual(left.tree.node, right.tree.node);
  left.dispose();
  right.dispose();
});

check("same metadata in a new mirror still supports local QUID lookup", () => {
  const source = element(`<main @${Q1}/>`);
  const mirror = element(`<main/>`);
  mirror.restore(source.capture());
  assert.equal(mirror.document.byQuid(Q1)?.$_tag, "main");
});

check("noQuid reparsing loses map identity continuity", () => {
  const source = element(`<main @${Q1}/>`);
  const wire = hson.fromNode(source.element.node()).toHson().noQuid().serialize();
  const reparsed = mustElement(hson.liveMap.fromHson(wire));
  assert.equal(reparsed.document.byQuid(Q1), undefined);
});

check("noQuid reparsing creates a different reflected exact node", () => {
  const source = element(`<main @${Q1}/>`);
  const first = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), source);
  const wire = hson.fromNode(source.element.node()).toHson().noQuid().serialize();
  const second = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), mustElement(hson.liveMap.fromHson(wire)));
  assert.notEqual(first.tree.node, second.tree.node);
  first.dispose();
  second.dispose();
});

check("structural HTML preserves QUID metadata as detached bytes", () => {
  const source = element(`<main @${Q1}/>`);
  const html = hson.fromNode(source.element.node()).toHtml().serialize();
  assert.equal(html.includes(`hson:quid="${Q1}"`), true);
  assert.equal(html.includes("epoch"), false);
});

check("ordinary application JSON does not interpret a quid key as identity metadata", () => {
  const map = hson.liveMap.fromJson({ quid: Q1, value: "kept" });
  assert.equal(map.mode, "data-object");
  assert.equal(JSON.stringify(map.root()).includes("$_meta"), false);
});

check("capture categories do not alter LiveTree clone identity semantics", () => {
  const binding = _reflect_document_for_runtime_test(_create_livetree_runtime_test_handle(), element(`<main @${Q1}/>`));
  const clone = binding.tree.cloneBranch();
  assert.notEqual(clone.quid, binding.tree.quid);
  binding.dispose();
});

process.stdout.write(`# ${checks} Locus and Reflection capture-identity closure checks passed\n`);
emit_hson_live_test_completion("locus.capture-identity-closure", checks, checks, 0);
