// @hson-live-external-test
import assert from "node:assert/strict";
import { create_test_event_emitter } from "./test-events.mjs";
import { element } from "./helpers/mirror-unit6.mts";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import {
  is_persisted_quid,
  PERSISTED_QUID_ALPHABET,
  PERSISTED_QUID_LENGTH,
} from "../src/core/hson-node-quid.ts";
import {
  LIVEMAP_DOCUMENT_QUID_MINT_RETRY_LIMIT,
  set_livemap_document_quid_candidate_source_for_tests,
} from "../src/api/livemap/livemap.document.registration.ts";
import {
  decode_view_state_snapshot,
  encode_view_state_snapshot,
} from "../src/api/livemap/livemap.document.view-state-codec.ts";
import type { LiveMapGraphCommit } from "../src/types/livemap.types.ts";
import { validate_document_path } from "../src/api/livemap/livemap.document.path.ts";

const Q1 = "000002a01";
const Q2 = "000002a02";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.document-identity-acquisition",
  title: "Internal sparse document identity acquisition",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["document", "quid", "identity-handle", "authority", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("livemap.document-identity-acquisition");
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
const errorCode = (code: string) => (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;

check("document identity acquisition is absent from the public façade", () => {
  const map = element(`<main/>`);
  assert.equal(Reflect.get(map.document, "ensureIdentity"), undefined);
  assert.equal(Reflect.get(map.document, "retain"), undefined);
});

check("an eligible ordinary element acquires an active handle", () => {
  const map = element(`<main/>`);
  const handle = acquire_document_identity(map.document, target());
  assert.equal(handle.active, true);
  assert.equal(handle.snap()?.$_tag, "main");
});

check("new acquisition creates one valid local QUID without canonical metadata", () => {
  const map = element(`<main/>`);
  const handle = acquire_document_identity(map.document, target());
  assert.equal(is_persisted_quid(handle.snap()?.$_meta?.quid), true);
  assert.equal(canonical_hson_graph_equal(map.root(), element(`<main/>`).root()), true);
});

check("new acquisition leaves the ordinary revision unchanged", () => {
  const map = element(`<main/>`);
  acquire_document_identity(map.document, target());
  assert.equal(map.rev, 0);
});

check("new acquisition publishes no application commit", () => {
  const map = element(`<main/>`);
  let commit: LiveMapGraphCommit | undefined;
  map.commits.observe((observation) => {
    if (observation.kind === "commit") commit = observation.commit as LiveMapGraphCommit;
  });
  acquire_document_identity(map.document, target());
  assert.equal(commit, undefined);
});

check("identity acquisition leaves the application operation stream empty", () => {
  const map = element(`<main/>`);
  let operations = 0;
  map.commits.observe((observation) => {
    if (observation.kind === "commit") operations += observation.commit.ops.length;
  });
  acquire_document_identity(map.document, target());
  assert.equal(operations, 0);
});

check("the sparse overlay resolves newly registered metadata", () => {
  const map = element(`<main/>`);
  const quid = acquire_document_identity(map.document, target()).snap()?.$_meta?.quid;
  assert.equal(typeof quid, "string");
  assert.equal(map.document.byQuid(quid!)?.$_tag, "main");
});

check("registration preserves strict canonical graph equality", () => {
  const map = element(`<main/>`);
  const before = map.root();
  acquire_document_identity(map.document, target());
  assert.equal(canonical_hson_graph_equal(before, map.root()), true);
});

check("existing valid identity is reused without revision or commit", () => {
  const map = element(`<main @${Q1}/>`);
  let observations = 0;
  map.commits.observe(() => observations += 1);
  const handle = acquire_document_identity(map.document, target());
  assert.equal(handle.snap()?.$_meta?.quid, Q1);
  assert.equal(map.rev, 0);
  assert.equal(observations, 0);
});

check("a second acquisition is an exact no-op", () => {
  const map = element(`<main/>`);
  const first = acquire_document_identity(map.document, target()).snap()?.$_meta?.quid;
  const revision = map.rev;
  const second = acquire_document_identity(map.document, target()).snap()?.$_meta?.quid;
  assert.equal(second, first);
  assert.equal(map.rev, revision);
});

check("portable capture leaves acquired identity in the source runtime", () => {
  const map = element(`<main/>`);
  const quid = acquire_document_identity(map.document, target()).snap()?.$_meta?.quid;
  const restored = element(`<main/>`);
  restored.restore(map.capture());
  assert.equal(restored.document.byQuid(quid!), undefined);
  assert.equal(map.document.byQuid(quid!)?.$_tag, "main");
});

check("public replay rejects legacy recorded registration without minting", () => {
  const commit: LiveMapGraphCommit = {
    changed: true, prevRev: 0, rev: 1,
    ops: [{ domain: "graph", op: "ensure-quid", target: { kind: "path", path: validate_document_path([0]) }, quid: Q1 }],
  };
  const mirror = element(`<main/>`);
  set_livemap_document_quid_candidate_source_for_tests(mirror.document, () => {
    throw new Error("replay minted");
  });
  assert.throws(() => mirror.replay(commit));
  assert.equal(mirror.document.byQuid(Q1), undefined);
  assert.equal(mirror.rev, 0);
});

check("view-state persistence excludes acquired runtime metadata", () => {
  const map = element(`<main/>`);
  const quid = acquire_document_identity(map.document, target()).snap()?.$_meta?.quid;
  const decoded = decode_view_state_snapshot(encode_view_state_snapshot(map.capture()));
  const restored = element(`<main/>`);
  restored.restore(decoded);
  assert.equal(restored.document.byQuid(quid!), undefined);
});

check("ordinary reads and mutations still mint nothing implicitly", () => {
  const map = element(`<main/>`);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => {
    throw new Error("implicit mint");
  });
  map.document.root();
  map.document.attrs.set(target(), "title", "x");
  assert.equal(map.root().$_meta?.quid, undefined);
});

check("primitive targets are ineligible", () => {
  const map = element(`<main "text"/>`);
  assert.throws(() => acquire_document_identity(map.document, target(0)), errorCode("DOCUMENT_IDENTITY_INELIGIBLE"));
});

check("structural carrier targets are ineligible", () => {
  const map = element(`<main <span/>/>`);
  assert.throws(() => acquire_document_identity(map.document, target(0)), errorCode("DOCUMENT_IDENTITY_INELIGIBLE"));
});

check("malformed acquisition paths reject atomically", () => {
  const map = element(`<main/>`);
  assert.throws(
    () => acquire_document_identity(map.document, { kind: "path", path: [-1] }),
    errorCode("INVALID_DOCUMENT_PATH_INDEX"),
  );
  assert.equal(map.rev, 0);
});

check("raw QUID targets cannot reconstruct handles", () => {
  const map = element(`<main @${Q1}/>`);
  assert.throws(
    () => acquire_document_identity(map.document, { kind: "quid", quid: Q1 } as never),
    errorCode("INVALID_DOCUMENT_TARGET"),
  );
});

check("allocator collisions retry against the active sparse overlay", () => {
  const map = element(`<main @${Q1} <span/>/>`);
  let calls = 0;
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => {
    calls += 1;
    return calls === 1 ? Q1 : Q2;
  });
  const handle = acquire_document_identity(map.document, target(0, 0));
  assert.equal(handle.snap()?.$_meta?.quid, Q2);
  assert.equal(calls, 2);
});

check("allocator exhaustion is stable and atomic", () => {
  const map = element(`<main/>`);
  let calls = 0;
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => {
    calls += 1;
    return "bad";
  });
  assert.throws(
    () => acquire_document_identity(map.document, target()),
    errorCode("LIVEMAP_IDENTITY_ALLOCATOR_EXHAUSTED"),
  );
  assert.equal(calls, LIVEMAP_DOCUMENT_QUID_MINT_RETRY_LIMIT);
  assert.equal(map.rev, 0);
});

check("handle snapshots are detached results", () => {
  const map = element(`<main/>`);
  const snapshot = acquire_document_identity(map.document, target()).snap();
  if (snapshot === undefined) throw new Error("missing identity snapshot");
  snapshot.$_tag = "aside";
  assert.equal((map.root().$_content[0] as { $_tag?: string } | undefined)?.$_tag, "main");
});

check("no public raw-QUID setter is introduced", () => {
  const document = element(`<main/>`).document;
  assert.equal(Reflect.get(document, "setQuid"), undefined);
  assert.equal(Reflect.get(document, "replaceQuid"), undefined);
  assert.equal(Reflect.get(document, "retireIdentity"), undefined);
});

check("the existing 9-character QUID encoding remains unchanged", () => {
  const map = element(`<main/>`);
  const quid = acquire_document_identity(map.document, target()).snap()?.$_meta?.quid;
  assert.equal(quid?.length, PERSISTED_QUID_LENGTH);
  assert.equal([...quid!].every((character) => PERSISTED_QUID_ALPHABET.includes(character)), true);
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
