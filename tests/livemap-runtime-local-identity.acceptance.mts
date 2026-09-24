// @hson-live-external-test
import assert from "node:assert/strict";
import { hson, hsonLiveMap } from "../src/index.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { acquire_document_identity, acquire_projected_identity } from "./helpers/livemap-identity-internal.mts";
import { element, mount, path } from "./helpers/mirror-unit6.mts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { livemap_document_identity_overlay_for } from "../src/api/livemap/livemap.document.identity.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";
import { set_livemap_document_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.document.registration.ts";
import { set_livemap_projected_quid_candidate_source_for_tests } from "../src/api/livemap/livemap.projected.identity-handle.ts";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.ts";
import { register_echo_document_authority, unregister_echo_document_authority } from "../src/api/echo/echo.document-authority-registry.ts";
import {
  _create_livetree_runtime_test_handle,
  _reflect_document_for_runtime_test,
} from "../src/_tests/diagnostics-internal.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { get_el_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.runtime-local-identity",
  title: "Non-revisioned map-local identity acquisition",
  category: "LiveMap",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["identity", "mirror", "echo", "authority", "revision"]),
});

const events = create_test_event_emitter("livemap.runtime-local-identity");
let checks = 0;
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) {
    events.diagnostic(name, "assertion", error instanceof Error ? error.message : String(error));
    events.case_end(name, "fail"); events.terminal("fail"); throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const docTarget = (...segments: number[]) => Object.freeze({ kind: "path" as const, path: validate_document_path([0, ...segments]) });
const Q1 = "00004b001";
const Q2 = "00004b002";

check("document identity changes only runtime overlay and issued ledger", () => {
  const map = element(`<main/>`);
  const before = map.root();
  const issued = livemap_identity_epoch_accounting(map).issued;
  let commits = 0;
  map.commits.observe((event) => { if (event.kind === "commit") commits += 1; });
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const handle = acquire_document_identity(map.document, docTarget());
  assert.equal(map.rev, 0);
  assert.equal(commits, 0);
  assert.equal(canonical_hson_graph_equal(before, map.root()), true);
  assert.deepEqual(livemap_document_identity_overlay_for(map.document).pathForQuid(Q1), [0]);
  assert.equal(handle.snap()?.$_meta?.quid, Q1);
  assert.equal(map.document.byQuid(Q1)?.$_meta?.quid, Q1);
  assert.equal(livemap_identity_epoch_accounting(map).issued, issued + 1);
});

check("projected identity changes no value, graph, revision, or commit", () => {
  const map = hsonLiveMap.fromJson({ child: {} });
  const before = map.root();
  const value = map.snap();
  let commits = 0;
  map.commits.observe((event) => { if (event.kind === "commit") commits += 1; });
  set_livemap_projected_quid_candidate_source_for_tests(map, () => Q1);
  const handle = acquire_projected_identity(map, ["child"]);
  assert.equal(handle.active, true);
  assert.equal(map.rev, 0);
  assert.equal(commits, 0);
  assert.deepEqual(map.snap(), value);
  assert.equal(canonical_hson_graph_equal(before, map.root()), true);
  assert.deepEqual(internal_livemap_aggregate_authority(map).resolveQuid(Q1)?.path, ["child"]);
});

check("prepared graph transition rejects identity-generation drift", () => {
  const map = hsonLiveMap.fromJson({ child: {}, value: 0 });
  const authority = internal_livemap_aggregate_authority(map);
  const library = authority.libraries()[0]!;
  const prepared = authority.prepare([{ target: authority.target(library, ["value"]), kind: "set", value: 1 }]);
  set_livemap_projected_quid_candidate_source_for_tests(map, () => Q1);
  acquire_projected_identity(map, ["child"]);
  assert.throws(() => authority.accept(prepared), /stale/i);
  assert.equal(map.rev, 0);
  assert.equal(map.snap(["value"]), 0);
  assert.deepEqual(authority.resolveQuid(Q1)?.path, ["child"]);
  authority.commit([{ target: authority.target(library, ["value"]), kind: "set", value: 1 }]);
  assert.equal(map.rev, 1);
  assert.deepEqual(authority.resolveQuid(Q1)?.path, ["child"]);
});

check("prepared document transition rejects an intervening local identity claim", () => {
  const map = element("<main <a/>/>");
  const authority = internal_livemap_aggregate_authority(map);
  const library = authority.libraries()[0]!;
  const write = Object.freeze({
    target: authority.target(library, [0]),
    kind: "graph" as const,
    operation: Object.freeze({ domain: "graph" as const, op: "set-attr" as const, target: docTarget(), name: "title", value: "next" }),
  });
  const prepared = authority.prepare([write]);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  acquire_document_identity(map.document, docTarget(0, 0));
  assert.throws(() => authority.accept(prepared), /stale/i);
  assert.equal(map.rev, 0);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "a");
  assert.equal(map.document.byQuid(Q1)?.$_attrs?.title, undefined);
  authority.commit([write]);
  assert.equal(map.rev, 1);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "a");
});

check("failed local candidates leave map revision, overlay, and issued ledger unchanged", () => {
  const map = element("<main <a/> <b/>/>");
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  acquire_document_identity(map.document, docTarget(0, 0));
  const issued = livemap_identity_epoch_accounting(map).issued;
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  assert.throws(() => acquire_document_identity(map.document, docTarget(0, 1)), /allocate an available document QUID/i);
  assert.equal(map.rev, 0);
  assert.equal(livemap_identity_epoch_accounting(map).issued, issued);
  assert.equal(livemap_document_identity_overlay_for(map.document).quidAtPath(docTarget(0, 1).path), undefined);
  assert.throws(() => acquire_document_identity(map.document, docTarget(9)));
  assert.equal(map.rev, 0);
  assert.equal(livemap_identity_epoch_accounting(map).issued, issued);
  assert.equal(livemap_document_identity_overlay_for(map.document).quidAtPath(docTarget(0, 1).path), undefined);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q2);
  acquire_document_identity(map.document, docTarget(0, 1));
  assert.equal(map.document.byQuid(Q2)?.$_tag, "b");
  assert.equal(map.rev, 0);
});

check("participant realization failure rolls back the local claim and ledger", () => {
  const map = element("<main/>");
  const authority = internal_livemap_aggregate_authority(map);
  const library = authority.libraries()[0]!;
  let claimed = false;
  let released = false;
  const participant = Object.freeze({
    preflight: () => Object.freeze({
      apply: () => { claimed = true; return Object.freeze([]); },
      rollback: () => { claimed = false; },
      release: () => { released = true; },
    }),
    realize: () => { throw new Error("forced realization failure"); },
    rollbackRealization: () => { claimed = false; },
  });
  assert.throws(() => authority.acquireLocalDocumentIdentity(library, docTarget().path, Q1, participant), /forced realization failure/);
  assert.equal(claimed, false);
  assert.equal(released, true);
  assert.equal(map.rev, 0);
  assert.equal(livemap_document_identity_overlay_for(map.document).quidAtPath(docTarget().path), undefined);
  assert.equal(livemap_identity_epoch_accounting(map).issued, 0);
  authority.acquireLocalDocumentIdentity(library, docTarget().path, Q1);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(map.rev, 0);
});

check("same-runtime document capture restores an overlay-only acquired QUID", () => {
  const map = element("<main/>");
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  acquire_document_identity(map.document, docTarget());
  const capture = map.capture({ identity: "same-epoch" });
  assert.equal(JSON.stringify(capture.root).includes('"quid"'), false);
  map.document.attrs.set(path(), "title", "changed");
  assert.equal(map.rev, 1);
  map.restore(capture, { identity: "same-epoch" });
  assert.equal(map.rev, 0);
  assert.equal(map.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(livemap_identity_epoch_accounting(map).issued, 1);
});

check("graph transition before demand resolves the new current path", () => {
  const map = hsonLiveMap.fromJson({ first: {}, second: {} });
  map.at([]).asObject()!.renameKey("first", "moved");
  assert.equal(map.rev, 1);
  set_livemap_projected_quid_candidate_source_for_tests(map, () => Q2);
  assert.throws(() => acquire_projected_identity(map, ["first"]));
  acquire_projected_identity(map, ["moved"]);
  assert.equal(map.rev, 1);
  assert.deepEqual(internal_livemap_aggregate_authority(map).resolveQuid(Q2)?.path, ["moved"]);
});

check("local Mirror demand installs one QUID in map, LiveTree, and DOM", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const map = element(`<main <a/> <b/>/>`);
  const binding = _reflect_document_for_runtime_test(runtime, map);
  mount(binding.tree.node);
  let commits = 0;
  map.commits.observe((event) => { if (event.kind === "commit") commits += 1; });
  const tree = binding.tree.find.byTag("a")!;
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => Q1);
  const quid = tree.quid;
  assert.equal(quid, Q1);
  assert.equal(map.rev, 0);
  assert.equal(commits, 0);
  assert.equal(map.document.byQuid(quid)?.$_tag, "a");
  assert.equal(get_el_for_node(tree.node)?.getAttribute("hson:quid"), quid);
  map.document.content.move(path(0), 0, 1);
  assert.equal(map.rev, 1);
  assert.equal(binding.status, "active");
  assert.equal(tree.quid, quid);
  assert.deepEqual(livemap_document_identity_overlay_for(map.document).pathForQuid(quid), [0, 0, 1]);
  binding.dispose();
});

process.stdout.write(`1..${checks}\n`);
events.terminal("pass");
