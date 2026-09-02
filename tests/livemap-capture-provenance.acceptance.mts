// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { is_ordinary_element_node } from "../src/core/node-guards.ts";
import type { HsonNode } from "../src/core/types.ts";
import type {
  DocumentLiveMapCapture,
  DocumentLiveMap,
  LiveMapCommitObservation,
} from "../src/types/livemap.types.ts";
import {
  decode_view_state_snapshot,
  encode_view_state_snapshot,
} from "../src/api/livemap/livemap.document.view-state-codec.ts";
import { get_livemap_staged_authority } from "../src/api/livemap/livemap.authority.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";

const Q1 = "000000v81";
const Q2 = "000000v82";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.capture-provenance",
  title: "Document capture epoch provenance",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "capture", "provenance", "atomicity", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.capture-provenance");
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
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected element LiveMap");
  return map;
}

function multiNodeDocument(source: string): DocumentLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected multiNodeDocument LiveMap");
  return map;
}

function ordinaryNodes(root: HsonNode): HsonNode[] {
  const found: HsonNode[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;
    if (is_ordinary_element_node(node)) found.push(node);
    for (const item of node.$_content) if (typeof item === "object" && item !== null) stack.push(item);
  }
  return found;
}

function duplicateCapture(): DocumentLiveMapCapture<"document"> {
  const capture = multiNodeDocument(`<a @${Q1}/><b @${Q2}/>`).capture();
  const nodes = ordinaryNodes(capture.root);
  const second = nodes.find((node) => node.$_meta?.quid === Q2);
  if (nodes.length !== 2 || second?.$_meta === undefined) throw new Error("Duplicate fixture shape changed");
  second.$_meta.quid = Q1;
  return capture;
}

function errorCode(code: string): (error: unknown) => boolean {
  return (error) => typeof error === "object" && error !== null && "code" in error && error.code === code;
}

check("an exact current-epoch capability installs on its owner", () => {
  const map = element(`<main @${Q1}/>`);
  const capture = map.capture({ identity: "same-epoch" });
  map.document.attrs.set({ kind: "quid", quid: Q1 }, "data-next", 1);
  map.install(capture, { identity: "same-epoch" });
  assert.equal(map.root().$_attrs?.["data-next"], undefined);
});

check("same-epoch restore preserves the captured revision", () => {
  const map = element(`<main @${Q1}/>`);
  map.document.attrs.set({ kind: "quid", quid: Q1 }, "data-v", 1);
  const capture = map.capture({ identity: "same-epoch" });
  map.document.attrs.set({ kind: "quid", quid: Q1 }, "data-v", 2);
  map.restore(capture, { identity: "same-epoch" });
  assert.equal(map.rev, capture.rev);
});

check("a copied capture cannot claim same-epoch admission", () => {
  const map = element(`<main @${Q1}/>`);
  const copied = Object.freeze({ ...map.capture({ identity: "same-epoch" }) });
  assert.throws(() => map.install(copied, { identity: "same-epoch" }), errorCode("SAME_EPOCH_PROVENANCE_REQUIRED"));
});

check("serialized and decoded capture bytes cannot claim same-epoch admission", () => {
  const map = element(`<main @${Q1}/>`);
  const decoded = decode_view_state_snapshot(encode_view_state_snapshot(map.capture({ identity: "same-epoch" })));
  assert.throws(() => map.restore(decoded, { identity: "same-epoch" }), errorCode("SAME_EPOCH_PROVENANCE_REQUIRED"));
});

check("an exact capability is foreign to another map", () => {
  const source = element(`<main @${Q1}/>`);
  const target = element(`<main/>`);
  assert.throws(
    () => target.install(source.capture({ identity: "same-epoch" }), { identity: "same-epoch" }),
    errorCode("FOREIGN_IDENTITY_EPOCH"),
  );
});

check("durable restore replaces the local epoch and stales prior capabilities", () => {
  const map = element(`<main @${Q1}/>`);
  const stale = map.capture({ identity: "same-epoch" });
  map.restore(element(`<main @${Q2}/>`).capture(), { identity: "preserve-metadata" });
  assert.throws(() => map.restore(stale, { identity: "same-epoch" }), errorCode("STALE_IDENTITY_EPOCH"));
});

check("changed durable install replaces the local epoch", () => {
  const map = element(`<main @${Q1}/>`);
  const stale = map.capture({ identity: "same-epoch" });
  map.install(element(`<main @${Q2}/>`).capture());
  assert.throws(() => map.install(stale, { identity: "same-epoch" }), errorCode("STALE_IDENTITY_EPOCH"));
});

check("an exact-equal durable install does not replace an unchanged epoch", () => {
  const map = element(`<main @${Q1}/>`);
  const capability = map.capture({ identity: "same-epoch" });
  const commit = map.install(map.capture());
  assert.equal(commit.changed, false);
  assert.doesNotThrow(() => map.install(capability, { identity: "same-epoch" }));
});

check("the same QUID string is admissible as fresh identity in a new map", () => {
  const source = element(`<main @${Q1}/>`);
  const target = element(`<main/>`);
  target.restore(source.capture(), { identity: "preserve-metadata" });
  assert.equal(target.document.byQuid(Q1)?.$_tag, "main");
});

check("fresh metadata admission does not make a foreign capability local", () => {
  const source = element(`<main @${Q1}/>`);
  const target = element(`<main/>`);
  const capability = source.capture({ identity: "same-epoch" });
  target.restore(source.capture(), { identity: "preserve-metadata" });
  assert.throws(() => target.install(capability, { identity: "same-epoch" }), errorCode("FOREIGN_IDENTITY_EPOCH"));
});

check("mutating a capability graph invalidates its same-epoch proof", () => {
  const map = element(`<main @${Q1}/>`);
  const capture = map.capture({ identity: "same-epoch" });
  const node = ordinaryNodes(capture.root)[0];
  if (node === undefined) throw new Error("Missing fixture node");
  node.$_attrs = { changed: true };
  assert.throws(() => map.install(capture, { identity: "same-epoch" }), errorCode("IDENTITY_POLICY_MISMATCH"));
});

check("preserve-metadata captures cannot be promoted to same-epoch", () => {
  const map = element(`<main @${Q1}/>`);
  const capture = map.capture({ identity: "preserve-metadata" });
  assert.throws(() => map.install(capture, { identity: "same-epoch" }), errorCode("IDENTITY_POLICY_MISMATCH"));
});

check("identity-free captures cannot be promoted to same-epoch", () => {
  const map = element(`<main @${Q1}/>`);
  const capture = map.capture({ identity: "strip" });
  assert.throws(() => map.install(capture, { identity: "same-epoch" }), errorCode("IDENTITY_POLICY_MISMATCH"));
});

check("duplicate preserved claims have a stable admission failure", () => {
  const target = multiNodeDocument(`<c/><d/>`);
  assert.throws(
    () => target.install(duplicateCapture(), { identity: "preserve-metadata" }),
    (error: unknown) => typeof error === "object" && error !== null
      && "reasonCode" in error && error.reasonCode === "DUPLICATE_PRESERVED_CLAIMS",
  );
});

check("identity stripping removes duplicates before active overlay admission", () => {
  const target = multiNodeDocument(`<c/><d/>`);
  target.install(duplicateCapture(), { identity: "strip" });
  assert.equal(target.document.byQuid(Q1), undefined);
});

check("duplicate rejection is atomic across graph revision overlay and observations", () => {
  const target = multiNodeDocument(`<c @${Q2}/><d/>`);
  const before = target.capture();
  const observations: LiveMapCommitObservation[] = [];
  target.commits.observe((event) => observations.push(event));
  assert.throws(() => target.install(duplicateCapture(), { identity: "preserve-metadata" }));
  assert.equal(canonical_hson_graph_equal(target.root(), before.root), true);
  assert.equal(target.rev, before.rev);
  assert.equal(target.document.byQuid(Q2)?.$_tag, "c");
  assert.equal(observations.length, 0);
});

check("strict rejection is atomic", () => {
  const target = element(`<main @${Q2}/>`);
  const before = target.capture();
  assert.throws(() => target.install(element(`<main @${Q1}/>`).capture(), { identity: "reject" }));
  assert.equal(canonical_hson_graph_equal(target.root(), before.root), true);
  assert.equal(target.rev, before.rev);
});

check("a stale expected revision does not consume a valid capability", () => {
  const map = element(`<main @${Q1}/>`);
  const capability = map.capture({ identity: "same-epoch" });
  assert.throws(() => map.install(capability, { expectedRev: 9, identity: "same-epoch" }));
  assert.doesNotThrow(() => map.install(capability, { identity: "same-epoch" }));
});

check("same-epoch provenance adds no enumerable capture fields", () => {
  const capture = element(`<main @${Q1}/>`).capture({ identity: "same-epoch" });
  assert.deepEqual(Object.keys(capture), ["kind", "mode", "rev", "root"]);
});

check("same-epoch provenance is absent from JSON serialization", () => {
  const capture = element(`<main @${Q1}/>`).capture({ identity: "same-epoch" });
  const json = JSON.stringify(capture);
  assert.equal(json.includes("same-epoch"), false);
  assert.equal(json.includes("epoch"), false);
});

check("malformed capture envelopes retain a stable install failure", () => {
  const map = element(`<main/>`);
  assert.throws(
    () => map.install({ ...map.capture(), version: 99 } as never),
    (error: unknown) => typeof error === "object" && error !== null
      && "reasonCode" in error && error.reasonCode === "MALFORMED_CAPTURE_ENVELOPE",
  );
});

check("ordinary durable captures remain detached and freely serializable", () => {
  const source = element(`<main @${Q1}/>`);
  const decoded = JSON.parse(JSON.stringify(source.capture())) as DocumentLiveMapCapture<"document">;
  const target = element(`<main/>`);
  target.restore(decoded, { identity: "preserve-metadata" });
  assert.equal(target.document.byQuid(Q1)?.$_tag, "main");
});

check("staged durable installation replaces the accepted map epoch", () => {
  const map = element(`<main @${Q1}/>`);
  const stale = map.capture({ identity: "same-epoch" });
  const authority = get_livemap_staged_authority(map);
  const replacement = element(`<main @${Q2}/>`).capture();
  authority.accept(authority.prepare((draft) => draft.install(replacement)));
  assert.throws(() => map.install(stale, { identity: "same-epoch" }), errorCode("STALE_IDENTITY_EPOCH"));
});

process.stdout.write(`# ${checks} LiveMap capture-provenance checks passed\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.capture-provenance", checks, checks, 0);
