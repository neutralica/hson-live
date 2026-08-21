// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { element, mount, path, raw_node } from "./helpers/reflect-unit6.mts";
import {
  begin_livetree_materialization_profile,
  _create_livetree_for_runtime_test,
  _create_livetree_runtime_test_handle,
  _dispose_livetree_runtime_test_handle,
  _livetree_runtime_test_claim_count,
  _lookup_livetree_runtime_test_node,
  _reflect_document_for_runtime_test,
} from "../src/diagnostics/index.ts";
import {
  set_livemap_document_quid_candidate_source_for_tests,
} from "../src/api/livemap/livemap.document.registration.ts";
import { livemap_document_identity_overlay_for } from "../src/api/livemap/livemap.document.identity.ts";
import { make_locus_canonical_commit } from "../src/api/locus/locus.history.ts";
import {
  decode_locus_canonical_commit,
  decode_locus_document_commit,
} from "../src/api/locus/locus.protocol.ts";
import { PERSISTED_QUID_ALPHABET, PERSISTED_QUID_LENGTH } from "../src/core/hson-node-quid.ts";
import type { LiveMapAnyOp, LiveMapCommit } from "../src/types/livemap.types.ts";
import { FakeElement } from "./helpers/fake-document.mts";

const syntheticHead = new FakeElement("head");
syntheticHead.isConnected = true;
Reflect.set(globalThis.document, "head", syntheticHead);
Reflect.set(globalThis.document, "documentElement", syntheticHead);
Reflect.set(globalThis.document, "querySelector", () => undefined);
Reflect.set(FakeElement.prototype, "querySelector", () => undefined);

let checks = 0;
function check(name: string, run: () => void): void {
  run();
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

check("capture plus replay preserves the semantic registration", () => {
  const { map, binding } = reflected(`<main/>`);
  let commit: LiveMapCommit<LiveMapAnyOp> | undefined;
  map.commits.observe((observation) => { if (observation.kind === "commit") commit = observation.commit; });
  const quid = binding.tree.quid;
  const mirror = element(`<main/>`);
  Reflect.apply(mirror.replay, mirror, [commit]);
  assert.equal(mirror.element.node().$_meta?.quid, quid);
  close(binding);
});

check("replay never consults the map allocator", () => {
  const map = element(`<main/>`);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => { throw new Error("allocator called"); });
  map.replay({
    changed: true,
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "ensure-quid", target: path(), quid: Q1 }],
  });
  assert.equal(map.element.node().$_meta?.quid, Q1);
});

check("Locus canonical history retains path and recorded QUID", () => {
  const { map, binding } = reflected(`<main/>`);
  let commit: LiveMapCommit<LiveMapAnyOp> | undefined;
  map.commits.observe((observation) => { if (observation.kind === "commit") commit = observation.commit; });
  const quid = binding.tree.quid;
  const encoded = make_locus_canonical_commit(map, commit!, "identity-map", "identity-incarnation", 0);
  assert.deepEqual(encoded.ops[0], { domain: "graph", op: "ensure-quid", target: path(), quid });
  close(binding);
});

check("current Locus decoder accepts additive ensure-quid transport", () => {
  const encoded = {
    logicalMapId: "identity-map",
    incarnationId: "identity-incarnation",
    mode: "element",
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "ensure-quid", target: path(), quid: Q1 }],
  };
  assert.equal(Reflect.get(decode_locus_canonical_commit(encoded)!.ops[0]!, "quid"), Q1);
});

check("Locus decoder rejects malformed registration QUID", () => {
  const encoded = {
    logicalMapId: "identity-map",
    incarnationId: "identity-incarnation",
    mode: "element",
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "ensure-quid", target: path(), quid: "bad" }],
  };
  assert.equal(decode_locus_canonical_commit(encoded), undefined);
  assert.equal(decode_locus_canonical_commit({
    ...encoded,
    ops: [{ domain: "graph", op: "ensure-quid", target: path(), quid: "0000000000000001" }],
  }), undefined);
});

check("decoded Locus registration replays on a document mirror", () => {
  const encoded = decode_locus_canonical_commit({
    logicalMapId: "identity-map",
    incarnationId: "identity-incarnation",
    mode: "element",
    prevRev: 0,
    rev: 1,
    ops: [{ domain: "graph", op: "ensure-quid", target: path(), quid: Q1 }],
  })!;
  const mirror = element(`<main/>`);
  Reflect.apply(mirror.replay, mirror, [decode_locus_document_commit(encoded)]);
  assert.equal(mirror.document.byQuid(Q1)?.$_tag, "main");
});

check("new registration publishes exactly one authoritative observation", () => {
  const { map, binding } = reflected(`<main/>`);
  const origins: string[] = [];
  map.commits.observe((observation) => { if (observation.kind === "commit") origins.push(observation.origin); });
  void binding.tree.quid;
  assert.deepEqual(origins, ["authoritative"]);
  close(binding);
});

check("existing registration suppresses observations", () => {
  const { map, binding } = reflected(`<main @${Q1}/>`);
  let count = 0;
  map.commits.observe(() => count += 1);
  void binding.tree.quid;
  assert.equal(count, 0);
  close(binding);
});

check("first linked CSS demand acquires canonical identity", () => {
  const { map, binding } = reflected(`<main/>`);
  assert.ok(binding.tree.css);
  assert.equal(map.rev, 1);
  assert.equal(map.element.node().$_meta?.quid, binding.tree.quid);
  close(binding);
});

check("first linked event-registry demand acquires canonical identity", () => {
  const { map, binding } = reflected(`<main/>`);
  assert.ok(binding.tree.events);
  assert.equal(map.rev, 1);
  close(binding);
});

check("QUID-owned managers share one registration", () => {
  const { map, binding } = reflected(`<main/>`);
  void binding.tree.css;
  void binding.tree.events;
  assert.equal(map.rev, 1);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 1);
  close(binding);
});

check("attribute diagnostics remain QUID-free", () => {
  const { map, binding } = reflected(`<main/>`);
  assert.throws(() => binding.tree.attrs.must.get("missing"));
  assert.equal(map.rev, 0);
  assert.equal(binding.tree.node.$_meta?.quid, undefined);
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
  binding.tree.style.set.color("red");
  assert.equal(map.rev, 1);
  assert.equal(map.element.node().$_meta?.quid, undefined);
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
  const quid = binding.tree.quid;
  assert.equal(map.document.byQuid(quid)?.$_meta?.quid, quid);
  close(binding);
});

check("move retains runtime claim and updates canonical lookup", () => {
  const { map, binding } = reflected(`<main <a/> <b/>/>`);
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
  const { map, binding } = reflected(`<main <span/> <i/>/>`);
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
  const standalone = _create_livetree_for_runtime_test(runtime, element(`<aside/>`).element.node());
  assert.equal(standalone.quid.length, 9);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 1);
  standalone.remove();
});

check("disposed binding cannot resurrect linked identity privately", () => {
  const { map, binding } = reflected(`<main/>`);
  binding.dispose();
  assert.throws(() => binding.tree.quid, /active authority binding is unavailable/);
  assert.equal(map.rev, 0);
  binding.tree.remove();
});

_dispose_livetree_runtime_test_handle(runtime);
process.stdout.write(`LiveMap linked identity closure acceptance: ${checks}/${checks}\n`);
emit_hson_live_test_completion("livemap.linked-identity-closure", checks, checks, 0);
