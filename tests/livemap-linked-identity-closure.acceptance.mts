// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element, mount, path, raw_node, registry_for_document_library } from "./helpers/mirror-unit6.mts";
import {
  begin_livetree_materialization_profile,
  _create_livetree_for_runtime_test,
  _create_livetree_runtime_test_handle,
  _dispose_livetree_runtime_test_handle,
  _livetree_runtime_test_claim_count,
  _lookup_livetree_runtime_test_node,
  _reflect_document_for_runtime_test,
} from "../src/_tests/diagnostics-internal.ts";
import { livemap_document_identity_overlay_for } from "../src/api/livemap/livemap.document.identity.ts";
import { PERSISTED_QUID_ALPHABET, PERSISTED_QUID_LENGTH } from "../src/core/hson-node-quid.ts";
import { FakeElement } from "./helpers/fake-document.mts";

const syntheticHead = new FakeElement("head");
syntheticHead.isConnected = true;
Reflect.set(globalThis.document, "head", syntheticHead);
Reflect.set(globalThis.document, "documentElement", syntheticHead);
Reflect.set(globalThis.document, "querySelector", () => undefined);
Reflect.set(FakeElement.prototype, "querySelector", () => undefined);

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.linked-identity-closure",
  title: "Linked identity replay and resource closure",
  category: "LiveMap",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["document", "binding", "quid", "runtime", "locus", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.linked-identity-closure");
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

const Q1 = "000002301";
const runtime = _create_livetree_runtime_test_handle();
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

check("registry capture keeps linked identity local without a registration commit", () => {
  const { map, binding } = reflected(`<main/>`);
  const registry = registry_for_document_library(map);
  let commits = 0;
  registry.commits.observe(() => { commits += 1; });
  const quid = authoredRoot(binding).quid;
  const exact = registry.capture();
  registry.restore(exact);
  assert.equal(commits, 0);
  assert.equal(map.document.byQuid(quid), undefined);
  const mirror = element(`<main/>`);
  registry_for_document_library(mirror).restore(registry.capture());
  assert.equal(mirror.document.byQuid(quid), undefined);
  close(binding);
});









check("new registration publishes no authoritative observation", () => {
  const { map, binding } = reflected(`<main/>`);
  const origins: string[] = [];
  map.commits.observe((observation) => { if (observation.kind === "commit") origins.push(observation.origin); });
  void authoredRoot(binding).quid;
  assert.deepEqual(origins, []);
  close(binding);
});

check("existing registration suppresses observations", () => {
  const { map, binding } = reflected(`<main @${Q1}/>`);
  let count = 0;
  map.commits.observe(() => count += 1);
  void authoredRoot(binding).quid;
  assert.equal(count, 0);
  close(binding);
});

check("first linked CSS demand acquires local identity", () => {
  const { map, binding } = reflected(`<main/>`);
  const root = authoredRoot(binding);
  assert.ok(root.css);
  assert.equal(map.rev, 0);
  assert.equal((map.root().$_content[0] as { $_meta?: { quid?: string } }).$_meta?.quid, undefined);
  close(binding);
});

check("linked TreeEvents registration remains realization-local", () => {
  const { map, binding } = reflected(`<main/>`);
  const root = authoredRoot(binding);
  const subject = root.node;
  const initialRevision = map.rev;
  let publications = 0;
  const stop = map.commits.observe(() => { publications += 1; });
  let calls = 0;

  assert.equal(subject.$_meta?.quid, undefined);
  const events = root.events;
  const off = events.on("probe", () => { calls += 1; });
  assert.equal(subject.$_meta?.quid, undefined);
  assert.equal(map.rev, initialRevision);
  assert.equal(publications, 0);

  events.emit("probe");
  assert.equal(calls, 1);
  off();
  events.emit("probe");
  assert.equal(calls, 1);
  assert.equal(subject.$_meta?.quid, undefined);
  assert.equal(map.rev, initialRevision);
  assert.equal(publications, 0);

  stop();
  close(binding);
  assert.equal(subject.$_meta?.quid, undefined);
  assert.equal(map.rev, initialRevision);
});

check("QUID-scoped CSS remains the sole identity registration before TreeEvents access", () => {
  const { map, binding } = reflected(`<main/>`);
  const root = authoredRoot(binding);
  void root.css;
  const revisionAfterCss = map.rev;
  assert.equal(revisionAfterCss, 0);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 1);
  void root.events;
  assert.equal(map.rev, revisionAfterCss);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 1);
  close(binding);
});

check("attribute diagnostics remain QUID-free", () => {
  const { map, binding } = reflected(`<main/>`);
  const root = authoredRoot(binding);
  assert.throws(() => root.attrs.must.get("missing"));
  assert.equal(map.rev, 0);
  assert.equal(root.node.$_meta?.quid, undefined);
  close(binding);
});

check("linked traversal remains QUID-free", () => {
  const { map, binding } = reflected(`<main <span/>/>`);
  assert.equal(binding.tree.find.byTag("span")?.node.$_tag, "span");
  assert.equal(map.rev, 0);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  close(binding);
});

check("inline style remains a canonical attribute mutation without identity", () => {
  const { map, binding } = reflected(`<main/>`);
  const root = authoredRoot(binding);
  root.style.set.color("red");
  assert.equal(map.rev, 1);
  assert.equal(map.root().$_meta?.quid, undefined);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  close(binding);
});

check("find.byQuid is lookup-only and never mints", () => {
  const { map, binding } = reflected(`<main <span/>/>`);
  assert.equal(binding.tree.find.byQuid(Q1), undefined);
  assert.equal(map.rev, 0);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  close(binding);
});

check("document.byQuid resolves through the canonical sparse overlay", () => {
  const { map, binding } = reflected(`<main/>`);
  const quid = authoredRoot(binding).quid;
  assert.equal(map.document.byQuid(quid)?.$_meta?.quid, quid);
  close(binding);
});

check("move retains runtime claim and updates canonical lookup", () => {
  const { map, binding } = reflected(`<main <a/> <a/>/>`);
  const child = binding.tree.find.byTag("a")!;
  const quid = child.quid;
  const node = child.node;
  map.document.content.move(path(0), 0, 1);
  assert.equal(raw_node(binding.tree.node, [0, 1]), node);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, quid), node);
  assert.equal(map.document.byQuid(quid)?.$_tag, "a");
  close(binding);
});

check("canonical removal releases acquired runtime ownership", () => {
  const { map, binding } = reflected(`<main <span/> <span/>/>`);
  const quid = binding.tree.find.byTag("span")!.quid;
  map.document.content.remove(path(0), 0);
  assert.equal(_lookup_livetree_runtime_test_node(runtime, quid), undefined);
  assert.equal(map.document.byQuid(quid), undefined);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  close(binding);
});

check("QUID-free unrelated graph retains an empty overlay and runtime", () => {
  const sparseRuntime = _create_livetree_runtime_test_handle();
  const children = Array.from({ length: 64 }, (_, index) => `<i data-n="${index}"/>`).join(" ");
  const map = element(`<main ${children}/>`);
  const binding = _reflect_document_for_runtime_test(sparseRuntime, map);
  const profile = begin_livetree_materialization_profile();
  void binding.tree.findAll.byTag("i");
  const result = profile.stop();
  assert.equal(livemap_document_identity_overlay_for(map.document).size, 0);
  assert.equal(_livetree_runtime_test_claim_count(sparseRuntime), 0);
  assert.equal(result.quidRegistryWrites, 0);
  binding.dispose();
  binding.tree.remove();
  _dispose_livetree_runtime_test_handle(sparseRuntime);
});

check("QUID encoding uses the strict canonical width and alphabet", () => {
  assert.equal(PERSISTED_QUID_LENGTH, 9);
  assert.equal(PERSISTED_QUID_ALPHABET, "0123456789abcdefghjkmnpqrstvwxyz");
});

check("standalone LiveTree retains standalone mint authority", () => {
  const document = element(`<aside/>`).root();
  const authored = document.$_content[0];
  if (authored === undefined || authored === null || typeof authored !== "object") throw new Error("Expected authored element");
  const standalone = _create_livetree_for_runtime_test(runtime, authored);
  assert.equal(standalone.quid.length, 9);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 1);
  standalone.remove();
});

check("disposed binding cannot resurrect linked identity privately", () => {
  const { map, binding } = reflected(`<main/>`);
  const root = authoredRoot(binding);
  binding.dispose();
  assert.throws(() => root.quid, /active authority binding is unavailable/);
  assert.equal(map.rev, 0);
  binding.tree.remove();
});

_dispose_livetree_runtime_test_handle(runtime);
process.stdout.write(`LiveMap linked identity closure acceptance: ${checks}/${checks}\n`);
testEvents.terminal("pass");
