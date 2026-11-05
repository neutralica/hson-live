import assert from "node:assert/strict";
import { hsonLiveMap } from "../../src/index.js";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.js";
import { canonical_graph_equal } from "../../src/api/livemap/livemap.document.install.js";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.js";
import { make_portable_aggregate_snapshot, make_portable_aggregate_commit } from "../../src/api/livemap/livemap.hosted.js";
import { encode_livemap_replay_transport } from "../../src/api/livemap/livemap.transport.js";
import { compose_client_portable_aggregate_internal } from "../../src/api/echo/echo.projection.js";
import { create_echo_aggregate_replica_capability_internal } from "../../src/api/echo/echo.aggregate-replica.lifecycle.js";
import { ordered_projected_array, ordered_projected_object } from "../../src/core/ordered-projected-value.js";
import { admit_projected_value } from "../../src/core/projected-value-admission.js";
import type { LiveMapProjectedDataOp } from "../../src/api/livemap/livemap.transport.js";
import type { PortableAggregateCommit } from "../../src/api/livemap/livemap.hosted.js";
import type { PortableAggregateSnapshot } from "../../src/api/livemap/livemap.hosted.internal.types.js";
import type { LiveMapAggregateCommit } from "../../src/api/livemap/livemap.library.js";

type Check = (name: string, run: () => void | Promise<void>) => Promise<void>;
type Route = "hosted" | "durable" | "echo";
function receive(snapshot: PortableAggregateSnapshot, route: Route) {
  const map = route === "echo" ? compose_client_portable_aggregate_internal(snapshot, [])
    : hsonLiveMap.fromLibraries({ state: { data: {} } });
  const a = authority(map);
  if (route !== "echo") a.restoreClientHosted(snapshot);
  const id = a.libraries()[0]!;
  const cap = route === "echo" ? create_echo_aggregate_replica_capability_internal(map) : undefined;
  return { map, a, id, replay: (commit: PortableAggregateCommit) => {
    if (cap) cap.replayHosted(commit, a.clientProjection()!.revision);
    else if (route === "durable") a.replayDurableHosted(commit);
    else a.replayClientHosted(commit);
  }, dispose: () => cap?.dispose() };
}
function portable(commit: LiveMapAggregateCommit): PortableAggregateCommit {
  assert.ok(commit.hosted);
  const result = make_portable_aggregate_commit(commit.hosted);
  assert.ok(result); return result;
}
function with_operations(template: PortableAggregateCommit, operations: readonly LiveMapProjectedDataOp[]): PortableAggregateCommit {
  return { ...template, operations: operations.map(op => ({
    library: "state", domain: "data", kind: op.kind,
    ...encode_livemap_replay_transport([op]),
  })) };
}

export async function livemap_equal_effect_replay_cases(check: Check): Promise<void> {
  for (const route of ["hosted", "durable", "echo"] as const) {
    for (const invalid of ["empty splice", "equal scalar replacement", "equal primitive splice", "equal array scalar replacement"] as const) {
      await check(`${route} rejects ${invalid} with complete replay atomicity`, () => {
        const source = hsonLiveMap.fromLibraries({ state: { data: { rows: [1], n: 0 } } });
        const a = authority(source), id = a.libraries()[0]!;
        const snapshot = make_portable_aggregate_snapshot(a.captureHosted());
        const valid = portable(a.accept(a.prepare([{ target: a.target(id, ["n"]), kind: "set", value: 1 }])).commit);
        // Also reject after an earlier changed operation or planned identity retirement.
        for (const prefix of ["none", "changed", "retirement"] as const) {
          const r = receive(snapshot, route);
          try {
            r.a.acquireLocalProjectedIdentity(r.id, [], "000008801");
            r.a.acquireLocalProjectedIdentity(r.id, ["rows"], "000008802");
            // Neither an eligible parent nor a scalar's physical wrapper carries its effect.
            assert.throws(() => r.a.acquireLocalProjectedIdentity(r.id, ["rows", 0], "000008803"));
            assert.throws(() => r.a.acquireLocalProjectedIdentity(r.id, ["n"], "000008803"));
            const root = r.a.root(r.id), before = structuredClone(root);
            const epoch = r.a.identityEpoch(), ledger = epoch.issued(), epochNumber = epoch.current();
            const issued = enumerate_livemap_issued_quids(ledger), overlay = r.a.projectedOverlay(r.id);
            const position = r.a.hostedPosition(), projection = r.a.clientProjection(), registry = r.a.hostedRegistry();
            const evidence = JSON.stringify(r.a.captureHosted()), fence = r.a.captureFence();
            const accounting = r.a.telemetry();
            const accepted: LiveMapAggregateCommit[] = [], published: number[] = [], installed: number[] = [];
            let observations = 0, restores = 0, watched = 0;
            const off = [r.a.observe(c => accepted.push(c)), r.map.commits.observe(() => observations++),
              r.a.observeAuthorityPosition(rev => published.push(rev)),
              r.a.observeAuthorityPosition(rev => installed.push(rev), "installed"),
              r.a.observeRestore(() => restores++), r.a.watch(r.id, ["n"], () => watched++)];
            try {
              const operations: LiveMapProjectedDataOp[] = prefix === "changed"
                ? [{ kind: "set", path: ["n"], prev: 0, next: 1 }]
                : prefix === "retirement" ? [{ kind: "replace", path: ["rows"],
                  prev: ordered_projected_array([1]), next: ordered_projected_array([1]) }] : [];
              const n = prefix === "changed" ? 1 : 0;
              operations.push(invalid === "equal scalar replacement" ? { kind: "replace", path: ["n"], prev: n, next: n }
                : invalid === "equal array scalar replacement" ? { kind: "replace", path: ["rows", 0], prev: 1, next: 1 }
                : { kind: "splice", path: ["rows"], start: 0,
                  removed: invalid === "empty splice" ? [] : [1], inserted: invalid === "empty splice" ? [] : [1], prev: [1], next: [1] });
              const input = with_operations(valid, operations), inputBytes = JSON.stringify(input);
              assert.throws(() => r.replay(input), {
                code: "INVALID_REPLAY", reasonCode: "UNCHANGED_STAGED_OPERATION", opIndex: operations.length - 1,
              });
              assert.equal(JSON.stringify(input), inputBytes, "rejected durable/receiving evidence is untouched");
              assert.equal(r.a.root(r.id), root); assert.equal(canonical_graph_equal(root, before), true);
              assert.deepEqual(r.map.data.must("state").snap(), { rows: [1], n: 0 });
              assert.equal(r.map.rev, 0); assert.deepEqual(r.a.hostedPosition(), position);
              assert.deepEqual(r.a.clientProjection(), projection); assert.equal(r.a.hostedRegistry(), registry);
              assert.equal(r.a.identityEpoch(), epoch); assert.equal(epoch.current(), epochNumber);
              assert.equal(epoch.issued(), ledger); assert.deepEqual(enumerate_livemap_issued_quids(ledger), issued);
              assert.equal(r.a.projectedOverlay(r.id), overlay);
              assert.equal(JSON.stringify(r.a.captureHosted()), evidence); assert.doesNotThrow(fence);
              assert.equal(r.a.telemetry().acceptedTransitions, accounting.acceptedTransitions);
              assert.equal(r.a.telemetry().aggregatePublications, accounting.aggregatePublications);
              assert.deepEqual([accepted, published, installed], [[], [], []]);
              assert.deepEqual([observations, restores, watched], [0, 0, 0]);
              // The same authority position remains usable; rejection leaves no queued publication.
              r.replay(valid);
              assert.equal(r.map.rev, 1); assert.equal(r.a.hostedPosition().revision, 1);
              assert.equal(r.a.clientProjection()?.revision ?? 1, 1);
              assert.deepEqual(r.map.data.must("state").snap(), { rows: [1], n: 1 });
              assert.equal(accepted.length, 1);
              assert.deepEqual(accepted[0]!.operations.map(op => op.operation), [{ kind: "set", path: ["n"], prev: 0, next: 1 }]);
              if (route !== "echo") assert.deepEqual(portable(accepted[0]!), valid);
              assert.deepEqual([published, installed], [[1], [1]]);
              assert.deepEqual([observations, restores, watched], [1, 0, 1]);
              assert.deepEqual(r.a.projectedOverlay(r.id).pathForQuid("000008802"), ["rows"]);
              assert.equal(epoch.current(), epochNumber); assert.deepEqual(enumerate_livemap_issued_quids(epoch.issued()), issued);
            } finally { off.forEach(stop => stop()); }
          } finally { r.dispose(); }
        }
      });
    }
    await check(`${route} replays retirement of eligible empty object and array children`, () => {
      for (const value of [{}, []]) for (const kind of ["replace", "splice"] as const) {
        const source = hsonLiveMap.fromLibraries({ state: { data: { rows: [value] } } });
        const a = authority(source), id = a.libraries()[0]!;
        a.acquireLocalProjectedIdentity(id, ["rows", 0], "000008831");
        const r = receive(make_portable_aggregate_snapshot(a.captureHosted()), route);
        try {
          const valueCarrier = admit_projected_value(value);
          const effect = portable(a.accept(a.prepare([kind === "replace"
            ? { target: a.target(id, ["rows", 0]), kind, value: valueCarrier }
            : { target: a.target(id, ["rows"]), kind, start: 0, deleteCount: 1, items: [valueCarrier] }])).commit);
          r.replay(effect);
          assert.equal(r.map.rev, 1); assert.equal(r.a.hostedPosition().revision, 1);
          assert.deepEqual(r.a.snap(r.id), { rows: [value] });
          assert.equal(a.projectedOverlay(id).pathForQuid("000008831"), undefined);
          assert.equal(a.identityEpoch().issued().has("000008831"), true);
          assert.equal(r.a.identityEpoch().issued().size, 0);
          assert.equal(effect.operations[0]!.kind, kind);
        } finally { r.dispose(); }
      }
    });
    await check(`${route} preserves ordered equal container retirement with fresh receiver correspondence`, () => {
      for (const localClaims of [false, true]) {
        const source = hsonLiveMap.fromLibraries({ state: { data: { rows: [{ n: 1 }, [{ n: 2 }], 3], n: 0 } } });
        const a = authority(source), id = a.libraries()[0]!;
        const paths = [[], ["rows"], ["rows", 0], ["rows", 1], ["rows", 1, 0]] as const;
        paths.forEach((path, index) => a.acquireLocalProjectedIdentity(id, path, `00000881${index}`));
        const snapshot = make_portable_aggregate_snapshot(a.captureHosted()), r = receive(snapshot, route);
        try {
          assert.equal(r.a.identityEpoch().issued().size, 0, "portable restoration never imports source claims");
          if (localClaims) paths.forEach((path, index) => r.a.acquireLocalProjectedIdentity(r.id, path, `00000882${index}`));
          const epoch = r.a.identityEpoch(), beforeEpoch = epoch.current(), beforeData = r.a.snap(r.id);
          const beforeLedger = enumerate_livemap_issued_quids(epoch.issued());
          const seen: LiveMapAggregateCommit[] = [], published: number[] = [], installed: number[] = [];
          const off = [r.a.observe(c => seen.push(c)),
            r.a.observeAuthorityPosition(rev => published.push(rev)),
            r.a.observeAuthorityPosition(rev => installed.push(rev), "installed")];
          try {
            assert.equal(source.data.state.at(["rows", 0]).set({ n: 1 }).changed, false);
            const accepted = a.accept(a.prepare([
              { target: a.target(id, ["rows", 0]), kind: "replace", value: ordered_projected_object([["n", 1]]) },
              { target: a.target(id, ["rows"]), kind: "splice", start: 1, deleteCount: 1,
                items: [ordered_projected_array([ordered_projected_object([["n", 2]])])] },
            ])).commit;
            const effect = portable(accepted), bytes = JSON.stringify(effect);
            assert.equal(accepted.changed, true); assert.equal(source.rev, 1);
            assert.deepEqual(a.snap(id), beforeData, "the accepted identity effect has equal Data");
            assert.deepEqual(effect.operations.map(op => op.kind), ["replace", "splice"]);
            assert.ok(!/00000881|issuedQuids|identityEpoch/.test(bytes));
            r.replay(effect);
            assert.equal(r.map.rev, 1); assert.equal(r.a.hostedPosition().revision, 1);
            assert.deepEqual(r.a.snap(r.id), beforeData); assert.equal(epoch.current(), beforeEpoch);
            assert.deepEqual(enumerate_livemap_issued_quids(epoch.issued()), beforeLedger);
            assert.equal(seen.length, 1); assert.equal(seen[0]!.changed, true);
            assert.deepEqual(seen[0]!.operations.map(op => op.operation), accepted.operations.map(op => op.operation));
            if (route !== "echo") assert.deepEqual(portable(seen[0]!), effect);
            assert.equal(JSON.stringify(effect), bytes);
            assert.deepEqual([published, installed], [[1], [1]]);
            for (const [index, path] of paths.entries()) {
              assert.deepEqual(a.projectedOverlay(id).pathForQuid(`00000881${index}`), index < 2 ? path : undefined);
              assert.equal(a.identityEpoch().issued().has(`00000881${index}`), true);
              assert.deepEqual(r.a.projectedOverlay(r.id).pathForQuid(`00000882${index}`), localClaims && index < 2 ? path : undefined);
              assert.equal(epoch.issued().has(`00000881${index}`), false);
            }
            if (localClaims) assert.throws(() => r.a.acquireLocalProjectedIdentity(r.id, ["rows", 0], "000008822"));
            assert.throws(() => a.acquireLocalProjectedIdentity(id, ["rows", 1], "000008813"));
            const next = portable(a.accept(a.prepare([{ target: a.target(id, ["n"]), kind: "set", value: 1 }])).commit);
            r.replay(next); assert.equal(r.map.rev, 2); assert.equal(seen.length, 2);
            assert.deepEqual(seen[1]!.operations.map(op => op.operation), [{ kind: "set", path: ["n"], prev: 0, next: 1 }]);
            if (route !== "echo") assert.deepEqual(portable(seen[1]!), next);
            assert.deepEqual([published, installed], [[1, 2], [1, 2]]);
          } finally { off.forEach(stop => stop()); }
        } finally { r.dispose(); }
      }
    });
  }
}
