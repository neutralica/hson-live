import assert from "node:assert/strict";
import { Hson, hsonLiveMap, enable_interactions, add_interaction, replace_interaction, type BrowserInteractionDescriptor, type HsonSchema } from "../../src/index.js";
import { HsonSchemaError, with_livemap_replay_operation_index } from "../../src/api/livemap/livemap.error.js";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.js";
import { canonical_graph_equal } from "../../src/api/livemap/livemap.document.install.js";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.js";
import { HostedAggregateRepresentationError, make_portable_aggregate_snapshot, make_portable_aggregate_commit, type PortableAggregateCommit, type PrivateScopedAggregateCommit, type PrivateScopedAggregateOperation } from "../../src/api/livemap/livemap.hosted.js";
import type { PortableAggregateSnapshot } from "../../src/api/livemap/livemap.hosted.internal.types.js";
import { encode_livemap_replay_transport, type LiveMapProjectedDataOp } from "../../src/api/livemap/livemap.transport.js";
import { compose_client_portable_aggregate_internal } from "../../src/api/echo/echo.projection.js";
import { create_echo_aggregate_replica_capability_internal } from "../../src/api/echo/echo.aggregate-replica.lifecycle.js";
import { ordered_projected_object as object, ordered_projected_array as array, is_ordered_projected_object } from "../../src/core/ordered-projected-value.js";
import { project_live_path } from "../../src/api/livemap/livemap.editor.js";
import type { LiveMapAggregateCommit } from "../../src/api/livemap/livemap.library.js";
import { flat_document_fingerprint, is_flat_document_effect } from "../../src/api/livemap/livemap.document.flat-effects.js";
import { LiveMapDocumentPathError, validate_document_path } from "../../src/api/livemap/livemap.document.path.js";
import { ordered_projected_array_move, ordered_projected_array_splice, ordered_projected_value_at, ordered_projected_value_replace } from "../../src/core/ordered-projected-value-mutation.js";
import type { OrderedProjectedValue } from "../../src/core/ordered-projected-value.js";
import type { JsonValue } from "../../src/core/types.js";
import { admit_projected_value } from "../../src/core/projected-value-admission.js";
import { is_Node } from "../../src/core/node-guards.js";
import { encode_authoritative_scoped_commit, encode_scoped_effect_graph_operation } from "../../src/api/livemap/livemap.hosted.js";
import type { LiveMapAggregateWrite } from "../../src/api/livemap/livemap.library.js";
import { local_initializers } from "../helpers/client-projection.mts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { create_persistent_locus_hosted_aggregate_internal, load_persistent_locus_hosted_aggregate_internal } from "../../src/api/locus/locus.aggregate.persistence.js";
import { LocusPersistenceError } from "../../src/api/locus/locus.persistence.error.js";

type Check = (name: string, run: () => void | Promise<void>) => Promise<void>;
type Route = "hosted" | "durable" | "echo";
type ReplayInput = Omit<PortableAggregateCommit, "operations"> & Pick<PrivateScopedAggregateCommit, "operations">;
const systemName = "@hson/canonical-interactions";
const descriptor: BrowserInteractionDescriptor = {
  id: "button", subject: { library: "page", path: [0] }, kind: "browser", key: "run", args: null,
  listener: { event: "click", target: "element", capture: false, once: false, passive: false,
    missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false },
};
function fixture(multipleDocuments = false, schema?: HsonSchema, rows: JsonValue = [1, 2]) {
  const map = hsonLiveMap.fromLibraries({ state: { json: { rows, n: 0 }, ...(schema ? { schema } : {}) }, page: { document: "<main/>" },
    ...(multipleDocuments ? { second: { document: "<aside/>" }, third: { document: "<footer/>" } } : {}) });
  enable_interactions(map);
  return map;
}
function portable(commit: LiveMapAggregateCommit): PortableAggregateCommit {
  assert.ok(commit.hosted);
  const result = make_portable_aggregate_commit(commit.hosted); assert.ok(result); return result;
}
function receive(snapshot: PortableAggregateSnapshot, route: Route, local = false, schema?: HsonSchema, rows?: JsonValue) {
  const map = route === "echo" ? compose_client_portable_aggregate_internal(snapshot,
    local ? local_initializers({ localPage: { document: "<aside/>" } }) : []) : fixture(snapshot.libraries.some(entry => entry.name === "second"), schema, rows);
  const a = authority(map);
  if (route !== "echo") a.restoreClientHosted(snapshot);
  if (local) add_interaction(map, { ...descriptor, id: "local", subject: { library: "localPage", path: [0] } });
  const id = a.libraries()[0]!;
  const cap = route === "echo" ? create_echo_aggregate_replica_capability_internal(map) : undefined;
  return { map, a, id, replay: (commit: ReplayInput) => {
    if (cap) cap.replayHosted(commit, a.clientProjection()!.revision);
    else if (route === "durable" && commit.operations.some(op => op.domain === "document")) {
      a.replayDurableHosted({ authority: commit.authority, registryDigest: commit.registryDigest,
        prevRev: commit.prevRev, rev: commit.rev, operationCount: commit.operations.length, operations: commit.operations });
    } else {
      const operations = commit.operations.filter(op => op.domain !== "document");
      if (route === "durable") a.replayDurableHosted({ ...commit, operations });
      else {
        assert.equal(operations.length, commit.operations.length, "direct hosted uses ordinary portable operations");
        a.replayClientHosted({ ...commit, operations });
      }
    }
  }, dispose: () => cap?.dispose() };
}
function entry(operation: LiveMapProjectedDataOp, library = "state"): Extract<PortableAggregateCommit["operations"][number], { domain: "data" }> {
  return { library, domain: "data", kind: operation.kind, ...encode_livemap_replay_transport([operation]) };
}
function exact_evidence(commit: LiveMapAggregateCommit) {
  return commit.operations.map(op => {
    assert.ok(op.projected); assert.ok(Object.isFrozen(op.projected));
    return encode_livemap_replay_transport([op.projected]);
  });
}
type Receiver = ReturnType<typeof receive>;
function rejects_atomically(r: Receiver, input: ReplayInput, expected: object | ((error: unknown) => boolean), valid: PortableAggregateCommit) {
  const roots = r.a.libraries().map((id, index) => ({ id, root: r.a.root(id), before: structuredClone(r.a.root(id)),
    overlay: index === 0 ? r.a.projectedOverlay(id) : r.a.documentOverlay(id),
    scopes: index === 0 ? undefined : r.a.documentScopes(id), css: index === 0 ? undefined : r.a.stylesheet(id),
    continuity: index === 0 ? undefined : r.a.documentCaptureContinuity(id) }));
  const rootOverlay = r.a.projectedOverlay(r.id);
  const document = r.a.libraries()[1]!, documentOverlay = r.a.documentOverlay(document);
  const system = r.a.systemState(systemName)!;
  const systemRoot = r.a.systemRoot(system), systemBefore = structuredClone(systemRoot);
  const epoch = r.a.identityEpoch(), epochNumber = epoch.current(), ledger = epoch.issued();
  const issued = enumerate_livemap_issued_quids(ledger), revision = r.map.rev;
  const position = r.a.hostedPosition(), projection = r.a.clientProjection(), registry = r.a.hostedRegistry();
  const snapshot = JSON.stringify(r.a.captureHosted()), inputBytes = JSON.stringify(input), fence = r.a.captureFence();
  const telemetry = r.a.telemetry();
  const accepted: LiveMapAggregateCommit[] = [], published: number[] = [], installed: number[] = [];
  let commits = 0, restores = 0, watches = 0;
  const stops = [r.a.observe(c => accepted.push(c)), r.map.commits.observe(() => commits++),
    r.a.observeRestore(() => restores++), r.a.watch(r.id, ["n"], () => watches++),
    r.a.observeAuthorityPosition(rev => published.push(rev)), r.a.observeAuthorityPosition(rev => installed.push(rev), "installed")];
  try {
    assert.throws(() => r.replay(input), expected);
    assert.equal(JSON.stringify(input), inputBytes);
    for (const [index, { id, root, before, overlay, scopes, css, continuity }] of roots.entries()) {
      assert.equal(r.a.root(id), root); assert.ok(canonical_graph_equal(root, before));
      assert.equal(index === 0 ? r.a.projectedOverlay(id) : r.a.documentOverlay(id), overlay);
      if (index > 0) {
        assert.equal(r.a.documentScopes(id), scopes); assert.equal(r.a.stylesheet(id), css);
        assert.equal(r.a.documentCaptureContinuity(id), continuity);
      }
    }
    assert.equal(r.a.systemRoot(system), systemRoot); assert.ok(canonical_graph_equal(systemRoot, systemBefore));
    assert.equal(r.map.rev, revision); assert.deepEqual(r.a.hostedPosition(), position);
    assert.deepEqual(r.a.clientProjection(), projection); assert.equal(r.a.hostedRegistry(), registry);
    assert.equal(r.a.identityEpoch(), epoch); assert.equal(epoch.current(), epochNumber);
    assert.equal(epoch.issued(), ledger); assert.deepEqual(enumerate_livemap_issued_quids(ledger), issued);
    assert.equal(r.a.projectedOverlay(r.id), rootOverlay); assert.equal(r.a.documentOverlay(document), documentOverlay);
    assert.equal(JSON.stringify(r.a.captureHosted()), snapshot); assert.doesNotThrow(fence);
    assert.equal(r.a.telemetry().acceptedTransitions, telemetry.acceptedTransitions);
    assert.equal(r.a.telemetry().aggregatePublications, telemetry.aggregatePublications);
    assert.deepEqual([accepted, published, installed], [[], [], []]);
    assert.deepEqual([commits, restores, watches], [0, 0, 0]);
    r.replay(valid);
    assert.equal(r.map.rev, revision + 1); assert.equal(r.a.hostedPosition().revision, r.map.rev);
    assert.equal(r.a.clientProjection()?.revision ?? valid.rev, valid.rev);
    assert.equal(r.a.snap(r.id, ["n"]), 1); assert.equal(accepted.length, 1);
    assert.deepEqual(exact_evidence(accepted[0]!), valid.operations.map(({ format, payload }) => ({ format, payload })));
    if (!projection) assert.equal(JSON.stringify(portable(accepted[0]!)), JSON.stringify(valid));
    assert.deepEqual([published, installed], [[r.map.rev], [valid.rev]]);
    assert.deepEqual([commits, restores, watches], [1, 0, 1]);
    assert.equal(epoch.current(), epochNumber); assert.deepEqual(enumerate_livemap_issued_quids(epoch.issued()), issued);
    assert.deepEqual(r.a.projectedOverlay(r.id).pathForQuid("000008901"), ["rows"]);
  } finally { stops.forEach(stop => stop()); }
}

export async function livemap_replay_evidence_cases(check: Check): Promise<void> {
  await container_provenance_cases(check);
  await structural_provenance_cases(check);
  await composition_provenance_cases(check);
  await final_validation_cases(check);
  await residual_replay_cases(check);
  for (const route of ["hosted", "durable", "echo"] as const) {
    const ordered = object([["10", -0], ["2", 2]]), reordered = object([["2", 2], ["10", -0]]);
    const splice: LiveMapProjectedDataOp = { kind: "splice", path: ["rows"], start: 0, removed: [1], inserted: [3], prev: [1, 2], next: [3, 2] };
    const cases: readonly Readonly<{ name: string; operation: LiveMapProjectedDataOp; library?: string; reason?: string; context?: boolean; ordered?: boolean; containers?: boolean }>[] = [
      { name: "false removed with matching final state", operation: { ...splice, removed: [999] } },
      { name: "false removed length with matching final state", operation: { ...splice, removed: [1, 999], inserted: [3, 2] } },
      { name: "false inserted with inconsistent next", operation: { ...splice, inserted: [999] }, context: true },
      { name: "correct lengths with incorrect removed values", operation: { ...splice, removed: [9, 8], inserted: [3, 2] } },
      { name: "wrong splice index", operation: { ...splice, start: 1 }, context: true },
      { name: "wrong previous context", operation: { ...splice, prev: [9, 2] }, context: true },
      { name: "removed signed zero loses sign", operation: { ...splice, removed: [object([["10", 0], ["2", 2]])], prev: [ordered, 2] }, ordered: true },
      { name: "removed exact member order changed", operation: { ...splice, removed: [reordered], prev: [ordered, 2] }, ordered: true },
      { name: "fabricated equal-content container retirement", operation: { ...splice, removed: [object([["n", 999]])], inserted: [object([["n", 1]])], prev: [object([["n", 1]]), 2], next: [object([["n", 1]]), 2] }, containers: true },
      { name: "empty splice", operation: { ...splice, removed: [], inserted: [], next: [1, 2] }, reason: "UNCHANGED_STAGED_OPERATION" },
      { name: "unchanged system root replacement", operation: { kind: "replace", path: [], prev: object([["descriptors", array([])]]), next: object([["descriptors", array([])]]) }, library: systemName, reason: "UNCHANGED_STAGED_OPERATION" },
      { name: "unchanged system descriptors replacement", operation: { kind: "replace", path: ["descriptors"], prev: array([]), next: array([]) }, library: systemName, reason: "UNCHANGED_STAGED_OPERATION" },
      { name: "empty system splice", operation: { kind: "splice", path: ["descriptors"], start: 0, removed: [], inserted: [], prev: [], next: [] }, library: systemName, reason: "UNCHANGED_STAGED_OPERATION" },
    ];
    for (const test of cases) await check(`${route} rejects ${test.name} at its original index with complete atomicity`, () => {
      for (const prefix of ["none", "changed", "retirement"] as const) {
        const map = fixture(), a = authority(map), id = a.libraries()[0]!;
        if (test.ordered || test.containers) a.accept(a.prepare([{ target: a.target(id, ["rows", 0]), kind: "replace", value: test.ordered ? ordered : object([["n", 1]]) }]));
        const snapshot = make_portable_aggregate_snapshot(a.captureHosted());
        const valid = portable(a.accept(a.prepare([{ target: a.target(id, ["n"]), kind: "set", value: 1 }])).commit);
        const r = receive(snapshot, route);
        try {
          r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
          // Use the exact live carrier for the prefix; ordinary snapshots cannot preserve numeric-key order.
          const prefixRows = test.ordered ? [ordered, 2] : test.containers ? [object([["n", 1]]), 2] : [1, 2];
          const entries = prefix === "none" ? [] : [entry(prefix === "changed"
            ? { kind: "set", path: ["n"], prev: 0, next: 1 }
            : { kind: "replace", path: ["rows"], prev: array(prefixRows), next: array(prefixRows) })];
          entries.push(entry(test.operation, test.library));
          rejects_atomically(r, { ...valid, operations: entries }, test.context
            ? { code: "REPLAY_CONFLICT", opIndex: entries.length - 1 }
            : { code: "INVALID_REPLAY", reasonCode: test.reason ?? "INVALID_REPLAY_ENVELOPE", opIndex: entries.length - 1 }, valid);
        } finally { r.dispose(); }
      }
    });
    await check(`${route} rejects repeated descriptors and fabricated system splice evidence and recovers`, () => {
      for (const effect of ["replace", "equal splice", "false removed"] as const) {
        const map = fixture(); add_interaction(map, descriptor);
        const a = authority(map), id = a.libraries()[0]!, snapshot = make_portable_aggregate_snapshot(a.captureHosted());
        const system = a.systemState(systemName)!, root = a.systemRoot(system);
        const before = project_live_path(root, []);
        const descriptors = project_live_path(root, ["descriptors"]);
        assert.ok(before); assert.ok(Array.isArray(descriptors));
        const actual = descriptors[0]!;
        const valid = portable(a.accept(a.prepare([{ target: a.target(id, ["n"]), kind: "set", value: 1 }])).commit);
        const r = receive(snapshot, route);
        try {
          r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
          const operation: LiveMapProjectedDataOp = effect === "replace"
            ? { kind: "replace", path: [], prev: before, next: before }
            : { kind: "splice", path: ["descriptors"], start: 0, prev: descriptors,
              removed: effect === "false removed" ? [object([["fabricated", true]])] : [actual],
              inserted: effect === "false removed" ? [] : [actual], next: effect === "false removed" ? [] : descriptors };
          rejects_atomically(r, { ...valid, operations: [entry({ kind: "set", path: ["n"], prev: 0, next: 1 }), entry(operation, systemName)] },
            { code: "INVALID_REPLAY", reasonCode: effect === "false removed" ? "INVALID_REPLAY_ENVELOPE" : "UNCHANGED_STAGED_OPERATION", opIndex: 1 }, valid);
        } finally { r.dispose(); }
      }
    });
    await check(`${route} preserves codec classification and original index for wrong operation kind`, () => {
      const map = fixture(), a = authority(map), id = a.libraries()[0]!;
      const snapshot = make_portable_aggregate_snapshot(a.captureHosted());
      const valid = portable(a.accept(a.prepare([{ target: a.target(id, ["n"]), kind: "set", value: 1 }])).commit);
      const r = receive(snapshot, route);
      try {
        r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
        rejects_atomically(r, { ...valid, operations: [entry({ kind: "set", path: ["n"], prev: 0, next: 1 }), { ...entry(splice), kind: "replace" }] },
          { name: "HostedAggregateRepresentationError", operationIndex: 1 }, valid);
      } finally { r.dispose(); }
    });
    await check(`${route} preserves truthful exact splice rename move replace evidence across restart`, () => {
      const map = fixture(), a = authority(map), id = a.libraries()[0]!;
      a.accept(a.prepare([{ target: a.target(id, ["rows", 0]), kind: "replace", value: ordered }]));
      const snapshot = make_portable_aggregate_snapshot(a.captureHosted()), r = receive(snapshot, route);
      try {
        const seen: LiveMapAggregateCommit[] = [], stop = r.a.observe(c => seen.push(c));
        try {
          const accepted = a.accept(a.prepare([
            { target: a.target(id, ["rows"]), kind: "splice", start: 0, deleteCount: 1, items: [object([["2", -0], ["10", 4]])] },
            { target: a.target(id, ["rows"]), kind: "move", from: 0, to: 1 },
            { target: a.target(id, []), kind: "rename", from: "n", to: "count" },
            { target: a.target(id, ["count"]), kind: "replace", value: -0 },
          ])).commit;
          const commit = portable(accepted), bytes = JSON.stringify(commit);
          const beforeRev = r.map.rev;
          r.replay(commit); assert.equal(r.map.rev, beforeRev + 1); assert.equal(seen.length, 1);
          assert.equal(r.a.clientProjection()?.revision ?? r.map.rev, commit.rev);
          assert.deepEqual(seen[0]!.operations.map(op => op.operation), accepted.operations.map(op => op.operation));
          assert.deepEqual(exact_evidence(seen[0]!), commit.operations.map(({ format, payload }) => ({ format, payload })));
          assert.ok(Object.is(r.a.snap(r.id, ["count"]), -0));
          if (route !== "echo") assert.equal(JSON.stringify(portable(seen[0]!)), bytes);
          assert.equal(JSON.stringify(commit), bytes);
          assert.ok(Object.isFrozen(seen[0]!.operations[0]!.projected));
          assert.throws(() => r.replay(commit), { code: "STALE_REV" });
          assert.equal(seen.length, 1);
          // A second portable restoration continues from the accepted position with fresh identity.
          const restart = make_portable_aggregate_snapshot(r.a.captureHosted());
          const restarted = receive({ ...restart, revision: commit.rev }, route);
          try {
            const next = portable(a.accept(a.prepare([{ target: a.target(id, ["count"]), kind: "set", value: 7 }])).commit);
            restarted.replay(next); assert.equal(restarted.a.clientProjection()?.revision ?? restarted.map.rev, next.rev);
            assert.equal(restarted.a.snap(restarted.id, ["count"]), 7); assert.equal(restarted.a.identityEpoch().issued().size, 0);
          } finally { restarted.dispose(); }
        } finally { stop(); }
      } finally { r.dispose(); }
    });
    await check(`${route} accepts real descriptor updates and rejects their identical repetition`, () => {
      const map = fixture(); add_interaction(map, descriptor);
      const a = authority(map), snapshot = make_portable_aggregate_snapshot(a.captureHosted());
      const seen: LiveMapAggregateCommit[] = [], stop = a.observe(c => seen.push(c));
      replace_interaction(map, { ...descriptor, key: "updated" }); stop();
      const commit = portable(seen[0]!), r = receive(snapshot, route, route === "echo");
      try {
        r.replay(commit); assert.equal(r.a.clientProjection()?.revision ?? r.map.rev, commit.rev);
        const system = r.a.systemState(systemName)!;
        const bytes = JSON.stringify(r.a.systemRoot(system)); assert.ok(bytes.includes("updated"));
        if (route === "echo") assert.ok(bytes.includes("local"));
        const id = a.libraries()[0]!;
        const valid = portable(a.accept(a.prepare([{ target: a.target(id, ["n"]), kind: "set", value: 1 }])).commit);
        // Reuse the exact after-carrier without projecting through JavaScript objects.
        const sharedRoot = project_live_path(a.systemRoot(a.systemState(systemName)!), []);
        assert.ok(sharedRoot);
        r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
        rejects_atomically(r, { ...valid, operations: [entry({ kind: "replace", path: [], prev: sharedRoot, next: sharedRoot }, systemName)] },
          { code: "INVALID_REPLAY", reasonCode: "UNCHANGED_STAGED_OPERATION", opIndex: 0 }, valid);
      } finally { r.dispose(); }
    });
    await check(`${route} accepts a truthful equal-value move in a mixed aggregate`, () => {
      const map = fixture(), a = authority(map), id = a.libraries()[0]!;
      a.accept(a.prepare([{ target: a.target(id, ["rows", 1]), kind: "set", value: 1 }]));
      const r = receive(make_portable_aggregate_snapshot(a.captureHosted()), route);
      try {
        const accepted = a.accept(a.prepare([
          { target: a.target(id, ["rows"]), kind: "move", from: 0, to: 1 },
          { target: a.target(id, ["n"]), kind: "set", value: 1 },
        ])).commit;
        const commit = portable(accepted); assert.equal(commit.operations.length, 2);
        r.replay(commit); assert.equal(r.a.clientProjection()?.revision ?? r.map.rev, commit.rev);
        assert.deepEqual(r.a.snap(r.id), { rows: [1, 1], n: 1 });
      } finally { r.dispose(); }
    });
  }
}

function classified(expected: { name: string; code?: string; reasonCode?: string; opIndex?: number;
  operationIndex?: number; causes?: readonly { name: string; code?: string }[] }) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof Error);
    assert.equal(error.name, expected.name, error.stack);
    for (const field of ["code", "reasonCode", "opIndex", "operationIndex"] as const) {
      if (field in expected) assert.equal(Reflect.get(error, field), expected[field]);
    }
    if (expected.operationIndex !== undefined) assert.equal(Object.hasOwn(error, "opIndex"), false);
    else assert.equal(Object.hasOwn(error, "operationIndex"), false);
    let cause = error.cause;
    for (const item of expected.causes ?? []) {
      assert.ok(cause instanceof Error); assert.equal(cause.name, item.name);
      assert.equal(Reflect.get(cause, "code"), item.code); cause = cause.cause;
    }
    assert.equal(cause, undefined, "the original cause chain is preserved without extra wrappers");
    return true;
  };
}

function expanded_fixture(count: number, schema?: HsonSchema, interaction = false, secondInteraction = false, secondPath: readonly number[] = [0], rows?: JsonValue) {
  const map = fixture(true, schema, rows);
  if (interaction) add_interaction(map, descriptor);
  if (secondInteraction) add_interaction(map, { ...descriptor, id: "second-button", key: "second", subject: { library: "second", path: secondPath } });
  const a = authority(map), ids = a.libraries();
  const system = project_live_path(a.systemRoot(a.systemState(systemName)!), []); assert.ok(system);
  const snapshot = make_portable_aggregate_snapshot(a.captureHosted());
  const css = { rules: [], properties: [], keyframes: [], order: [] };
  const names = ["page", "second", "third"].slice(0, count);
  const before = ids.slice(1, count + 1).map(id => structuredClone(a.root(id)));
  const writes: LiveMapAggregateWrite[] = names.flatMap((_name, index): LiveMapAggregateWrite[] => [
    { target: a.target(ids[index + 1]!, [0]), kind: "graph", operation: {
      domain: "graph", op: "set-attr", target: { kind: "path", path: validate_document_path([0]) }, name: "title", value: "first" } },
    { target: a.target(ids[index + 1]!, [0]), kind: "graph", operation: {
      domain: "graph", op: "set-attr", target: { kind: "path", path: validate_document_path([0]) }, name: "lang", value: "en" } },
  ]);
  writes.push({ target: a.target(ids[0]!, ["n"]), kind: "set", value: 1 });
  const commit = portable(a.accept(a.prepare(writes)).commit);
  const effects: PrivateScopedAggregateOperation[] = names.map((library, index) => ({ library, domain: "document", effect: {
    kind: "flat", before: flat_document_fingerprint(before[index]!, css, []),
    after: flat_document_fingerprint(a.root(ids[index + 1]!), css, []),
    graphs: commit.operations.filter(op => op.library === library).map(op => op.payload), css, subjects: [],
  } }));
  const set = entry({ kind: "set", path: ["n"], prev: 0, next: 1 });
  return { snapshot, commit, effects, before, system, valid: { ...commit, operations: [set] },
    expanded: { ...commit, operations: [...effects, set] } };
}

function structural_history(initial: OrderedProjectedValue, prefix: readonly ReplayInput["operations"][number][]) {
  let state = initial;
  const operations = [...prefix];
  const read = (path: readonly (string | number)[]) => ordered_projected_value_at(state, path);
  return {
    operations, read,
    set(path: readonly (string | number)[], next: OrderedProjectedValue, kind: "set" | "replace" = "set") {
      const prev = read(path);
      state = ordered_projected_value_replace(state, path, next);
      operations.push(entry({ kind, path, prev, next }, systemName));
    },
    move(from: number, to: number) {
      const path = ["descriptors"], prev = array_value(read(path));
      state = ordered_projected_array_move(state, path, from, to);
      operations.push(entry({ kind: "move", path, from, to, prev, next: array_value(read(path)) }, systemName));
    },
    splice(start: number, deleteCount: number, inserted: readonly OrderedProjectedValue[] = []) {
      const path = ["descriptors"], prev = array_value(read(path));
      const result = ordered_projected_array_splice(state, path, start, deleteCount, inserted);
      state = result.value;
      operations.push(entry({ kind: "splice", path, start, removed: result.removed, inserted, prev, next: array_value(read(path)) }, systemName));
    },
  };
}

async function container_provenance_cases(check: Check): Promise<void> {
  const shapes: readonly { name: string; leaf: readonly (string | number)[]; wrap: (n: number) => JsonValue; schema: HsonSchema }[] = [
    { name: "nested arrays", leaf: [0], wrap: n => [n],
      schema: Hson.schema`<type "data" content <rows <array <array <number <int true min 0>>>> n "number">>` },
    { name: "deeper arrays", leaf: [0, 0], wrap: n => [[n]],
      schema: Hson.schema`<type "data" content <rows <array <array <array <number <int true min 0>>>>> n "number">>` },
    { name: "object children", leaf: ["value"], wrap: n => ({ value: n }),
      schema: Hson.schema`<type "data" content <rows <array <content <value <number <int true min 0>>>>> n "number">>` },
    { name: "objects containing arrays", leaf: ["values", 0], wrap: n => ({ values: [n] }),
      schema: Hson.schema`<type "data" content <rows <array <content <values <array <number <int true min 0>>>>>> n "number">>` },
    { name: "arrays containing objects", leaf: [0, "value"], wrap: n => [{ value: n }],
      schema: Hson.schema`<type "data" content <rows <array <array <content <value <number <int true min 0>>>>>> n "number">>` },
  ];
  for (const route of ["hosted", "durable", "echo"] as const) for (const local of route === "echo" ? [false, true] : [false]) {
    for (const shape of shapes) {
      const label = `${route}${local ? " with local interactions" : ""} container provenance: ${shape.name}`;
      await check(`${label} requires direct evidence after affected structural edits`, () => {
        for (const count of [0, 2]) for (const scenario of ["set", "replace", "equal replace", "equal exchange", "move", "equal move", "insert", "rename", "sole container", "direct set", "direct replace", "unrelated move", "unrelated splice", "unrelated rename"] as const) {
          const rows = [shape.wrap(1), shape.wrap(2)];
          const f = expanded_fixture(count, shape.schema, false, false, [0], rows), base = route === "hosted" ? f.commit : f.expanded;
          const operations = count ? [...base.operations] : [];
          const row = (n: number) => admit_projected_value(shape.wrap(n));
          const values = (...ns: number[]) => array(ns.map(row));
          const leaf = (index: number) => ["rows", index, ...shape.leaf];
          const append = (operation: LiveMapProjectedDataOp) => { operations.push(entry(operation)); return operations.length - 1; };
          let expected: number | undefined;
          let failurePath = leaf(0);
          if (scenario === "sole container") {
            append({ kind: "replace", path: ["rows"], prev: values(1, 2), next: values(-1, 2) });
          } else if (scenario === "unrelated splice") {
            expected = append({ kind: "set", path: leaf(1), prev: 2, next: -1 });
            append({ kind: "splice", path: ["rows"], start: 0, removed: [row(1)], inserted: [row(3)], prev: values(1, -1), next: values(3, -1) });
            failurePath = leaf(1);
          } else {
            const first = append({ kind: "set", path: leaf(0), prev: 1, next: -1 });
            if (scenario.startsWith("unrelated")) {
              expected = first;
              if (scenario === "unrelated move") {
                append({ kind: "splice", path: ["rows"], start: 2, removed: [], inserted: [row(3)], prev: values(-1, 2), next: values(-1, 2, 3) });
                append({ kind: "move", path: ["rows"], from: 1, to: 2, prev: values(-1, 2, 3), next: values(-1, 3, 2) });
              } else {
                const prev = object([["rows", values(-1, 2)], ["n", count ? 1 : 0]]);
                const next = object([["rows", values(-1, 2)], ["count", count ? 1 : 0]]);
                append({ kind: "rename", path: [], from: "n", to: "count", prev, next });
                append({ kind: "rename", path: [], from: "count", to: "n", prev: next, next: prev });
              }
            } else if (scenario === "insert") {
              append({ kind: "splice", path: ["rows"], start: 0, removed: [], inserted: [row(3)], prev: values(-1, 2), next: values(3, -1, 2) });
              failurePath = leaf(1);
            } else if (scenario === "rename") {
              const prev = object([["rows", values(-1, 2)], ["n", count ? 1 : 0]]);
              const next = object([["saved", values(-1, 2)], ["n", count ? 1 : 0]]);
              append({ kind: "rename", path: [], from: "rows", to: "saved", prev, next });
              append({ kind: "rename", path: [], from: "saved", to: "rows", prev: next, next: prev });
            } else {
              const second = scenario.startsWith("equal") ? -1 : -2;
              append({ kind: "set", path: leaf(1), prev: 2, next: second });
              const prev = values(-1, second), next = scenario === "equal replace" ? prev : values(second, -1);
              if (scenario === "move" || scenario === "equal move") append({ kind: "move", path: ["rows"], from: 0, to: 1, prev, next });
              else append({ kind: scenario === "set" ? "set" : "replace", path: ["rows"], prev, next });
              append({ kind: "splice", path: ["rows"], start: 1, removed: [row(-1)], inserted: [], prev: next, next: values(second) });
              if (scenario === "direct set" || scenario === "direct replace") {
                expected = append({ kind: scenario === "direct set" ? "set" : "replace", path: leaf(0), prev: second, next: -3 });
              }
            }
          }
          const r = receive(f.snapshot, route, local, shape.schema, rows);
          try {
            r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
            rejects_atomically(r, { ...base, operations }, error => {
              assert.ok(error instanceof HsonSchemaError, scenario); assert.equal(error.code, "SCHEMA_VALIDATION");
              assert.deepEqual(error.path, failurePath, scenario); assert.equal(error.opIndex, expected, scenario);
              assert.equal(Object.hasOwn(error, "opIndex"), expected !== undefined, scenario);
              assert.equal(Object.hasOwn(error, "operationIndex"), false); assert.equal(error.cause, undefined); return true;
            }, f.valid);
          } finally { r.dispose(); }
        }
      });
      await check(`${label} accepts repairs and removal of invalid contributors in the final candidate`, () => {
        for (const count of [0, 2]) for (const repair of [false, true]) {
          const rows = [shape.wrap(1), shape.wrap(2)];
          const f = expanded_fixture(count, shape.schema, false, false, [0], rows), base = route === "hosted" ? f.commit : f.expanded;
          const row = (n: number) => admit_projected_value(shape.wrap(n));
          const values = (...ns: number[]) => array(ns.map(row));
          const operations = [...(count ? base.operations : []), entry({ kind: "set", path: ["rows", 0, ...shape.leaf], prev: 1, next: -1 })];
          if (repair) {
            operations.push(entry({ kind: "replace", path: ["rows"], prev: values(-1, 2), next: values(2, -1) }),
              entry({ kind: "set", path: ["rows", 1, ...shape.leaf], prev: -1, next: 3 }));
          } else {
            operations.push(entry({ kind: "move", path: ["rows"], from: 0, to: 1, prev: values(-1, 2), next: values(2, -1) }),
              entry({ kind: "splice", path: ["rows"], start: 1, removed: [row(-1)], inserted: [], prev: values(2, -1), next: values(2) }));
          }
          const r = receive(f.snapshot, route, local, shape.schema, rows), accepted: LiveMapAggregateCommit[] = [];
          const stop = r.a.observe(commit => accepted.push(commit));
          try {
            const input = { ...base, operations }, bytes = JSON.stringify(input), revision = r.map.rev;
            r.replay(input); assert.equal(r.map.rev, revision + 1); assert.equal(accepted.length, 1);
            assert.deepEqual(r.a.snap(r.id, ["rows"]), repair ? [shape.wrap(2), shape.wrap(3)] : [shape.wrap(2)]);
            assert.equal(JSON.stringify(input), bytes);
            if (route === "hosted") assert.equal(JSON.stringify(portable(accepted[0]!)), bytes);
          } finally { stop(); r.dispose(); }
        }
      });
    }
  }
}

async function structural_provenance_cases(check: Check): Promise<void> {
  const aPath = ["descriptors", 0, "subject", "path"], bPath = ["descriptors", 1, "subject", "path"];
  const path_error = (index: number | undefined, segment = -1) => (error: unknown): boolean => {
    assert.ok(error instanceof LiveMapDocumentPathError);
    assert.equal(error.code, "INVALID_DOCUMENT_PATH_INDEX"); assert.equal(error.segment, segment);
    assert.equal(Reflect.get(error, "opIndex"), index);
    assert.equal(Object.hasOwn(error, "operationIndex"), false); assert.equal(error.cause, undefined); return true;
  };
  for (const route of ["hosted", "durable", "echo"] as const) for (const local of route === "echo" ? [false, true] : [false]) {
    const label = `${route}${local ? " with local interactions" : ""} structural provenance`;
    for (const count of [0, 2]) await check(`${label}: exact A/B move-and-remove counterexample with ${count} Document effects`, () => {
      const f = expanded_fixture(count, undefined, true, true, [1]), base = route === "hosted" ? f.commit : f.expanded;
      const h = structural_history(f.system, count ? base.operations : []), removedSource = h.operations.length;
      h.set(aPath, array([-1])); h.set(bPath, array([-1])); h.move(0, 1); h.splice(1, 1);
      assert.equal(h.read(["descriptors", 0, "id"]), "second-button");
      assert.equal(array_value(h.read(["descriptors"])).length, 1);
      const r = receive(f.snapshot, route, local);
      try {
        r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
        rejects_atomically(r, { ...base, operations: h.operations }, error => {
          assert.ok(error instanceof LiveMapDocumentPathError);
          assert.notEqual(Reflect.get(error, "opIndex"), removedSource, "removed A cannot author surviving B's error");
          return path_error(undefined)(error); // No object-lineage reconstruction is attempted.
        }, f.valid);
      } finally { r.dispose(); }
    });
    await check(`${label}: equal-valued moves splices insertions and replacements remain conservative`, () => {
      for (const count of [0, 2]) for (const scenario of ["move", "splice", "removed contributor", "moved survivor", "insert", "set array", "replace array", "replace root", "set array different", "replace array different", "replace root different"] as const) {
        const f = expanded_fixture(count, undefined, true, true, [1]), base = route === "hosted" ? f.commit : f.expanded;
        const h = structural_history(f.system, count ? base.operations : []);
        if (scenario === "moved survivor") { h.set(bPath, array([-1])); h.move(1, 0); }
        else {
          h.set(aPath, array([-1]));
          if (scenario !== "insert") h.set(bPath, array(scenario === "removed contributor" || scenario.endsWith("different") ? [-2] : [-1]));
          if (scenario === "move") h.move(0, 1);
          else if (scenario === "splice" || scenario === "removed contributor") h.splice(0, 1);
          else if (scenario === "insert") {
            const candidate = h.read(["descriptors", 0]); assert.ok(candidate);
            h.splice(0, 0, [ordered_projected_value_replace(candidate, ["id"], "inserted")]);
          } else {
            const reversed = array([...array_value(h.read(["descriptors"]))].reverse());
            if (scenario.startsWith("replace root")) h.set([], object([["descriptors", reversed]]), "replace");
            else h.set(["descriptors"], reversed, scenario.startsWith("set array") ? "set" : "replace");
            h.splice(1, 1);
          }
        }
        const r = receive(f.snapshot, route, local);
        try {
          r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
          rejects_atomically(r, { ...base, operations: h.operations }, path_error(undefined,
            scenario === "removed contributor" || scenario.endsWith("different") ? -2 : -1), f.valid);
        } finally { r.dispose(); }
      }
    });
    await check(`${label}: structural edits outside a stable coordinate preserve exact submitted indices`, () => {
      for (const count of [0, 2]) for (const scenario of ["move suffix", "remove suffix", "insert suffix", "replace suffix"] as const) {
        const f = expanded_fixture(count, undefined, true, true, [1]), base = route === "hosted" ? f.commit : f.expanded;
        const h = structural_history(f.system, count ? base.operations : []), index = h.operations.length;
        h.set([...aPath, 0], -1);
        const second = h.read(["descriptors", 1]); assert.ok(second);
        const third = ordered_projected_value_replace(second, ["id"], "third-button");
        if (scenario === "remove suffix") h.splice(1, 1);
        else if (scenario === "replace suffix") h.splice(1, 1, [third]);
        else { h.splice(2, 0, [third]); if (scenario === "move suffix") h.move(1, 2); }
        const r = receive(f.snapshot, route, local);
        try {
          r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
          rejects_atomically(r, { ...base, operations: h.operations }, path_error(index), f.valid);
        } finally { r.dispose(); }
      }
    });
    await check(`${label}: later overwrites establish authorship only for direct scalars`, () => {
      for (const count of [0, 2]) for (const kind of ["set", "replace"] as const) for (const scalar of [false, true]) {
        const f = expanded_fixture(count, undefined, true, true, [1]), base = route === "hosted" ? f.commit : f.expanded;
        const h = structural_history(f.system, count ? base.operations : []);
        h.set(aPath, array([-1])); h.set(bPath, array([-1])); h.move(0, 1); h.splice(1, 1);
        const index = h.operations.length; h.set(scalar ? [...aPath, 0] : aPath, scalar ? -2 : array([-2]), kind);
        const r = receive(f.snapshot, route, local);
        try {
          r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
          rejects_atomically(r, { ...base, operations: h.operations }, path_error(scalar ? index : undefined, -2), f.valid);
        } finally { r.dispose(); }
      }
    });
    await check(`${label}: final Schema validation also omits equal-coordinate structural ambiguity`, () => {
      const schema: HsonSchema = Hson.schema`<type "data" content <rows <array <number <min 0>>> n "number">>`;
      for (const count of [0, 2]) {
        const f = expanded_fixture(count, schema), base = route === "hosted" ? f.commit : f.expanded;
        const input = { ...base, operations: [...(count ? base.operations : []),
          entry({ kind: "set", path: ["rows", 0], prev: 1, next: -1 }),
          entry({ kind: "set", path: ["rows", 1], prev: 2, next: -1 }),
          entry({ kind: "move", path: ["rows"], from: 0, to: 1, prev: array([-1, -1]), next: array([-1, -1]) }),
          entry({ kind: "splice", path: ["rows"], start: 1, removed: [-1], inserted: [], prev: [-1, -1], next: [-1] }),
        ] };
        const r = receive(f.snapshot, route, local, schema);
        try {
          r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
          rejects_atomically(r, input, error => {
            assert.ok(error instanceof HsonSchemaError); assert.equal(error.code, "SCHEMA_VALIDATION");
            assert.deepEqual(error.path, ["rows", 0]); assert.equal(error.opIndex, undefined);
            assert.equal(error.cause, undefined); return true;
          }, f.valid);
        } finally { r.dispose(); }
      }
    });
    await check(`${label}: removal of the only invalid contributor and genuine repairs accept the final batch`, () => {
      for (const count of [0, 2]) for (const repair of [false, true]) {
        const f = expanded_fixture(count, undefined, true, true, [1]), base = route === "hosted" ? f.commit : f.expanded;
        const h = structural_history(f.system, count ? base.operations : []);
        h.set(aPath, array([-1]));
        if (repair) { h.set(bPath, array([-1])); h.move(0, 1); h.splice(1, 1); h.set(aPath, array([1])); }
        else h.splice(0, 1);
        const r = receive(f.snapshot, route, local), accepted: LiveMapAggregateCommit[] = [], stop = r.a.observe(c => accepted.push(c));
        const system = r.a.systemState(systemName)!;
        const localBefore = project_live_path(r.a.systemRoot(system), ["descriptors", 2]);
        try {
          const revision = r.map.rev, input = { ...base, operations: h.operations }, bytes = JSON.stringify(input);
          r.replay(input); assert.equal(r.map.rev, revision + 1); assert.equal(accepted.length, 1);
          assert.deepEqual(project_live_path(r.a.systemRoot(system), ["descriptors"]),
            array([...array_value(h.read(["descriptors"])), ...(localBefore ? [localBefore] : [])]));
          assert.equal(JSON.stringify(input), bytes);
          if (route === "hosted") assert.equal(JSON.stringify(portable(accepted[0]!)), bytes);
        } finally { stop(); r.dispose(); }
      }
    });
  }
}

async function composition_provenance_cases(check: Check): Promise<void> {
  for (const route of ["hosted", "durable", "echo"] as const) {
    for (const local of route === "echo" ? [false, true] : [false]) {
      const label = `${route}${local ? " with local interactions" : ""} composition provenance`;
      await check(`${label}: field changes retain their source while submitted container replacements remain conservative`, () => {
        for (const count of [0, 2]) for (const tail of ["key", "subject library", "several fields", "second descriptor", "descriptor replacement", "complete replacement", "path carry-forward"] as const) {
          const f = expanded_fixture(count, undefined, true, true), base = route === "hosted" ? f.commit : f.expanded;
          const operations = count === 0 ? [] : [...base.operations];
          let system: OrderedProjectedValue = f.system;
          const change = (path: readonly (string | number)[], next: OrderedProjectedValue, kind: "set" | "replace" = "set") => {
            const prev = ordered_projected_value_at(system, path);
            system = ordered_projected_value_replace(system, path, next);
            operations.push(entry({ kind, path, prev, next }, systemName));
          };
          const index = operations.length;
          change(["descriptors", 0, "subject", "path", 0], -1);
          if (tail === "key" || tail === "several fields") change(["descriptors", 0, "key"], "changed");
          if (tail === "subject library") change(["descriptors", 0, "subject", "library"], "second");
          if (tail === "path carry-forward") change(["descriptors", 0, "subject", "path"], array([-1, 1]));
          if (tail === "several fields") {
            change(["descriptors", 0, "listener", "capture"], true);
            change(["descriptors", 0, "args"], object([["valid", true]]));
          }
          if (tail === "second descriptor") {
            change(["descriptors", 1, "key"], "changed-second");
            change(["descriptors", 1, "subject", "path"], array([0, 0]));
          }
          if (tail === "descriptor replacement" || tail === "complete replacement") {
            const changed = ordered_projected_value_replace(system, ["descriptors", 0, "key"], "changed");
            const path = tail === "descriptor replacement" ? ["descriptors", 0] : [];
            const next = ordered_projected_value_at(changed, path); assert.ok(next);
            change(path, next, "replace");
          }
          const r = receive(f.snapshot, route, local);
          try {
            r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
            rejects_atomically(r, { ...base, operations }, error => {
              assert.ok(error instanceof LiveMapDocumentPathError);
              assert.equal(error.code, "INVALID_DOCUMENT_PATH_INDEX");
              assert.equal(error.segmentIndex, 0); assert.equal(error.segment, -1);
              // These three submitted container assignments can change path
              // ownership. Echo's synthetic replacements for unrelated field
              // writes still preserve the original source exactly.
              const uncertain = tail === "descriptor replacement" || tail === "complete replacement" || tail === "path carry-forward";
              assert.equal(Reflect.get(error, "opIndex"), uncertain ? undefined : index);
              assert.equal(Object.hasOwn(error, "operationIndex"), false);
              assert.equal(error.cause, undefined); return true;
            }, f.valid);
          } finally { r.dispose(); }
        }
      });
      await check(`${label}: real field overwrites retain their own source and repairs accept the final candidate`, () => {
        for (const count of [0, 2]) for (const scenario of ["valid prefix", "different invalid set", "different invalid replace", "repair"] as const) {
          const f = expanded_fixture(count, undefined, true, true), base = route === "hosted" ? f.commit : f.expanded;
          const operations = count === 0 ? [] : [...base.operations];
          let system: OrderedProjectedValue = f.system;
          const steps: { prev: readonly OrderedProjectedValue[]; next: readonly OrderedProjectedValue[] }[] = [];
          const change = (path: readonly (string | number)[], next: OrderedProjectedValue, kind: "set" | "replace" = "set") => {
            const prev = ordered_projected_value_at(system, path);
            const before = array_value(ordered_projected_value_at(system, ["descriptors"]));
            system = ordered_projected_value_replace(system, path, next);
            steps.push({ prev: before, next: array_value(ordered_projected_value_at(system, ["descriptors"])) });
            operations.push(entry({ kind, path, prev, next }, systemName));
          };
          if (scenario === "valid prefix") change(["descriptors", 0, "key"], "changed");
          change(["descriptors", 0, "subject", "path", 0], -1);
          if (scenario !== "valid prefix") {
            change(["descriptors", 0, "key"], "changed");
            change(["descriptors", 0, "subject", "path", 0], scenario === "repair" ? 0 : -2,
              scenario === "different invalid replace" ? "replace" : "set");
          }
          const index = operations.length - 1, r = receive(f.snapshot, route, local);
          try {
            if (scenario !== "repair") {
              r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
              rejects_atomically(r, { ...base, operations }, error => {
                assert.ok(error instanceof LiveMapDocumentPathError); assert.equal(error.code, "INVALID_DOCUMENT_PATH_INDEX");
                assert.equal(Reflect.get(error, "opIndex"), index); assert.equal(error.cause, undefined); return true;
              }, f.valid);
            } else {
              const accepted: LiveMapAggregateCommit[] = [], stop = r.a.observe(commit => accepted.push(commit));
              const revision = r.map.rev, input = { ...base, operations }, bytes = JSON.stringify(input);
              const localBefore = project_live_path(r.a.systemRoot(r.a.systemState(systemName)!), ["descriptors", 2]);
              try {
                r.replay(input); assert.equal(r.map.rev, revision + 1); assert.equal(accepted.length, 1);
                assert.deepEqual(project_live_path(r.a.systemRoot(r.a.systemState(systemName)!), ["descriptors"]),
                  array([...array_value(ordered_projected_value_at(system, ["descriptors"])), ...(localBefore ? [localBefore] : [])]));
                assert.equal(JSON.stringify(input), bytes);
                assert.ok(accepted[0]!.operations.filter(op => op.target.domain === "system").every(op => Object.isFrozen(op.projected)));
                const actual = accepted[0]!.operations.filter(op => op.target.domain === "system").map(op => {
                  assert.ok(op.projected); return entry(op.projected, systemName);
                });
                const locals = localBefore ? [localBefore] : [];
                const expected = route === "echo" ? steps.map(step => entry({ kind: "replace", path: ["descriptors"],
                  prev: array([...step.prev, ...locals]), next: array([...step.next, ...locals]) }, systemName))
                  : operations.slice(-steps.length);
                assert.equal(JSON.stringify(actual), JSON.stringify(expected), "accepted portable system evidence retains its exact bytes");
                if (route === "hosted") assert.equal(JSON.stringify(portable(accepted[0]!)), bytes);
              } finally { stop(); }
            }
          } finally { r.dispose(); }
        }
      });
      await check(`${label}: synthetic replacements do not turn ambiguous final Schema failures into a single source`, () => {
        for (const scenario of ["same descriptor", "independent descriptors", "carried replacement"] as const) {
          const independent = scenario === "independent descriptors";
          const f = expanded_fixture(2, undefined, true, true), base = route === "hosted" ? f.commit : f.expanded;
          const operations = [...base.operations, entry({ kind: "set", path: ["descriptors", 0, "key"], prev: "run", next: 42 }, systemName),
            entry(independent ? { kind: "set", path: ["descriptors", 1, "key"], prev: "second", next: 43 }
              : { kind: "set", path: ["descriptors", 0, "listener", "capture"], prev: false, next: "invalid" }, systemName),
            entry({ kind: "set", path: ["descriptors", 1, "args"], prev: null, next: true }, systemName)];
          if (scenario === "carried replacement") {
            const before = ordered_projected_value_replace(ordered_projected_value_replace(
              ordered_projected_value_replace(f.system, ["descriptors", 0, "key"], 42),
              ["descriptors", 0, "listener", "capture"], "invalid"), ["descriptors", 1, "args"], true);
            const after = ordered_projected_value_replace(before, ["descriptors", 0, "args"], true);
            // This real submitted replacement also carries both invalid fields.
            // Its changed container cannot make their joint origin certain.
            operations.push(entry({ kind: "replace", path: [], prev: before, next: after }, systemName));
          }
          const r = receive(f.snapshot, route, local);
          try {
            r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
            rejects_atomically(r, { ...base, operations }, error => {
              assert.ok(error instanceof HsonSchemaError); assert.equal(error.code, "SCHEMA_VALIDATION");
              assert.equal(error.opIndex, undefined); assert.equal(error.cause, undefined); return true;
            }, f.valid);
          } finally { r.dispose(); }
        }
      });
      await check(`${label}: final Schema provenance survives composition changes on another descriptor`, () => {
        const f = expanded_fixture(2, undefined, true, true), base = route === "hosted" ? f.commit : f.expanded;
        const index = base.operations.length;
        const r = receive(f.snapshot, route, local);
        try {
          r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
          rejects_atomically(r, { ...base, operations: [...base.operations,
            entry({ kind: "set", path: ["descriptors", 0, "key"], prev: "run", next: 42 }, systemName),
            entry({ kind: "set", path: ["descriptors", 1, "key"], prev: "second", next: "changed" }, systemName)] }, error => {
            assert.ok(error instanceof HsonSchemaError); assert.equal(error.code, "SCHEMA_VALIDATION");
            assert.equal(error.opIndex, index); assert.equal(error.cause, undefined); return true;
          }, f.valid);
        } finally { r.dispose(); }
      });
    }
  }
  await check("durable composition provenance: recovery wrapping preserves the submitted source and valid restart", async () => {
    const map = fixture(); add_interaction(map, descriptor);
    const adapter = new MemoryCheckpointAdapter();
    const host = await create_persistent_locus_hosted_aggregate_internal({ map, persistence: adapter });
    let valid: ReturnType<MemoryCheckpointAdapter["state"]>;
    try {
      await host.stage(writer => writer.data.must("state").at(["n"]).set(1));
      valid = adapter.state(host.logicalMapId); assert.ok(valid);
    } finally { host.dispose(); }
    const record = valid.commits[0]; assert.ok(record);
    for (const scalar of [false, true]) {
      const invalid = { ...valid, commits: [{ ...record, commit: { ...record.commit, operationCount: 2, operations: [
        entry(scalar ? { kind: "set", path: ["descriptors", 0, "subject", "path", 0], prev: 0, next: -1 }
          : { kind: "set", path: ["descriptors", 0, "subject", "path"], prev: array([0]), next: array([-1]) }, systemName),
        entry({ kind: "set", path: ["descriptors", 0, "key"], prev: "run", next: "changed" }, systemName),
      ] } }] };
      adapter.seed(host.logicalMapId, invalid);
      const before = adapter.state(host.logicalMapId), appends = adapter.appendCalls.length, checkpoints = adapter.checkpointCalls.length;
      await assert.rejects(() => load_persistent_locus_hosted_aggregate_internal(host.logicalMapId, { persistence: adapter }), error => {
        assert.ok(error instanceof LocusPersistenceError); assert.equal(error.code, "LOCUS_PERSISTED_STATE_INVALID");
        assert.ok(error.cause instanceof LiveMapDocumentPathError);
        assert.equal(error.cause.code, "INVALID_DOCUMENT_PATH_INDEX");
        assert.equal(Reflect.get(error.cause, "opIndex"), scalar ? 0 : undefined); assert.equal(error.cause.cause, undefined); return true;
      });
      assert.deepEqual(adapter.state(host.logicalMapId), before);
      assert.equal(adapter.appendCalls.length, appends); assert.equal(adapter.checkpointCalls.length, checkpoints);
    }
    adapter.seed(host.logicalMapId, valid);
    const restored = await load_persistent_locus_hosted_aggregate_internal(host.logicalMapId, { persistence: adapter }); assert.ok(restored);
    try {
      const a = authority(restored.map);
      assert.equal(restored.rev, record.commit.rev); assert.equal(a.snap(a.libraries()[0]!, ["n"]), 1);
      assert.deepEqual(project_live_path(a.systemRoot(a.systemState(systemName)!), ["descriptors", 0, "subject", "path"]), array([0]));
      assert.equal(a.identityEpoch().issued().size, 0);
    } finally { restored.dispose(); }
  });
}

function array_value(value: OrderedProjectedValue | undefined): readonly OrderedProjectedValue[] {
  assert.ok(Array.isArray(value)); return value;
}

async function final_validation_cases(check: Check): Promise<void> {
  const nonnegative: HsonSchema = Hson.schema`<type "data" content <rows "any" n <number <int true min 0>>>>`;
  const unique: HsonSchema = Hson.schema`<type "data" content <rows <array <content "number" unique true>> n "number">>`;
  const nonnegativeRows: HsonSchema = Hson.schema`<type "data" content <rows <array <number <min 0>>> n "number">>`;
  for (const route of ["hosted", "durable", "echo"] as const) {
    await check(`${route} final Schema failures retain submitted provenance and permit retry`, () => {
      for (const count of [0, 1, 2, 3]) for (const prefix of [false, true]) {
        const f = expanded_fixture(count, nonnegative), base = route === "hosted" ? f.commit : f.expanded;
        const operations = [...base.operations.slice(0, -1), ...(prefix ? f.valid.operations : [])];
        const index = operations.length;
        operations.push(entry({ kind: "set", path: ["n"], prev: prefix ? 1 : 0, next: -1 }));
        const r = receive(f.snapshot, route, false, nonnegative);
        try {
          r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
          rejects_atomically(r, { ...base, operations }, error => {
            assert.ok(error instanceof HsonSchemaError);
            assert.equal(error.code, "SCHEMA_VALIDATION"); assert.deepEqual(error.path, ["n"]);
            assert.equal(error.opIndex, index);
            assert.equal(Object.hasOwn(error, "operationIndex"), false);
            assert.equal(error.cause, undefined);
            return true;
          }, f.valid);
        } finally { r.dispose(); }
      }
    });
    await check(`${route} final interaction subject failures retain provenance after Document and system prefixes`, () => {
      for (const count of [0, 1, 2, 3]) for (const prefix of [false, true]) {
        const f = expanded_fixture(count, undefined, true), base = route === "hosted" ? f.commit : f.expanded;
        const operations = [...base.operations];
        if (prefix) operations.push(entry({ kind: "set", path: ["descriptors", 0, "key"], prev: "run", next: "valid-prefix" }, systemName));
        const index = operations.length;
        operations.push(entry({ kind: "set", path: ["descriptors", 0, "subject", "library"], prev: "page", next: "missing" }, systemName));
        const r = receive(f.snapshot, route);
        try {
          r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
          rejects_atomically(r, { ...base, operations }, error => {
            assert.ok(error instanceof TypeError); assert.equal(error.name, "TypeError");
            assert.match(error.message, /subject.*document Library/);
            assert.equal(Reflect.get(error, "opIndex"), index);
            assert.equal(Object.hasOwn(error, "operationIndex"), false);
            assert.equal(error.cause, undefined); return true;
          }, f.valid);
        } finally { r.dispose(); }
      }
    });
    await check(`${route} joint final Schema failures remain truthfully unindexed and final-batch validation permits repairs`, () => {
      const f = expanded_fixture(2, unique), base = route === "hosted" ? f.commit : f.expanded;
      const operations = [...base.operations,
        entry({ kind: "set", path: ["rows", 0], prev: 1, next: 3 }),
        entry({ kind: "set", path: ["rows", 1], prev: 2, next: 3 })];
      const r = receive(f.snapshot, route, false, unique);
      try {
        r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
        // Neither change alone violates uniqueness. The public error has no
        // representation for joint attribution, so do not blame the last write.
        rejects_atomically(r, { ...base, operations }, error => {
          assert.ok(error instanceof HsonSchemaError); assert.equal(error.code, "SCHEMA_VALIDATION");
          assert.deepEqual(error.path, ["rows"]);
          assert.equal(Reflect.get(error, "opIndex"), undefined);
          assert.equal(Object.hasOwn(error, "operationIndex"), false);
          assert.equal(error.cause, undefined); return true;
        }, f.valid);
      } finally { r.dispose(); }
      for (const temporarilyInvalid of [false, true]) {
        const next = receive(f.snapshot, route, false, unique);
        const transient = temporarilyInvalid ? 2 : 3;
        const accepted: LiveMapAggregateCommit[] = [], stop = next.a.observe(c => accepted.push(c));
        try {
          const input = { ...base, operations: [...base.operations,
            entry({ kind: "set", path: ["rows", 0], prev: 1, next: transient }),
            entry({ kind: "set", path: ["rows", 1], prev: 2, next: 4 })] };
          const revision = next.map.rev; next.replay(input);
          assert.equal(next.map.rev, revision + 1); assert.deepEqual(next.a.snap(next.id, ["rows"]), [transient, 4]);
          assert.equal(accepted.length, 1);
          if (route === "hosted") assert.equal(JSON.stringify(portable(accepted[0]!)), JSON.stringify(input));
        } finally { stop(); next.dispose(); }
      }
    });
    await check(`${route} final Schema provenance survives a following valid write`, () => {
      const f = expanded_fixture(2, nonnegative), base = route === "hosted" ? f.commit : f.expanded;
      const index = base.operations.length;
      const r = receive(f.snapshot, route, false, nonnegative);
      try {
        r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
        rejects_atomically(r, { ...base, operations: [...base.operations,
          entry({ kind: "set", path: ["n"], prev: 1, next: -1 }),
          entry({ kind: "set", path: ["rows", 0], prev: 1, next: 8 })] },
        classified({ name: "HsonSchemaError", code: "SCHEMA_VALIDATION", opIndex: index }), f.valid);
      } finally { r.dispose(); }
    });
    await check(`${route} moving an invalid value cannot falsely blame the final structural operation`, () => {
      const f = expanded_fixture(2, nonnegativeRows), base = route === "hosted" ? f.commit : f.expanded;
      const r = receive(f.snapshot, route, false, nonnegativeRows);
      try {
        r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
        // The final coordinate differs from the write's original coordinate.
        // Attribution deliberately does not implement value lineage through
        // structural edits; it must not report the move merely for being last.
        rejects_atomically(r, { ...base, operations: [...base.operations,
          entry({ kind: "set", path: ["rows", 0], prev: 1, next: -1 }),
          entry({ kind: "move", path: ["rows"], from: 0, to: 1, prev: array([-1, 2]), next: array([2, -1]) })] }, error => {
          assert.ok(error instanceof HsonSchemaError); assert.deepEqual(error.path, ["rows", 1]);
          assert.equal(error.opIndex, undefined); assert.equal(error.cause, undefined); return true;
        }, f.valid);
      } finally { r.dispose(); }
    });
    if (route !== "hosted") await check(`${route} final validation retains provenance across filtered ordinary and zero-graph Document effects`, () => {
      const f = expanded_fixture(3, nonnegative), operations = [...f.expanded.operations];
      const zero = operations[1]; assert.ok(zero?.domain === "document" && is_flat_document_effect(zero.effect));
      const css = { rules: [], properties: [], keyframes: [], order: [{ kind: "text" as const, text: "aside { color: navy; }" }] };
      operations[1] = { ...zero, effect: { ...zero.effect, graphs: [], css,
        after: flat_document_fingerprint(f.before[1]!, css, []) } };
      // Ordinary Data is filtered out of the private Document decoding pass.
      // Keep it between Document effects, including the effect with no graphs.
      operations.splice(1, 0, entry({ kind: "set", path: ["n"], prev: 0, next: 1 }));
      operations.pop();
      const index = operations.length;
      operations.push(entry({ kind: "set", path: ["n"], prev: 1, next: -1 }));
      const r = receive(f.snapshot, route, false, nonnegative);
      try {
        r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
        rejects_atomically(r, { ...f.expanded, operations },
          classified({ name: "HsonSchemaError", code: "SCHEMA_VALIDATION", opIndex: index }), f.valid);
      } finally { r.dispose(); }
      const empty = receive(f.snapshot, route, false, nonnegative);
      try {
        empty.a.acquireLocalProjectedIdentity(empty.id, ["rows"], "000008901");
        const unchanged = [...operations];
        unchanged[2] = { ...zero, effect: { ...zero.effect, graphs: [], after: zero.effect.before } };
        rejects_atomically(empty, { ...f.expanded, operations: unchanged }, error => {
          assert.ok(error instanceof Error); assert.match(error.message, /cannot invent an unchanged revision/);
          assert.equal(Reflect.get(error, "opIndex"), 2); assert.equal(error.cause, undefined); return true;
        }, f.valid);
      } finally { empty.dispose(); }
    });
  }
  await check("receiving provenance preserves the original error and cause objects without aliases", () => {
    const cause = new Error("original cause"), error = new TypeError("original failure", { cause });
    assert.throws(() => with_livemap_replay_operation_index(7, () => { throw error; }), observed => {
      assert.equal(observed, error); assert.equal(error.cause, cause);
      assert.equal(Reflect.get(error, "opIndex"), 7); assert.equal(Object.hasOwn(error, "operationIndex"), false); return true;
    });
    const representation = new HostedAggregateRepresentationError("original representation", 0, { cause });
    assert.throws(() => with_livemap_replay_operation_index(7, () => { throw representation; }), observed => {
      assert.equal(observed, representation); assert.equal(representation.cause, cause);
      assert.equal(representation.operationIndex, 7); assert.equal(Object.hasOwn(representation, "opIndex"), false); return true;
    });
  });
}

async function residual_replay_cases(check: Check): Promise<void> {
  for (const route of ["hosted", "durable", "echo"] as const) {
    await check(`${route} rejects truthful unchanged system moves and other no-ops atomically`, () => {
      for (const local of route === "echo" ? [false, true] : [false]) {
        for (const kind of ["move", "same-index move", "set", "replace", "splice", "rename"] as const) {
          const map = fixture(); add_interaction(map, { ...descriptor, args: [1, 1] });
          const a = authority(map), snapshot = make_portable_aggregate_snapshot(a.captureHosted());
          const valid = portable(a.accept(a.prepare([{ target: a.target(a.libraries()[0]!, ["n"]), kind: "set", value: 1 }])).commit);
          const root = a.systemRoot(a.systemState(systemName)!);
          const args = project_live_path(root, ["descriptors", 0, "args"]); assert.ok(Array.isArray(args));
          const value = project_live_path(root, ["descriptors", 0]); assert.ok(value);
          const path = ["descriptors", 0, "args"];
          const operation: LiveMapProjectedDataOp = kind === "move" || kind === "same-index move"
            ? { kind: "move", path, from: 0, to: kind === "move" ? 1 : 0, prev: args, next: args }
            : kind === "splice" ? { kind: "splice", path, start: 0, removed: [1], inserted: [1], prev: args, next: args }
            : kind === "rename" ? { kind: "rename", path: ["descriptors", 0], from: "id", to: "id", prev: object_value(value), next: object_value(value) }
            : { kind, path, prev: args, next: args };
          for (const prefix of ["none", "changed", "retirement"] as const) {
            const operations = prefix === "none" ? [] : [entry({ kind: "set", path: ["n"], prev: 0, next: 1 })];
            if (prefix === "retirement") operations.push(entry({ kind: "replace", path: ["rows"], prev: array([1, 2]), next: array([1, 2]) }));
            operations.push(entry(operation, systemName));
            const r = receive(snapshot, route, local);
            try {
              r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
              rejects_atomically(r, { ...valid, operations },
                classified({ name: "LiveMapReplayInputError", code: "INVALID_REPLAY", reasonCode: "UNCHANGED_STAGED_OPERATION", opIndex: operations.length - 1 }), valid);
            } finally { r.dispose(); }
          }
        }
      }
    });
    await check(`${route} accepts changed argument moves and descriptor reordering with partition composition`, () => {
      const map = fixture(); add_interaction(map, { ...descriptor, args: [1, 2] });
      add_interaction(map, { ...descriptor, id: "second", key: "second" });
      const a = authority(map), system = a.systemState(systemName)!;
      const r = receive(make_portable_aggregate_snapshot(a.captureHosted()), route, route === "echo");
      const seen: LiveMapAggregateCommit[] = [], positions: number[] = [];
      const off = [r.a.observe(c => seen.push(c)), r.a.observeAuthorityPosition(rev => positions.push(rev))];
      try {
        for (const write of [
          { target: a.systemTarget(system, ["descriptors", 0, "args"]), kind: "move", from: 0, to: 1 },
          { target: a.systemTarget(system, ["descriptors"]), kind: "move", from: 0, to: 1 },
          { target: a.systemTarget(system, ["descriptors"]), kind: "splice", start: 0, deleteCount: 1, items: [] },
        ] satisfies LiveMapAggregateWrite[]) {
          const commit = portable(a.accept(a.prepare([write])).commit), revision = r.map.rev;
          r.replay(commit); assert.equal(r.map.rev, revision + 1); assert.equal(seen.length, positions.length);
          const shared = project_live_path(a.systemRoot(system), ["descriptors"]);
          const composed = project_live_path(r.a.systemRoot(r.a.systemState(systemName)!), ["descriptors"]);
          assert.ok(Array.isArray(shared)); assert.ok(Array.isArray(composed));
          assert.deepEqual(composed.slice(0, shared.length), shared);
          assert.equal(composed.length, shared.length + (route === "echo" ? 1 : 0));
          if (route !== "echo") assert.equal(JSON.stringify(portable(seen.at(-1)!)), JSON.stringify(commit));
        }
        assert.equal(seen.length, 3); assert.equal(positions.length, 3);
      } finally { off.forEach(stop => stop()); r.dispose(); }
    });
    await check(`${route} accepts an equal-scalar Data move alone without retiring identity`, () => {
      const map = fixture(), a = authority(map), id = a.libraries()[0]!;
      a.accept(a.prepare([{ target: a.target(id, ["rows", 1]), kind: "set", value: 1 }]));
      const r = receive(make_portable_aggregate_snapshot(a.captureHosted()), route);
      try {
        r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
        const issued = r.a.identityEpoch().issued(), overlay = r.a.projectedOverlay(r.id);
        const commit = portable(a.accept(a.prepare([{ target: a.target(id, ["rows"]), kind: "move", from: 0, to: 1 }])).commit);
        const rev = r.map.rev; r.replay(commit); assert.equal(r.map.rev, rev + 1);
        assert.deepEqual(r.a.snap(r.id, ["rows"]), [1, 1]);
        assert.deepEqual(enumerate_livemap_issued_quids(r.a.identityEpoch().issued()), enumerate_livemap_issued_quids(issued));
        assert.deepEqual(r.a.projectedOverlay(r.id).pathForQuid("000008901"), overlay.pathForQuid("000008901"));
      } finally { r.dispose(); }
    });
    await check(`${route} retains submitted indices after Document prefixes through codec and evidence validation`, () => {
      for (const count of [1, 3]) {
        const f = expanded_fixture(count);
        // Direct hosted receives individual graph operations; durable/Echo expand flat effects.
        const prefix = route === "hosted" ? f.commit : f.expanded;
        for (const tail of ["splice", "data conflict", "system", "wrong kind", "codec"] as const) {
          const index = prefix.operations.length;
          const badSplice = entry({ kind: "splice", path: ["rows"], start: 0, prev: [1, 2], next: [3, 2], removed: [999], inserted: [3] });
          const operation = tail === "data conflict" ? entry({ kind: "set", path: ["n"], prev: 0, next: 2 })
            : tail === "system" ? entry({ kind: "replace", path: ["descriptors"], prev: array([]), next: array([]) }, systemName)
            : tail === "wrong kind" ? { ...badSplice, kind: "replace" as const }
            : tail === "codec" ? { ...badSplice, payload: "[{}]" } : badSplice;
          const r = receive(f.snapshot, route);
          try {
            r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
            r.a.acquireLocalDocumentIdentity(r.a.libraries()[1]!, validate_document_path([0]), "000008902");
            const expected = tail === "data conflict" ? { name: "LiveMapReplayError", code: "REPLAY_CONFLICT", opIndex: index }
              : tail === "system" ? { name: "LiveMapReplayInputError", code: "INVALID_REPLAY", reasonCode: "UNCHANGED_STAGED_OPERATION", opIndex: index }
              : tail === "wrong kind" ? { name: "HostedAggregateRepresentationError", operationIndex: index }
              : tail === "codec" ? { name: "LiveMapTransportCodecError", code: undefined, opIndex: index }
              : { name: "LiveMapReplayInputError", code: "INVALID_REPLAY", reasonCode: "INVALID_REPLAY_ENVELOPE", opIndex: index };
            rejects_atomically(r, { ...prefix, operations: [...prefix.operations, operation] }, classified(expected), f.valid);
          } finally { r.dispose(); }
        }
        const r = receive(f.snapshot, route);
        try {
          const rev = r.map.rev; r.replay(prefix); assert.equal(r.map.rev, rev + 1);
          assert.equal(r.a.snap(r.id, ["n"]), 1);
          for (const id of r.a.libraries().slice(1, count + 1)) {
            assert.ok(JSON.stringify(r.a.root(id)).includes('"title":"first"'));
            assert.ok(JSON.stringify(r.a.root(id)).includes('"lang":"en"'));
          }
        } finally { r.dispose(); }
      }
    });
    await check(`${route} identifies the originating operation for failures inside Document effects`, () => {
      for (const failure of ["graph decoding", "graph planning", "final correspondence"] as const) {
        if (route === "hosted" && failure === "final correspondence") continue;
        const f = expanded_fixture(3), base = route === "hosted" ? f.commit : f.expanded;
        const input = { ...base, operations: [...structuredClone(base.operations)] };
        const index = route === "hosted" ? 3 : 1;
        const badGraph = encode_scoped_effect_graph_operation({ domain: "graph", op: "set-attr",
          target: { kind: "path", path: validate_document_path([99]) }, name: "title", value: "invalid" });
        const badPayload = failure === "graph decoding" ? "{" : badGraph;
        if (route === "hosted") {
          input.operations[index] = { ...f.commit.operations[index]!, payload: badPayload };
        } else {
          const operation = input.operations[index]!; assert.equal(operation.domain, "document");
          assert.ok(operation.domain === "document" && is_flat_document_effect(operation.effect));
          const graphs = [...operation.effect.graphs]; graphs[1] = badPayload;
          input.operations[index] = { ...operation, effect: failure === "final correspondence"
            ? { ...operation.effect, after: "0".repeat(64) } : { ...operation.effect, graphs } };
        }
        const r = receive(f.snapshot, route);
        try {
          r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
          const expected = failure === "graph decoding" ? { name: "HostedAggregateRepresentationError", operationIndex: index, causes: [{ name: "SyntaxError" }] }
            : failure === "graph planning" ? { name: "LiveMapDocumentMutationError", code: "DOCUMENT_PATH_OUT_OF_RANGE", opIndex: index,
              causes: [{ name: "LiveMapDocumentPathError", code: "DOCUMENT_PATH_OUT_OF_RANGE" }] }
            : { name: "Error", opIndex: index };
          rejects_atomically(r, input, classified(expected), f.valid);
        } finally { r.dispose(); }
      }
    });
    if (route !== "hosted") await check(`${route} retains provenance through scoped decoding and following ordinary evidence`, () => {
      const map = fixture(), a = authority(map), [state, page] = a.libraries(); assert.ok(state); assert.ok(page);
      const snapshot = make_portable_aggregate_snapshot(a.captureHosted());
      const root = structuredClone(a.root(page)), element = root.$_content[0]; assert.ok(is_Node(element));
      element.$_attrs = { title: "scoped replacement" };
      const accepted = a.accept(a.prepare([
        { target: a.target(page, []), kind: "graph", operation: { domain: "graph", op: "replace-root", mode: "document", root } },
        { target: a.target(state, ["n"]), kind: "set", value: 1 },
      ])).commit;
      assert.ok(accepted.hosted);
      const scoped = encode_authoritative_scoped_commit(accepted.hosted);
      const input: ReplayInput = { format: "hson-portable-aggregate-commit", authority: scoped.authority,
        registryDigest: scoped.registryDigest, prevRev: scoped.prevRev, rev: scoped.rev, operations: scoped.operations };
      const valid: PortableAggregateCommit = { ...input, operations: [entry({ kind: "set", path: ["n"], prev: 0, next: 1 })] };
      const effectIndex = input.operations.findIndex(op => op.domain === "document"); assert.ok(effectIndex >= 0);
      for (const failure of ["ordinal", "tail"] as const) {
        const operations = [...input.operations];
        if (failure === "ordinal") {
          const operation = operations[effectIndex]!;
          assert.ok(operation.domain === "document" && !is_flat_document_effect(operation.effect));
          operations[effectIndex] = { ...operation, effect: { ...operation.effect, ordinal: 9 } };
        } else operations.push(entry({ kind: "splice", path: ["rows"], start: 0,
          prev: [1, 2], next: [3, 2], removed: [999], inserted: [3] }));
        const r = receive(snapshot, route);
        try {
          r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008901");
          rejects_atomically(r, { ...input, operations }, classified(failure === "ordinal"
            ? { name: "TypeError", opIndex: effectIndex }
            : { name: "LiveMapReplayInputError", code: "INVALID_REPLAY", reasonCode: "INVALID_REPLAY_ENVELOPE", opIndex: input.operations.length }), valid);
        } finally { r.dispose(); }
      }
      const r = receive(snapshot, route);
      try { const rev = r.map.rev; r.replay(input); assert.equal(r.map.rev, rev + 1); assert.equal(r.a.snap(r.id, ["n"]), 1); }
      finally { r.dispose(); }
    });
  }
}

function object_value(value: import("../../src/core/ordered-projected-value.js").OrderedProjectedValue) {
  assert.ok(is_ordered_projected_object(value));
  return value;
}
