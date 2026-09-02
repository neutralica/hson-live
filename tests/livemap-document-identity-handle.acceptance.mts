// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";
import { element } from "./helpers/reflect-unit6.mts";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import type { HsonNode } from "../src/core/types.ts";
import type { DocumentLiveMap, LiveMapGraphCommit } from "../src/types/livemap.types.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";

const Q1 = "000002b01";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-identity-handle",
  title: "Active-epoch document identity handle lifecycle",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "identity-handle", "lifecycle", "provenance", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-identity-handle");
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

const target = (...path: number[]) => Object.freeze({ kind: "path" as const, path: Object.freeze([0, ...path]) });

function ordinary(tag: string): HsonNode {
  return { $_tag: tag, $_content: [] };
}

function identified(source: string, ...path: number[]) {
  const map = element(source);
  const handle = acquire_document_identity(map.document, target(...path));
  return { map, handle };
}

function fixedIdentity(map: DocumentLiveMap): void {
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
}

check("a new handle resolves its initial canonical path", () => {
  const { handle } = identified(`<main <a/> <b/>/>`, 0, 1);
  assert.deepEqual(handle.path(), [0, 0, 1]);
  assert.equal(Object.isFrozen(handle.path()), true);
});

check("path results are detached immutable values", () => {
  const { handle } = identified(`<main <a/>/>`, 0, 0);
  const first = handle.path();
  const second = handle.path();
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
});

check("snap returns the current identified ordinary element", () => {
  const { handle } = identified(`<main <a id="one"/>/>`, 0, 0);
  assert.equal(handle.snap()?.$_attrs?.id, "one");
});

check("snap results do not expose the owned graph by reference", () => {
  const { map, handle } = identified(`<main <a/>/>`, 0, 0);
  const snapshot = handle.snap();
  if (snapshot === undefined) throw new Error("missing snapshot");
  snapshot.$_attrs = { changed: true };
  const content = map.document.content()[0];
  assert.equal(
    typeof content === "object" && content !== null && content.$_attrs?.changed === true,
    false,
  );
});

check("ordinary attribute mutation preserves handle activity", () => {
  const { map, handle } = identified(`<main/>`);
  map.document.attrs.set(target(), "title", "next");
  assert.equal(handle.active, true);
  assert.equal(handle.snap()?.$_attrs?.title, "next");
});

check("insertion before an identified node shifts its resolved path", () => {
  const { map, handle } = identified(`<main <a/> <b/>/>`, 0, 1);
  map.document.content.insert(target(0), 0, ordinary("i"));
  assert.deepEqual(handle.path(), [0, 0, 2]);
  assert.equal(handle.snap()?.$_tag, "b");
});

check("forward move follows the same identified node", () => {
  const { map, handle } = identified(`<main <a/> <b/> <c/>/>`, 0, 0);
  map.document.content.move(target(0), 0, 2);
  assert.deepEqual(handle.path(), [0, 0, 2]);
  assert.equal(handle.snap()?.$_tag, "a");
});

check("backward move follows the same identified node", () => {
  const { map, handle } = identified(`<main <a/> <b/> <c/>/>`, 0, 2);
  map.document.content.move(target(0), 2, 0);
  assert.deepEqual(handle.path(), [0, 0, 0]);
});

check("removal retires the handle", () => {
  const { map, handle } = identified(`<main <a/> <b/>/>`, 0, 1);
  map.document.content.remove(target(0), 1);
  assert.equal(handle.active, false);
  assert.equal(handle.path(), undefined);
  assert.equal(handle.snap(), undefined);
});

check("replacement with a fresh node retires the old handle", () => {
  const { map, handle } = identified(`<main <a/>/>`, 0, 0);
  map.document.content.replace(target(0), 0, ordinary("b"));
  assert.equal(handle.active, false);
});

check("structurally equal replacement without identity still retires", () => {
  const { map, handle } = identified(`<main <a/>/>`, 0, 0);
  const equalShape = handle.snap();
  if (equalShape === undefined) throw new Error("missing equal-shape fixture");
  delete equalShape.$_meta;
  map.document.content.replace(target(0), 0, equalShape);
  assert.equal(handle.active, false);
});

check("deliberate same-QUID replacement follows existing canonical continuity", () => {
  const { map, handle } = identified(`<main <a/>/>`, 0, 0);
  const replacement = handle.snap();
  if (replacement === undefined) throw new Error("missing replacement fixture");
  replacement.$_attrs = { replaced: true };
  map.document.content.replace(target(0), 0, replacement);
  assert.equal(handle.active, true);
  assert.equal(handle.snap()?.$_attrs?.replaced, true);
});

check("changed durable install replaces the owner epoch", () => {
  const map = element(`<main/>`);
  fixedIdentity(map);
  const handle = acquire_document_identity(map.document, target());
  map.install(element(`<article @${Q1}/>`).capture());
  assert.equal(handle.active, false);
});

check("durable restore replaces the owner epoch even with the same bytes", () => {
  const map = element(`<main/>`);
  fixedIdentity(map);
  const handle = acquire_document_identity(map.document, target());
  map.restore(element(`<main @${Q1}/>`).capture());
  assert.equal(handle.active, false);
});

check("same-epoch install preserves a present identity", () => {
  const { map, handle } = identified(`<main/>`);
  const capture = map.capture({ identity: "same-epoch" });
  map.document.attrs.set(target(), "changed", true);
  map.install(capture, { identity: "same-epoch" });
  assert.equal(handle.active, true);
  assert.equal(handle.snap()?.$_attrs?.changed, undefined);
});

check("same-epoch restore preserves a present identity", () => {
  const { map, handle } = identified(`<main/>`);
  const capture = map.capture({ identity: "same-epoch" });
  map.document.attrs.set(target(), "changed", true);
  map.restore(capture, { identity: "same-epoch" });
  assert.equal(handle.active, true);
});

check("copied capture bytes cannot claim handle continuity", () => {
  const { map, handle } = identified(`<main/>`);
  const copied = Object.freeze({ ...map.capture({ identity: "same-epoch" }) });
  assert.throws(() => map.install(copied, { identity: "same-epoch" }));
  assert.equal(handle.active, true);
});

check("another map carrying the same QUID cannot satisfy this handle", () => {
  const map = element(`<main/>`);
  fixedIdentity(map);
  const handle = acquire_document_identity(map.document, target());
  const foreign = element(`<article @${Q1}/>`);
  assert.equal(foreign.document.byQuid(Q1)?.$_tag, "article");
  assert.equal(handle.snap()?.$_tag, "main");
});

check("multiple handles may refer to one canonical identity", () => {
  const map = element(`<main/>`);
  const first = acquire_document_identity(map.document, target());
  const second = acquire_document_identity(map.document, target());
  assert.equal(first.active, true);
  assert.equal(second.active, true);
  assert.equal(first.snap()?.$_meta?.quid, second.snap()?.$_meta?.quid);
});

check("disposing one handle leaves another handle active", () => {
  const map = element(`<main/>`);
  const first = acquire_document_identity(map.document, target());
  const second = acquire_document_identity(map.document, target());
  first.dispose();
  assert.equal(first.active, false);
  assert.equal(second.active, true);
});

check("handle disposal does not remove canonical QUID metadata", () => {
  const map = element(`<main/>`);
  const handle = acquire_document_identity(map.document, target());
  const quid = handle.snap()?.$_meta?.quid;
  handle.dispose();
  assert.equal(map.document.byQuid(quid!)?.$_tag, "main");
  assert.equal(map.rev, 1);
});

check("disposed handles remain inactive after later map changes", () => {
  const { map, handle } = identified(`<main/>`);
  handle.dispose();
  map.document.attrs.set(target(), "title", "later");
  assert.equal(handle.active, false);
  assert.equal(handle.snap(), undefined);
});

check("the handle surface exposes no raw QUID", () => {
  const { handle } = identified(`<main/>`);
  assert.deepEqual(Object.keys(handle), ["active", "path", "snap", "dispose"]);
  assert.equal(Reflect.get(handle, "quid"), undefined);
});

check("replayed root replacement invalidates the prior owner epoch", () => {
  const source = element(`<main/>`);
  fixedIdentity(source);
  acquire_document_identity(source.document, target());
  let replacement: LiveMapGraphCommit | undefined;
  source.commits.observe((observation) => {
    if (observation.kind === "commit") {
      const operation = observation.commit.ops[0];
      if (operation !== undefined && "domain" in operation && operation.op === "replace-root") {
        replacement = observation.commit as LiveMapGraphCommit;
      }
    }
  });
  source.install(element(`<article @${Q1}/>`).capture());

  const mirror = element(`<main/>`);
  fixedIdentity(mirror);
  const handle = acquire_document_identity(mirror.document, target());
  mirror.replay(replacement!);
  assert.equal(handle.active, false);
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
emit_hson_live_test_completion("livemap.document-identity-handle", checks, checks, 0);
