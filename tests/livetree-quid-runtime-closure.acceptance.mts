import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import {
  _create_livetree_for_runtime_test,
  _create_livetree_runtime_test_handle,
  _livetree_runtime_test_claim_count,
  _livetree_runtime_test_issued_count,
  _livetree_runtime_test_resource_counts,
  _lookup_livetree_runtime_test_node,
  _own_livetree_runtime_test_disposable,
  _project_livetree_for_runtime_test,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import { assign_hson_node_quid, PERSISTED_QUID_ALPHABET, PERSISTED_QUID_LENGTH } from "../src/core/hson-node-quid.ts";
import type { HsonNode } from "../src/core/types.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import type { LifecycleResourceKind } from "../src/api/livetree/managers/lifecycle-registry.ts";
import { element } from "./helpers/reflect-unit6.mts";
import { FakeElement } from "./helpers/fake-document.mts";

const Q1 = "000000w01";
const Q2 = "000000w02";

const syntheticHead = new FakeElement("head");
syntheticHead.isConnected = true;
Reflect.set(globalThis.document, "head", syntheticHead);
Reflect.set(globalThis.document, "documentElement", syntheticHead);
Reflect.set(globalThis.document, "querySelector", () => undefined);
Reflect.set(FakeElement.prototype, "querySelector", () => undefined);
const projectionRuntime = _create_livetree_runtime_test_handle();

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.quid-runtime-closure",
  title: "LiveTree QUID runtime closure",
  category: "LiveTree",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["quid", "runtime", "lifecycle", "Reflect", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livetree.quid-runtime-closure");
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

function node(tag = "main", quid?: string, children: HsonNode[] = []): HsonNode {
  const value: HsonNode = { $_tag: tag, $_content: children };
  if (quid !== undefined) assign_hson_node_quid(value, quid);
  return value;
}

function reuse(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && Reflect.get(error, "code") === "LIVETREE_QUID_REUSE";
}

function reflectedSubject(
  runtime: ReturnType<typeof _create_livetree_runtime_test_handle>,
  binding: ReturnType<typeof _reflect_document_for_runtime_test>,
) {
  const subject = binding.tree.node.$_content[0];
  if (subject === undefined || subject === null || typeof subject !== "object") throw new Error("Expected authored document root");
  return _create_livetree_for_runtime_test(runtime, subject).adoptRoots(binding.tree.hostRootNode());
}

check("projection writes active QUID metadata to DOM", () => {
  const tree = _create_livetree_for_runtime_test(projectionRuntime, node("main", Q1));
  const dom = _project_livetree_for_runtime_test(projectionRuntime, tree, globalThis.document) as unknown as FakeElement;
  assert.equal(dom.getAttribute("hson:quid"), Q1);
  tree.remove();
});

check("terminal destruction scrubs DOM QUID metadata", () => {
  const tree = _create_livetree_for_runtime_test(projectionRuntime, node("main", Q2));
  const dom = _project_livetree_for_runtime_test(projectionRuntime, tree, globalThis.document) as unknown as FakeElement;
  tree.remove();
  assert.equal(dom.getAttribute("hson:quid"), null);
});

check("terminal destruction removes runtime lookup but retains issued state", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1)).remove();
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), undefined);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 1);
});

check("find.byQuid resolves an active descendant", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const child = node("span", Q2);
  const root = _create_livetree_for_runtime_test(runtime, node("main", Q1, [child]));
  assert.equal(root.find.byQuid(Q2)?.node, child);
});

check("find.byQuid becomes absent after descendant removal", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const root = _create_livetree_for_runtime_test(runtime, node("main", Q1, [node("span", Q2)]));
  const child = root.find.byQuid(Q2);
  assert.ok(child);
  child.remove();
  assert.equal(root.find.byQuid(Q2), undefined);
});

check("retired descendant bytes cannot retarget find.byQuid", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const root = _create_livetree_for_runtime_test(runtime, node("main", Q1, [node("span", Q2)]));
  root.find.must.byQuid(Q2).remove();
  assert.throws(() => _create_livetree_for_runtime_test(runtime, node("em", Q2)), reuse);
  assert.equal(root.find.byQuid(Q2), undefined);
});

function assertResourceDrain(kind: LifecycleResourceKind): void {
  const runtime = _create_livetree_runtime_test_handle();
  const tree = _create_livetree_for_runtime_test(runtime, node("main", Q1));
  let disposed = 0;
  _own_livetree_runtime_test_disposable(runtime, Q1, () => { disposed += 1; }, kind);
  tree.remove();
  assert.equal(disposed, 1);
  assert.equal(_livetree_runtime_test_resource_counts(runtime, Q1).total, 0);
}

check("binding resources drain before identity retirement", () => assertResourceDrain("binding"));
check("listener resources drain before identity retirement", () => assertResourceDrain("listener"));
check("tree-event resources drain before identity retirement", () => assertResourceDrain("tree-event"));
check("resize-observer resources drain before identity retirement", () => assertResourceDrain("resize-observer"));
check("other resources drain before identity retirement", () => assertResourceDrain("other"));

check("all resource kinds are accounted before destruction", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1));
  const kinds: readonly LifecycleResourceKind[] = ["binding", "listener", "tree-event", "resize-observer", "other"];
  for (const kind of kinds) _own_livetree_runtime_test_disposable(runtime, Q1, () => undefined, kind);
  const counts = _livetree_runtime_test_resource_counts(runtime, Q1);
  assert.equal(counts.total, 5);
  assert.deepEqual([counts.binding, counts.listener, counts.treeEvent, counts.resizeObserver, counts.other], [1, 1, 1, 1, 1]);
});

check("failed re-admission creates no resource owner", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1)).remove();
  assert.throws(() => _create_livetree_for_runtime_test(runtime, node("main", Q1)), reuse);
  assert.equal(_livetree_runtime_test_resource_counts(runtime, Q1).total, 0);
});

check("QUID-free linked projection retains Q=0 and I=0", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element("<main/>");
  const binding = _reflect_document_for_runtime_test(runtime, map);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 0);
  binding.dispose();
  binding.tree.remove();
});

check("linked canonical acquisition enters the runtime issued ledger", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element("<main/>");
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  assert.equal(reflectedSubject(runtime, binding).quid, Q1);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 1);
  binding.dispose();
  binding.tree.remove();
});

check("linked allocator retries a retired runtime candidate", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("old", Q1)).remove();
  const map = element("<main/>");
  let calls = 0;
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => ++calls === 1 ? Q1 : Q2);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  assert.equal(reflectedSubject(runtime, binding).quid, Q2);
  assert.equal(calls, 2);
  binding.dispose();
  binding.tree.remove();
});

check("failed linked candidate leaves no pending reservation", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("old", Q1)).remove();
  const map = element("<main/>");
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  assert.throws(() => reflectedSubject(runtime, binding).quid, (error: unknown) => error instanceof Error && error.message.includes("32 secure attempts"));
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 1);
  binding.dispose();
  binding.tree.remove();
});

check("clone never copies the source QUID lineage", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const source = _create_livetree_for_runtime_test(runtime, node("main", Q1));
  const clone = source.cloneBranch();
  assert.notEqual(clone.quid, Q1);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 2);
});

check("detach retains the same active registry claim", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const tree = _create_livetree_for_runtime_test(runtime, node("main", Q1));
  tree.detach();
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), tree.node);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 1);
});

check("encoding uses the strict canonical length and alphabet", () => {
  assert.equal(PERSISTED_QUID_LENGTH, 9);
  assert.equal(PERSISTED_QUID_ALPHABET, "0123456789abcdefghjkmnpqrstvwxyz");
  const legacyRuntime = _create_livetree_runtime_test_handle();
  const legacyNode: HsonNode = { $_tag: "legacy", $_meta: { quid: "0000000000000001" }, $_content: [] };
  assert.throws(() => _create_livetree_for_runtime_test(legacyRuntime, legacyNode), /invalid persisted QUID/i);
  assert.equal(_livetree_runtime_test_claim_count(legacyRuntime), 0);
});

check("withdrawn public identity acquisition methods remain absent", () => {
  const map = element("<main/>");
  assert.equal("ensureIdentity" in map, false);
  assert.equal("ensureIdentity" in map.document, false);
});

testEvents.terminal("pass");
emit_hson_live_test_completion("livetree.quid-runtime-closure", checks, checks, 0);
