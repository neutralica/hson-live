// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, mount, path, projected_element, raw_node } from "./helpers/mirror-unit6.mts";
import {
  _create_livetree_for_runtime_test,
  _create_livetree_runtime_test_handle,
  _dispose_livetree_runtime_test_handle,
  _is_livetree_node_disposed,
  _livetree_runtime_test_claim_count,
  _lookup_livetree_runtime_test_node,
  _reflect_document_for_runtime_test,
} from "../src/_tests/diagnostics-internal.ts";
import { LiveMapDocumentIdentityRegistrationError } from "../src/api/livemap/livemap.error.ts";
import {
  LIVEMAP_DOCUMENT_QUID_MINT_RETRY_LIMIT,
  set_livemap_document_quid_candidate_source_for_tests,
} from "../src/api/livemap/livemap.document.registration.ts";
import {
  LIVETREE_LINKED_IDENTITY_REQUIRED_ERROR_CODE,
  unregister_document_binding_node,
} from "../src/api/livetree/lifecycle/document-binding-state.ts";
import { FakeElement } from "./helpers/fake-document.mts";

const syntheticHead = new FakeElement("head");
syntheticHead.isConnected = true;
Reflect.set(globalThis.document, "head", syntheticHead);
Reflect.set(globalThis.document, "documentElement", syntheticHead);
Reflect.set(globalThis.document, "querySelector", () => undefined);
Reflect.set(FakeElement.prototype, "querySelector", () => undefined);

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.linked-identity-atomicity",
  title: "Linked identity preflight and atomicity",
  category: "LiveMap",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "binding", "quid", "runtime", "atomicity", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.linked-identity-atomicity");
let checks = 0;
let runtime: ReturnType<typeof _create_livetree_runtime_test_handle>;
function check(name: string, run: () => void): void {
  runtime = _create_livetree_runtime_test_handle();
  try {

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
  } finally {
    _dispose_livetree_runtime_test_handle(runtime);
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const Q1 = "000002201";
const Q2 = "000002202";
const Q3 = "000002203";
function reflected(source: string) {
  const map = element(source);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  return { map, binding };
}
function close(binding: ReturnType<typeof reflected>["binding"]): void {
  binding.dispose();
  binding.tree.remove();
}
function authoredRoot(binding: ReturnType<typeof reflected>["binding"]) {
  const node = binding.tree.node.$_content[0];
  if (node === undefined || node === null || typeof node !== "object") throw new Error("Expected authored document root");
  return _create_livetree_for_runtime_test(runtime, node).adoptRoots(binding.tree.hostRootNode());
}
function source(...values: string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

check("runtime candidate collision retries inside map authority", () => {
  const occupied = _create_livetree_for_runtime_test(runtime, projected_element(`<aside @${Q1}/>`));
  const { map, binding } = reflected(`<main/>`);
  set_livemap_document_quid_candidate_source_for_tests(map.document, source(Q1, Q2));
  assert.equal(authoredRoot(binding).quid, Q2);
  close(binding);
  occupied.remove();
});

check("staged canonical collision retries before participant preflight", () => {
  const { map, binding } = reflected(`<main <span @${Q1}/>/>`);
  set_livemap_document_quid_candidate_source_for_tests(map.document, source(Q1, Q2));
  assert.equal(authoredRoot(binding).quid, Q2);
  close(binding);
});

check("deterministic candidate source selects the first available value", () => {
  const { map, binding } = reflected(`<main/>`);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q3);
  assert.equal(authoredRoot(binding).quid, Q3);
  close(binding);
});

check("collision exhaustion is stable and bounded", () => {
  const { map, binding } = reflected(`<main <span @${Q1}/>/>`);
  const root = authoredRoot(binding);
  let calls = 0;
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => { calls += 1; return Q1; });
  assert.throws(() => root.quid, (cause: unknown) =>
    cause instanceof LiveMapDocumentIdentityRegistrationError
      && cause.code === "LIVEMAP_IDENTITY_ALLOCATOR_EXHAUSTED");
  assert.equal(calls, LIVEMAP_DOCUMENT_QUID_MINT_RETRY_LIMIT);
  close(binding);
});

check("malformed deterministic candidates exhaust without publication", () => {
  const { map, binding } = reflected(`<main/>`);
  const root = authoredRoot(binding);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => "bad");
  assert.throws(() => root.quid, LiveMapDocumentIdentityRegistrationError);
  assert.equal(map.rev, 0);
  assert.equal(map.root().$_meta?.quid, undefined);
  close(binding);
});

check("DOM preflight failure leaves canonical state unchanged", () => {
  const { map, binding } = reflected(`<main/>`);
  const root = authoredRoot(binding);
  const dom = mount(root.node);
  dom.setAttribute("hson:quid", Q1);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q2);
  assert.throws(() => root.quid, (cause: unknown) => Reflect.get(cause as object, "code") === "DOCUMENT_MIRROR_QUID_MISMATCH");
  assert.equal(map.rev, 0);
  assert.equal(map.document.byQuid(Q2), undefined);
  close(binding);
});

check("private projected metadata inconsistency fails before commit", () => {
  const { map, binding } = reflected(`<main/>`);
  const root = authoredRoot(binding);
  root.node.$_meta = { quid: Q1 };
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q2);
  assert.throws(() => root.quid, (cause: unknown) => Reflect.get(cause as object, "code") === "DOCUMENT_MIRROR_QUID_MISMATCH");
  assert.equal(map.rev, 0);
  close(binding);
});

check("missing exact correspondence rejects a stale linked handle", () => {
  const { map, binding } = reflected(`<main/>`);
  const root = authoredRoot(binding);
  const registrationOwner = (awaitOwner => awaitOwner)(
    // The exact owner is intentionally opaque; a foreign owner removes nothing.
    {},
  );
  unregister_document_binding_node(root.node, registrationOwner);
  binding.dispose();
  assert.throws(() => root.quid, (cause: unknown) => Reflect.get(cause as object, "code") === LIVETREE_LINKED_IDENTITY_REQUIRED_ERROR_CODE);
  assert.equal(map.rev, 0);
  binding.tree.remove();
});







check("two local acquisitions remain distinct without a replay commit", () => {
  const { map, binding } = reflected(`<main <a/> <b/>/>`);
  set_livemap_document_quid_candidate_source_for_tests(map.document, source(Q1, Q2));
  assert.equal(binding.tree.find.byTag("a")!.quid, Q1);
  assert.equal(binding.tree.find.byTag("b")!.quid, Q2);
  assert.equal(map.rev, 0);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 2);
  assert.notEqual(raw_node(binding.tree.node, [0, 0]).$_meta?.quid, raw_node(binding.tree.node, [0, 1]).$_meta?.quid);
  close(binding);
});

check("local acquisition followed by move maps QUID to the final path", () => {
  const { map, binding } = reflected(`<main <a/> <a/>/>`);
  const moved = raw_node(binding.tree.node, [0, 0]);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  assert.equal(binding.tree.find.byTag("a")!.quid, Q1);
  map.document.content.move(path(0), 0, 1);
  assert.equal(raw_node(binding.tree.node, [0, 1]), moved);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "a");
  close(binding);
});

check("move followed by local acquisition resolves the moved path", () => {
  const { map, binding } = reflected(`<main <a/> <a/>/>`);
  const moved = raw_node(binding.tree.node, [0, 0]);
  map.document.content.move(path(0), 0, 1);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  assert.equal(_create_livetree_for_runtime_test(runtime, moved).adoptRoots(binding.tree.hostRootNode()).quid, Q1);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), moved);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "a");
  close(binding);
});

check("local acquisition followed by removal publishes no retired runtime claim", () => {
  const { map, binding } = reflected(`<main <a/> <a/>/>`);
  const removed = raw_node(binding.tree.node, [0, 0]);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  assert.equal(binding.tree.find.byTag("a")!.quid, Q1);
  map.document.content.remove(path(0), 0);
  assert.equal(map.document.byQuid(Q1), undefined);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), undefined);
  assert.equal(_is_livetree_node_disposed(removed), true);
  close(binding);
});



check("root preflight retains exact projected and DOM objects", () => {
  const { map, binding } = reflected(`<main/>`);
  const root = authoredRoot(binding);
  const node = root.node;
  const dom = mount(node);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  void root.quid;
  assert.equal(root.node, node);
  assert.equal(mount(node), dom);
  close(binding);
});

check("descendant preflight retains exact projected node", () => {
  const { map, binding } = reflected(`<main <span/>/>`);
  const child = binding.tree.find.byTag("span")!;
  const node = child.node;
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q2);
  assert.equal(child.quid, Q2);
  assert.equal(child.node, node);
  close(binding);
});





process.stdout.write(`LiveMap linked identity atomicity acceptance: ${checks}/${checks}\n`);
testEvents.terminal("pass");
