// @hson-live-external-test
import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import type { DocumentLiveMap } from "../src/types/livemap.types.ts";
import type { HsonNode } from "../src/core/types.ts";

const Q1 = "000000v71";
const Q2 = "000000v72";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.capture-categories",
  title: "Document capture identity categories",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "capture", "admission", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.capture-categories");
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

function isNode(value: HsonNode["$_content"][number]): value is HsonNode {
  return typeof value === "object" && value !== null && "$_tag" in value;
}

function captureText(map: DocumentLiveMap): string {
  const semanticRoot = map.document.content()[0];
  if (semanticRoot === undefined || !isNode(semanticRoot)) throw new Error("Expected node document content.");
  return hson.fromNode(semanticRoot).toHson().serialize();
}

check("default capture remains exact durable metadata", () => {
  const capture = element(`<main @${Q1}/>`).capture();
  assert.equal(JSON.stringify(capture).includes(Q1), true);
});

check("explicit preserve-metadata capture retains QUIDs", () => {
  const capture = element(`<main @${Q1} <i @${Q2}/>/>`).capture({ identity: "preserve-metadata" });
  assert.equal(JSON.stringify(capture).includes(Q1), true);
  assert.equal(JSON.stringify(capture).includes(Q2), true);
});

check("same-epoch capture retains canonical QUID metadata", () => {
  const capture = element(`<main @${Q1}/>`).capture({ identity: "same-epoch" });
  assert.equal(JSON.stringify(capture).includes(Q1), true);
});

check("identity-free capture strips every QUID", () => {
  const capture = element(`<main @${Q1} <i @${Q2}/>/>`).capture({ identity: "strip" });
  assert.equal(JSON.stringify(capture).includes(Q1), false);
  assert.equal(JSON.stringify(capture).includes(Q2), false);
});

check("identity-free capture does not mutate the source", () => {
  const map = element(`<main @${Q1}/>`);
  map.capture({ identity: "strip" });
  assert.equal(map.document.byQuid(Q1)?.$_tag, "main");
});

check("identity-free capture preserves the exact revision", () => {
  const map = element(`<main @${Q1}/>`);
  map.document.attrs.set({ kind: "quid", quid: Q1 }, "data-v", 1);
  assert.equal(map.capture({ identity: "strip" }).rev, 1);
});

check("identity-free capture is canonically unequal when QUIDs were removed", () => {
  const map = element(`<main @${Q1}/>`);
  assert.equal(canonical_hson_graph_equal(map.capture().root, map.capture({ identity: "strip" }).root), false);
});

check("QUID-free capture categories remain canonically equal", () => {
  const map = element(`<main/>`);
  assert.equal(canonical_hson_graph_equal(map.capture().root, map.capture({ identity: "strip" }).root), true);
});

check("capture roots are detached from the owned graph", () => {
  const map = element(`<main @${Q1}/>`);
  const capture = map.capture();
  capture.root.$_content.length = 0;
  assert.equal(map.document.byQuid(Q1)?.$_tag, "main");
});

check("identity-free capture roots are detached", () => {
  const map = element(`<main @${Q1}/>`);
  const capture = map.capture({ identity: "strip" });
  capture.root.$_content.length = 0;
  assert.equal(map.root().$_tag, "_hson_root");
  const semanticRoot = map.document.content()[0];
  assert.equal(isNode(semanticRoot) ? semanticRoot.$_tag : undefined, "main");
});

check("capture categories never mint into a QUID-free source", () => {
  const map = element(`<main <i/>/>`);
  map.capture();
  map.capture({ identity: "same-epoch" });
  map.capture({ identity: "preserve-metadata" });
  map.capture({ identity: "strip" });
  assert.equal(JSON.stringify(map.root()).includes("quid"), false);
});

check("default install preserves metadata as fresh map-local claims", () => {
  const target = element(`<main/>`);
  target.install(element(`<main @${Q1}/>`).capture());
  assert.equal(target.document.byQuid(Q1)?.$_tag, "main");
});

check("explicit durable install preserves metadata as fresh map-local claims", () => {
  const target = element(`<main/>`);
  target.install(element(`<main @${Q1}/>`).capture(), { identity: "preserve-metadata" });
  assert.equal(target.document.byQuid(Q1)?.$_tag, "main");
});

check("identity-free install publishes a QUID-free graph", () => {
  const target = element(`<main @${Q2}/>`);
  target.install(element(`<main @${Q1}/>`).capture(), { identity: "strip" });
  assert.equal(target.document.byQuid(Q1), undefined);
  assert.equal(target.document.byQuid(Q2), undefined);
});

check("identity-free restore preserves revision but no prior identity", () => {
  const source = element(`<main @${Q1}/>`);
  const target = element(`<main @${Q2}/>`);
  target.restore(Object.freeze({ ...source.capture(), rev: 9 }), { identity: "strip" });
  assert.equal(target.rev, 9);
  assert.equal(target.document.byQuid(Q1), undefined);
});

check("strict external rejection accepts QUID-free captures", () => {
  const target = element(`<main @${Q2}/>`);
  target.install(element(`<main/>`).capture(), { identity: "reject" });
  assert.equal(target.document.byQuid(Q2), undefined);
});

check("strict external rejection refuses QUID-bearing captures", () => {
  const target = element(`<main/>`);
  assert.throws(
    () => target.install(element(`<main @${Q1}/>`).capture(), { identity: "reject" }),
    (error: unknown) => typeof error === "object" && error !== null
      && "reasonCode" in error && error.reasonCode === "IDENTITY_POLICY_MISMATCH",
  );
});

check("unsupported capture categories fail structurally", () => {
  const map = element(`<main/>`);
  assert.throws(
    () => map.capture({ identity: "future" } as never),
    (error: unknown) => typeof error === "object" && error !== null
      && "code" in error && error.code === "UNSUPPORTED_CAPTURE_CATEGORY",
  );
});

check("unsupported admission categories fail structurally", () => {
  const map = element(`<main/>`);
  assert.throws(
    () => map.install(map.capture(), { identity: "future" } as never),
    (error: unknown) => typeof error === "object" && error !== null
      && "code" in error && error.code === "UNSUPPORTED_CAPTURE_CATEGORY",
  );
});

check("ordinary Hson remains an exact metadata-preserving format", () => {
  const source = element(`<main @${Q1}/>`);
  assert.equal(canonical_hson_graph_equal(element(captureText(source)).root(), source.root()), true);
});

check("noQuid Hson remains an identity-free projection", () => {
  const source = element(`<main @${Q1}/>`);
  const semanticRoot = source.document.content()[0];
  if (semanticRoot === undefined || !isNode(semanticRoot)) throw new Error("Expected node document content.");
  const wire = hson.fromNode(semanticRoot).toHson().noQuid().serialize();
  const reparsed = element(wire);
  assert.equal(reparsed.document.byQuid(Q1), undefined);
  assert.equal(canonical_hson_graph_equal(reparsed.root(), source.root()), false);
});

check("multiNodeDocument capture categories preserve mode and strip identity", () => {
  const map = multiNodeDocument(`<a @${Q1}/><b @${Q2}/>`);
  const capture = map.capture({ identity: "strip" });
  assert.equal(capture.mode, "document");
  assert.equal(JSON.stringify(capture.root).includes("quid"), false);
});

process.stdout.write(`# ${checks} LiveMap capture-category checks passed\n`);
testEvents.terminal("pass");
