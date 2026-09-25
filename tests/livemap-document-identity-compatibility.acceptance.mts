// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, mount, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { Hson, hsonLiveMap } from "../src/index.ts";
import {
  _create_livetree_runtime_test_handle,
  _dispose_livetree_runtime_test_handle,
  _livetree_runtime_test_claim_count,
  _lookup_livetree_runtime_test_node,
  _reflect_document_for_runtime_test,
} from "../src/_tests/diagnostics-internal.ts";
import {
  livemap_document_identity_overlay_for,
} from "../src/api/livemap/livemap.document.identity.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import { FakeElement } from "./helpers/fake-document.mts";

const Q1 = "000002c01";
const Q2 = "000002c02";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-identity-compatibility",
  title: "Raw-QUID boundary and reflected continuity closure",
  category: "LiveMap",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "quid", "identity-handle", "boundary", "binding", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-identity-compatibility");
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

const documentTarget = (...path: number[]) => Object.freeze({ kind: "path" as const, path: Object.freeze(path) });
const target = (...path: number[]) => documentTarget(0, ...path);
function canonical_main_meta(map: ReturnType<typeof element>) {
  const authority = internal_livemap_aggregate_authority(registry_for_document_library(map));
  const library = authority.libraries()[0];
  if (library === undefined) throw new Error("Missing document library");
  const main = authority.root(library).$_content[0];
  if (typeof main !== "object" || main === null) throw new Error("Missing document root element");
  return main.$_meta;
}
const errorCode = (code: string) => (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;

const syntheticHead = new FakeElement("head");
syntheticHead.isConnected = true;
Reflect.set(globalThis.document, "head", syntheticHead);
Reflect.set(globalThis.document, "documentElement", syntheticHead);
Reflect.set(globalThis.document, "querySelector", () => undefined);
Reflect.set(FakeElement.prototype, "querySelector", () => undefined);

check("document.byQuid remains an active-map observational lookup", () => {
  const map = element(`<main @${Q1}/>`);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(map.document.byQuid("000002c02"), undefined);
});

check("document.byQuid still returns detached diagnostic material", () => {
  const map = element(`<main @${Q1}/>`);
  const node = map.document.byQuid(Q1);
  if (node === undefined) throw new Error("missing byQuid fixture");
  node.$_tag = "article";
  assert.equal((map.root().$_content[0] as { $_tag?: string } | undefined)?.$_tag, "main");
});

check("raw-QUID mutation requests are rejected", () => {
  const map = element(`<main @${Q1}/>`);
  let targetValue: unknown;
  map.commits.observe((observation) => {
    if (observation.kind === "commit") {
      const operation = observation.commit.ops[0];
      if (operation !== undefined && "domain" in operation && operation.op !== "replace-root") targetValue = operation.target;
    }
  });
  assert.throws(
    () => map.document.attrs.set({ kind: "quid", quid: Q1 } as never, "title", "active"),
    errorCode("INVALID_DOCUMENT_TARGET"),
  );
  assert.equal(targetValue, undefined);
});

check("raw-QUID observation does not authorize handle reconstruction", () => {
  const map = element(`<main @${Q1}/>`);
  assert.throws(
    () => acquire_document_identity(map.document, { kind: "quid", quid: Q1 } as never),
    errorCode("INVALID_DOCUMENT_TARGET"),
  );
  assert.equal(Reflect.get(map.document, "fromQuid"), undefined);
});

check("new registration is absent from the ordinary commit feed", () => {
  const map = element(`<main/>`);
  const operations: string[] = [];
  map.commits.observe((observation) => {
    if (observation.kind === "commit") {
      const operation = observation.commit.ops[0];
      operations.push(operation !== undefined && "domain" in operation ? operation.op : "none");
    }
  });
  acquire_document_identity(map.document, target());
  assert.deepEqual(operations, []);
});

check("existing registration publishes no feed event", () => {
  const map = element(`<main @${Q1}/>`);
  let events = 0;
  map.commits.observe(() => events += 1);
  acquire_document_identity(map.document, target());
  assert.equal(events, 0);
});

check("multiNodeDocument ordinary elements support the same sparse API", () => {
  const map = element(`<a/><b/>`);
  if (map.mode !== "document") throw new Error("expected multiNodeDocument fixture");
  const handle = acquire_document_identity(map.document, documentTarget(1));
  assert.equal(handle.snap()?.$_tag, "b");
  assert.deepEqual(handle.path(), [1]);
});

check("multiNodeDocument structural roots remain ineligible", () => {
  const map = element(`<a/><b/>`);
  if (map.mode !== "document") throw new Error("expected multiNodeDocument fixture");
  assert.throws(() => acquire_document_identity(map.document, documentTarget()), errorCode("DOCUMENT_IDENTITY_INELIGIBLE"));
});

check("data object maps expose no document identity surface", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { value: 1 }, schema: Hson.schema`<type "data" content <value "number">>` } });
  assert.equal(Reflect.get(map.lib("state"), "document"), undefined);
});

check("data libraries with arrays expose no document identity surface", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { values: [1, 2, 3] }, schema: Hson.schema`<type "data" content <values "any">>` } });
  assert.equal(Reflect.get(map.lib("state"), "document"), undefined);
});

check("a large QUID-free document retains an empty sparse overlay", () => {
  const children = Array.from({ length: 1_000 }, (_, index) => `<n data=${index}/>`).join("");
  const map = element(`<main ${children}/>`);
  assert.equal(livemap_document_identity_overlay_for(map).size, 0);
  assert.equal(map.rev, 0);
});

check("one acquisition adds only one sparse overlay entry", () => {
  const children = Array.from({ length: 1_000 }, (_, index) => `<n data=${index}/>`).join("");
  const map = element(`<main ${children}/>`);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  acquire_document_identity(map.document, target(0, 500));
  assert.equal(livemap_document_identity_overlay_for(map).size, 1);
  assert.equal(map.document.byQuid(Q1)?.$_attrs?.data, "500");
});

check("local overlay remains authoritative when legacy node metadata disappears", () => {
  const map = element(`<main @${Q1}/>`);
  const handle = acquire_document_identity(map.document, target());
  const meta = canonical_main_meta(map);
  if (meta === undefined) throw new Error("missing unsafe metadata fixture");
  delete meta.quid;
  assert.equal(map.rev, 0);
  assert.equal(livemap_document_identity_overlay_for(map).pathForQuid(Q1) !== undefined, true);
  assert.equal(handle.active, true);
});

check("supported acquisition rejects an internally-created graph-overlay disagreement", () => {
  const map = element(`<main @${Q1}/>`);
  const meta = canonical_main_meta(map);
  if (meta === undefined) throw new Error("missing unsafe metadata fixture");
  meta.quid = Q2;
  assert.throws(() => acquire_document_identity(map.document, target()), errorCode("INVALID_DOCUMENT_IDENTITY"));
});

check("identity-free capture output strips acquired metadata intentionally", () => {
  const map = element(`<main/>`);
  acquire_document_identity(map.document, target());
  assert.equal(
    (map.capture({ identity: "strip" }).root.$_content[0] as { $_meta?: { quid?: string } } | undefined)?.$_meta?.quid,
    undefined,
  );
  const restored = element(`<main/>`);
  registry_for_document_library(restored).restore(registry_for_document_library(map).capture());
  assert.equal(livemap_document_identity_overlay_for(restored).size, 0);
});

check("durable epoch replacement fences stale raw bytes from old handles", () => {
  const map = element(`<main/>`);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const handle = acquire_document_identity(map.document, target());
  registry_for_document_library(map).restore(registry_for_document_library(element(`<main @${Q1}/>`)).capture());
  assert.equal(map.document.byQuid(Q1), undefined);
  assert.equal(handle.active, false);
});

check("reflected construction remains QUID-free before explicit demand", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  assert.equal(binding.tree.node.$_meta?.quid, undefined);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  binding.dispose();
  binding.tree.remove();
  _dispose_livetree_runtime_test_handle(runtime);
});

check("internal acquisition coordinates with an active Reflection participant", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main/>`);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const handle = acquire_document_identity(map.document, target());
  const projected = binding.tree.node.$_content[0];
  if (projected === undefined || projected === null || typeof projected !== "object") throw new Error("missing projected element");
  assert.equal(handle.snap()?.$_meta?.quid, Q1);
  assert.equal(projected.$_meta?.quid, Q1);
  binding.dispose();
  binding.tree.remove();
  _dispose_livetree_runtime_test_handle(runtime);
});

check("reflected acquisition preserves the exact projected node and DOM", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const projected = binding.tree.node.$_content[0];
  if (projected === undefined || projected === null || typeof projected !== "object") throw new Error("missing projected element");
  const dom = mount(projected);
  const quid = acquire_document_identity(map.document, target()).snap()?.$_meta?.quid;
  assert.equal(binding.tree.node.$_content[0], projected);
  assert.equal(mount(binding.tree.node), dom);
  assert.equal(dom.getAttribute("hson:quid"), quid);
  binding.dispose();
  binding.tree.remove();
  _dispose_livetree_runtime_test_handle(runtime);
});

check("reflected acquisition installs one protected runtime claim", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const quid = acquire_document_identity(map.document, target()).snap()?.$_meta?.quid;
  const projected = binding.tree.node.$_content[0];
  if (projected === undefined || projected === null || typeof projected !== "object") throw new Error("missing projected element");
  assert.equal(_livetree_runtime_test_claim_count(runtime), 1);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, quid!), projected);
  binding.dispose();
  binding.tree.remove();
  _dispose_livetree_runtime_test_handle(runtime);
});

check("existing reflected canonical identity is reused without a commit", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main @${Q1}/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  let events = 0;
  map.commits.observe(() => events += 1);
  const handle = acquire_document_identity(map.document, target());
  const projected = binding.tree.node.$_content[0];
  if (projected === undefined || projected === null || typeof projected !== "object") throw new Error("missing projected element");
  assert.equal(handle.snap()?.$_meta?.quid, Q1);
  assert.equal(projected.$_meta?.quid, Q1);
  assert.equal(events, 0);
  binding.dispose();
  binding.tree.remove();
  _dispose_livetree_runtime_test_handle(runtime);
});

check("raw QUID strings remain diagnostic rather than application identity", () => {
  const map = element(`<main/>`);
  const handle = acquire_document_identity(map.document, target());
  const raw = handle.snap()?.$_meta?.quid;
  assert.equal(typeof raw, "string");
  assert.equal(Reflect.get(handle, "quid"), undefined);
  assert.equal(Reflect.get(map.document, "fromQuid"), undefined);
});

check("internal identity acquisition adds no public Locus or remote registration action", () => {
  const map = element(`<main/>`);
  assert.equal(Reflect.get(map.document, "requestIdentity"), undefined);
  assert.equal(Reflect.get(map.document, "ensureIdentityWithQuid"), undefined);
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
