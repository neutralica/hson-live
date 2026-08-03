// @hson-live-external-test
import assert from "node:assert/strict";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
import { element } from "./helpers/reflect-unit6.mts";
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

const Q1 = "0000000000002a01";
const Q2 = "0000000000002a02";
let checks = 0;

function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

const target = (...path: number[]) => Object.freeze({ kind: "path" as const, path: Object.freeze(path) });
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

check("new acquisition writes one valid canonical QUID", () => {
  const map = element(`<main/>`);
  const handle = acquire_document_identity(map.document, target());
  assert.equal(is_persisted_quid(handle.snap()?.$_meta?.quid), true);
});

check("new acquisition advances the ordinary revision once", () => {
  const map = element(`<main/>`);
  acquire_document_identity(map.document, target());
  assert.equal(map.rev, 1);
});

check("new acquisition publishes ensure-quid", () => {
  const map = element(`<main/>`);
  let commit: LiveMapGraphCommit | undefined;
  map.commits.observe((observation) => {
    if (observation.kind === "commit") commit = observation.commit as LiveMapGraphCommit;
  });
  acquire_document_identity(map.document, target());
  assert.equal(commit?.ops[0]?.op, "ensure-quid");
});

check("registration commits use one frozen path-authoritative target", () => {
  const map = element(`<main/>`);
  let operation: LiveMapGraphCommit["ops"][number] | undefined;
  map.commits.observe((observation) => {
    if (observation.kind === "commit") {
      const candidate = observation.commit.ops[0];
      if (candidate !== undefined
        && "domain" in candidate
        && (candidate.op !== "ensure-quid" || !("projected" in candidate.target))) operation = candidate as LiveMapGraphCommit["ops"][number];
    }
  });
  acquire_document_identity(map.document, target());
  assert.equal(operation?.op, "ensure-quid");
  if (operation?.op !== "ensure-quid") throw new Error("missing ensure-quid fixture");
  assert.deepEqual(operation.target, { kind: "path", path: [] });
  assert.equal(Object.isFrozen(operation.target.path), true);
  assert.equal("witness" in operation.target, false);
});

check("the sparse overlay resolves newly registered metadata", () => {
  const map = element(`<main/>`);
  const quid = acquire_document_identity(map.document, target()).snap()?.$_meta?.quid;
  assert.equal(typeof quid, "string");
  assert.equal(map.document.byQuid(quid!)?.$_tag, "main");
});

check("registration changes strict canonical graph equality", () => {
  const map = element(`<main/>`);
  const before = map.root();
  acquire_document_identity(map.document, target());
  assert.equal(canonical_hson_graph_equal(before, map.root()), false);
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

check("durable capture preserves acquired metadata", () => {
  const map = element(`<main/>`);
  const quid = acquire_document_identity(map.document, target()).snap()?.$_meta?.quid;
  const restored = element(`<main/>`);
  restored.restore(map.capture());
  assert.equal(restored.document.byQuid(quid!)?.$_tag, "main");
});

check("recorded registration replays without minting", () => {
  const source = element(`<main/>`);
  let commit: LiveMapGraphCommit | undefined;
  source.commits.observe((observation) => {
    if (observation.kind === "commit") commit = observation.commit as LiveMapGraphCommit;
  });
  const quid = acquire_document_identity(source.document, target()).snap()?.$_meta?.quid;
  const mirror = element(`<main/>`);
  set_livemap_document_quid_candidate_source_for_tests(mirror.document, () => {
    throw new Error("replay minted");
  });
  mirror.replay(commit!);
  assert.equal(mirror.document.byQuid(quid!)?.$_tag, "main");
});

check("view-state persistence preserves acquired exact metadata", () => {
  const map = element(`<main/>`);
  const quid = acquire_document_identity(map.document, target()).snap()?.$_meta?.quid;
  const decoded = decode_view_state_snapshot(encode_view_state_snapshot(map.capture()));
  const restored = element(`<main/>`);
  restored.restore(decoded);
  assert.equal(restored.document.byQuid(quid!)?.$_tag, "main");
});

check("ordinary reads and mutations still mint nothing implicitly", () => {
  const map = element(`<main/>`);
  set_livemap_document_quid_candidate_source_for_tests(map.document, () => {
    throw new Error("implicit mint");
  });
  map.document.root();
  map.document.attrs.set(target(), "title", "x");
  assert.equal(map.element.node().$_meta?.quid, undefined);
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
  assert.equal(map.element.node().$_tag, "main");
});

check("no public raw-QUID setter is introduced", () => {
  const document = element(`<main/>`).document;
  assert.equal(Reflect.get(document, "setQuid"), undefined);
  assert.equal(Reflect.get(document, "replaceQuid"), undefined);
  assert.equal(Reflect.get(document, "retireIdentity"), undefined);
});

check("the existing 16-character QUID encoding remains unchanged", () => {
  const map = element(`<main/>`);
  const quid = acquire_document_identity(map.document, target()).snap()?.$_meta?.quid;
  assert.equal(quid?.length, PERSISTED_QUID_LENGTH);
  assert.equal([...quid!].every((character) => PERSISTED_QUID_ALPHABET.includes(character)), true);
});

process.stdout.write(`1..${checks}\n`);
emit_hson_live_test_completion("livemap.document-identity-acquisition", checks, checks, 0);
