import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import {
  canonical_hson_graph_difference,
  canonical_hson_graph_equal,
} from "../src/core/canonical-hson-equal.ts";
import {
  decode_view_state_snapshot,
  encode_view_state_snapshot,
} from "../src/api/livemap/livemap.document.view-state-codec.ts";
import type {
  DocumentLiveMapCapture,
  DocumentLiveMap,
  LiveMapCommitObservation,
} from "../src/types/livemap.types.ts";
import type { HsonNode } from "../src/core/types.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.quid-canonical-state",
  title: "LiveMap QUID canonical-state contract",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "canonical-graph", "revision", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.quid-canonical-state");
let checks = 0;
function check(name: string, fn: () => void): void {

  testEvents.case_begin(name, name);
  try {
    fn();
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

const Q1 = "000000qa1";
const Q2 = "000000qa2";

function element(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error(`Expected element, observed ${map.mode}`);
  return map;
}

function withRevision(
  capture: DocumentLiveMapCapture<"document">,
  rev: number,
): DocumentLiveMapCapture<"document"> {
  return Object.freeze({ ...capture, rev });
}

function quids(root: HsonNode): string[] {
  const result: string[] = [];
  const visit = (node: HsonNode): void => {
    if (node.$_meta?.quid !== undefined) result.push(node.$_meta.quid);
    for (const item of node.$_content) {
      if (typeof item === "object" && item !== null) visit(item);
    }
  };
  visit(root);
  return result;
}

check("otherwise identical graphs with different QUIDs are strictly unequal", () => {
  const left = element(`<main @${Q1}/>`).root();
  const right = element(`<main @${Q2}/>`).root();
  assert.equal(canonical_hson_graph_equal(left, right), false);
});

check("replacing a QUID reports the dedicated strict difference", () => {
  const difference = canonical_hson_graph_difference(
    element(`<main @${Q1}/>`).root(),
    element(`<main @${Q2}/>`).root(),
  );
  assert.equal(difference?.kind, "quid-difference");
  assert.match(difference?.path ?? "", /\$_meta\.quid$/);
});

check("adding QUID metadata is an exact canonical graph change", () => {
  assert.equal(
    canonical_hson_graph_equal(element(`<main/>`).root(), element(`<main @${Q1}/>`).root()),
    false,
  );
});

check("adding the first metadata bag reports metadata presence", () => {
  assert.equal(
    canonical_hson_graph_difference(element(`<main/>`).root(), element(`<main @${Q1}/>`).root())?.kind,
    "metadata-presence",
  );
});

check("removing QUID metadata is an exact canonical graph change", () => {
  assert.equal(
    canonical_hson_graph_equal(element(`<main @${Q1}/>`).root(), element(`<main/>`).root()),
    false,
  );
});

check("removing the only QUID reports metadata presence", () => {
  assert.equal(
    canonical_hson_graph_difference(element(`<main @${Q1}/>`).root(), element(`<main/>`).root())?.kind,
    "metadata-presence",
  );
});

check("QUID addition through canonical install advances the ordinary revision", () => {
  const target = element(`<main/>`);
  const commit = target.install(element(`<main @${Q1}/>`).capture());
  assert.deepEqual([commit.changed, commit.prevRev, commit.rev, target.rev], [true, 0, 1, 1]);
  assert.equal(target.document.byQuid(Q1)?.$_tag, "main");
});

check("QUID replacement through canonical install advances the ordinary revision", () => {
  const target = element(`<main @${Q1}/>`);
  const commit = target.install(element(`<main @${Q2}/>`).capture());
  assert.deepEqual([commit.changed, commit.prevRev, commit.rev, target.rev], [true, 0, 1, 1]);
  assert.equal(target.document.byQuid(Q1), undefined);
  assert.equal(target.document.byQuid(Q2)?.$_tag, "main");
});

check("QUID removal through canonical install advances the ordinary revision", () => {
  const target = element(`<main @${Q1}/>`);
  const commit = target.install(element(`<main/>`).capture());
  assert.deepEqual([commit.changed, commit.prevRev, commit.rev, target.rev], [true, 0, 1, 1]);
  assert.equal(target.document.byQuid(Q1), undefined);
});

check("QUID-only canonical install publishes in the ordinary commit stream", () => {
  const target = element(`<main @${Q1}/>`);
  const events: LiveMapCommitObservation[] = [];
  target.commits.observe((event) => events.push(event));
  const commit = target.install(element(`<main @${Q2}/>`).capture());
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { kind: "commit", origin: "authoritative", commit });
});

check("QUID-only canonical install is represented by an ordinary replace-root op", () => {
  const target = element(`<main @${Q1}/>`);
  const commit = target.install(element(`<main @${Q2}/>`).capture());
  assert.equal(commit.ops.length, 1);
  assert.equal(commit.ops[0]?.op, "replace-root");
  assert.equal(commit.ops[0]?.op === "replace-root" && commit.ops[0].root.$_content.length > 0, true);
});

check("strict equality prevents QUID-only install from being declared a no-op", () => {
  const target = element(`<main @${Q1}/>`);
  const commit = target.install(element(`<main @${Q2}/>`).capture());
  assert.equal(commit.changed, true);
  assert.equal(commit.ops.length, 1);
});

check("installing an exact-equal QUID-bearing graph remains a no-op", () => {
  const target = element(`<main @${Q1}/>`);
  const commit = target.install(target.capture());
  assert.deepEqual(commit, { changed: false, prevRev: 0, rev: 0, ops: [] });
});

check("exact capture preserves admitted QUID metadata", () => {
  const map = element(`<main @${Q1} <span @${Q2}/>/>`);
  const capture = map.capture();
  assert.deepEqual(quids(capture.root), [Q1, Q2]);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(map.document.byQuid(Q2)?.$_tag, "span");
});

check("exact restore preserves QUID metadata and the named revision", () => {
  const source = element(`<main @${Q1} <span @${Q2}/>/>`);
  const capture = withRevision(source.capture(), 7);
  const target = element(`<main/>`);
  target.restore(capture);
  assert.equal(target.rev, 7);
  assert.equal(target.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(target.document.byQuid(Q2)?.$_tag, "span");
});

check("exact restore does not normalize a supplied QUID to an old local value", () => {
  const target = element(`<main @${Q1}/>`);
  target.restore(withRevision(element(`<main @${Q2}/>`).capture(), 4));
  assert.equal(target.document.byQuid(Q1), undefined);
  assert.equal(target.document.byQuid(Q2)?.$_tag, "main");
});

check("exact replay preserves a QUID addition", () => {
  const source = element(`<main/>`);
  const target = element(`<main/>`);
  const commit = source.install(element(`<main @${Q1}/>`).capture());
  target.replay(commit);
  assert.equal(target.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(canonical_hson_graph_equal(target.root(), source.root()), true);
});

check("exact replay preserves a QUID replacement", () => {
  const source = element(`<main @${Q1}/>`);
  const target = element(`<main @${Q1}/>`);
  const commit = source.install(element(`<main @${Q2}/>`).capture());
  target.replay(commit);
  assert.equal(target.document.byQuid(Q1), undefined);
  assert.equal(target.document.byQuid(Q2)?.$_tag, "main");
});

check("view-state persistence preserves exact QUID metadata", () => {
  const source = element(`<main @${Q1} <span @${Q2}/>/>`);
  const decoded = decode_view_state_snapshot(encode_view_state_snapshot(source.capture()));
  assert.equal(canonical_hson_graph_equal(decoded.root, source.root()), true);
  const target = element(`<main/>`);
  target.restore(decoded);
  assert.equal(target.document.byQuid(Q2)?.$_tag, "span");
});

check("ordinary Hson serialization preserves QUID metadata exactly", () => {
  const source = element(`<main @${Q1} <span @${Q2}/>/>`);
  const semanticRoot = source.document.byQuid(Q1);
  assert.ok(semanticRoot);
  const wire = hson.fromNode(semanticRoot).toHson().serialize();
  const reparsed = element(wire);
  assert.equal(canonical_hson_graph_equal(reparsed.root(), source.root()), true);
});

check("noQuid serialization omits QUIDs without mutating the source graph", () => {
  const source = element(`<main @${Q1} <span @${Q2}/>/>`);
  const before = source.capture();
  const semanticRoot = source.document.byQuid(Q1);
  assert.ok(semanticRoot);
  const wire = hson.fromNode(semanticRoot).toHson().noQuid().serialize();
  assert.equal(wire.includes(Q1), false);
  assert.equal(wire.includes(Q2), false);
  assert.equal(canonical_hson_graph_equal(source.root(), before.root), true);
  assert.equal(source.document.byQuid(Q2)?.$_tag, "span");
});

check("reparsing noQuid output yields an identity-stripped, not exact-equal, graph", () => {
  const source = element(`<main @${Q1} <span @${Q2}/>/>`);
  const semanticRoot = source.document.byQuid(Q1);
  assert.ok(semanticRoot);
  const wire = hson.fromNode(semanticRoot).toHson().noQuid().serialize();
  const stripped = element(wire);
  assert.equal(canonical_hson_graph_equal(stripped.root(), source.root()), false);
  assert.equal(canonical_hson_graph_difference(stripped.root(), source.root())?.kind, "metadata-presence");
  assert.equal(stripped.document.byQuid(Q1), undefined);
});

process.stdout.write(`# ${checks} LiveMap QUID canonical-state checks passed\n`);
testEvents.terminal("pass");
