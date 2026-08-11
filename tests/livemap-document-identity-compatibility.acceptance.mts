// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { element, mount } from "./helpers/reflect-unit6.mts";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import { hson } from "../src/hson.ts";
import {
  _create_livetree_runtime_test_handle,
  _dispose_livetree_runtime_test_handle,
  _livetree_runtime_test_claim_count,
  _lookup_livetree_runtime_test_node,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import {
  livemap_document_identity_overlay_for,
} from "../src/api/livemap/livemap.document.identity.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import { FakeElement } from "./helpers/fake-document.mts";

const Q1 = "000002c01";
let checks = 0;

function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const target = (...path: number[]) => Object.freeze({ kind: "path" as const, path: Object.freeze(path) });
const errorCode = (code: string) => (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;

const syntheticHead = new FakeElement("head");
syntheticHead.isConnected = true;
Reflect.set(globalThis.document, "head", syntheticHead);
Reflect.set(globalThis.document, "documentElement", syntheticHead);
Reflect.set(globalThis.document, "querySelector", () => undefined);
Reflect.set(FakeElement.prototype, "querySelector", () => undefined);

check("document.byQuid remains an active-map compatibility lookup", () => {
  const map = element(`<main @${Q1}/>`);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(map.document.byQuid("000002c02"), undefined);
});

check("document.byQuid still returns detached diagnostic material", () => {
  const map = element(`<main @${Q1}/>`);
  const node = map.document.byQuid(Q1);
  if (node === undefined) throw new Error("missing byQuid fixture");
  node.$_tag = "article";
  assert.equal(map.element.node().$_tag, "main");
});

check("active raw-QUID mutation requests still lower to canonical paths", () => {
  const map = element(`<main @${Q1}/>`);
  let targetValue: unknown;
  map.commits.observe((observation) => {
    if (observation.kind === "commit") {
      const operation = observation.commit.ops[0];
      if (operation !== undefined && "domain" in operation && operation.op !== "replace-root") targetValue = operation.target;
    }
  });
  map.document.attrs.set({ kind: "quid", quid: Q1 }, "title", "active");
  assert.deepEqual(targetValue, { kind: "path", path: [], witness: { quid: Q1 } });
});

check("raw-QUID compatibility does not authorize handle reconstruction", () => {
  const map = element(`<main @${Q1}/>`);
  assert.throws(
    () => acquire_document_identity(map.document, { kind: "quid", quid: Q1 } as never),
    errorCode("INVALID_DOCUMENT_TARGET"),
  );
  assert.equal(Reflect.get(map.document, "fromQuid"), undefined);
});

check("new registration is observable through the ordinary commit feed", () => {
  const map = element(`<main/>`);
  const operations: string[] = [];
  map.commits.observe((observation) => {
    if (observation.kind === "commit") {
      const operation = observation.commit.ops[0];
      operations.push(operation !== undefined && "domain" in operation ? operation.op : "none");
    }
  });
  acquire_document_identity(map.document, target());
  assert.deepEqual(operations, ["ensure-quid"]);
});

check("existing registration publishes no feed event", () => {
  const map = element(`<main @${Q1}/>`);
  let events = 0;
  map.commits.observe(() => events += 1);
  acquire_document_identity(map.document, target());
  assert.equal(events, 0);
});

check("fragment ordinary elements support the same sparse API", () => {
  const map = hson.liveMap.fromHson(`<a/><b/>`);
  if (map.mode !== "fragment") throw new Error("expected fragment fixture");
  const handle = acquire_document_identity(map.document, target(1));
  assert.equal(handle.snap()?.$_tag, "b");
  assert.deepEqual(handle.path(), [1]);
});

check("fragment structural roots remain ineligible", () => {
  const map = hson.liveMap.fromHson(`<a/><b/>`);
  if (map.mode !== "fragment") throw new Error("expected fragment fixture");
  assert.throws(() => acquire_document_identity(map.document, target()), errorCode("DOCUMENT_IDENTITY_INELIGIBLE"));
});

check("projected object maps expose no document identity surface", () => {
  const map = hson.liveMap.fromJson({ value: 1 });
  assert.equal(Reflect.get(map, "document"), undefined);
});

check("projected array maps expose no document identity surface", () => {
  const map = hson.liveMap.fromJson([1, 2, 3]);
  assert.equal(Reflect.get(map, "document"), undefined);
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

check("unsafe debug metadata edits bypass overlay and revision reconciliation", () => {
  const map = element(`<main @${Q1}/>`);
  const handle = acquire_document_identity(map.document, target());
  const meta = map.debug.node(["main"]).meta();
  if (meta === undefined) throw new Error("missing unsafe metadata fixture");
  delete meta.quid;
  assert.equal(map.rev, 0);
  assert.equal(livemap_document_identity_overlay_for(map).pathForQuid(Q1) !== undefined, true);
  assert.equal(handle.active, false);
});

check("supported acquisition rejects a debug-created graph-overlay disagreement", () => {
  const map = element(`<main @${Q1}/>`);
  const meta = map.debug.node(["main"]).meta();
  if (meta === undefined) throw new Error("missing unsafe metadata fixture");
  delete meta.quid;
  assert.throws(() => acquire_document_identity(map.document, target()), errorCode("INVALID_DOCUMENT_IDENTITY"));
});

check("identity-free capture output strips acquired metadata intentionally", () => {
  const map = element(`<main/>`);
  acquire_document_identity(map.document, target());
  assert.equal(map.capture({ identity: "strip" }).root.$_meta?.quid, undefined);
  const restored = element(`<main/>`);
  restored.restore(map.capture({ identity: "strip" }));
  assert.equal(livemap_document_identity_overlay_for(restored).size, 0);
});

check("durable epoch replacement fences stale raw bytes from old handles", () => {
  const map = element(`<main/>`);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const handle = acquire_document_identity(map.document, target());
  map.restore(element(`<article @${Q1}/>`).capture());
  assert.equal(map.document.byQuid(Q1)?.$_tag, "article");
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
  assert.equal(handle.snap()?.$_meta?.quid, Q1);
  assert.equal(binding.tree.node.$_meta?.quid, Q1);
  assert.equal(binding.tree.quid, Q1);
  binding.dispose();
  binding.tree.remove();
  _dispose_livetree_runtime_test_handle(runtime);
});

check("reflected acquisition preserves the exact projected node and DOM", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  const projected = binding.tree.node;
  const dom = mount(projected);
  const quid = acquire_document_identity(map.document, target()).snap()?.$_meta?.quid;
  assert.equal(binding.tree.node, projected);
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
  assert.equal(_livetree_runtime_test_claim_count(runtime), 1);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, quid!), binding.tree.node);
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
  assert.equal(handle.snap()?.$_meta?.quid, Q1);
  assert.equal(binding.tree.quid, Q1);
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

check("internal identity acquisition adds no public LiveHost or remote registration action", () => {
  const map = element(`<main/>`);
  assert.equal(Reflect.get(map.document, "requestIdentity"), undefined);
  assert.equal(Reflect.get(map.document, "ensureIdentityWithQuid"), undefined);
});

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livemap.document-identity-compatibility", checks, checks, 0);
