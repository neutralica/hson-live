import assert from "node:assert/strict";
import { Hson, add_interaction, enable_interactions, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import { project_authority_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { decode_locus_live_projected_envelope_internal, LOCUS_LIVE_PROJECTED_WIRE_FORMAT, project_locus_live_revision_internal } from "../src/api/locus/locus.live-projection.ts";
import { create_echo_aggregate_replica_capability_internal } from "../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import { projected_value_from_hson_node } from "../src/core/projected-value-graph.ts";
import { materialize_projected_value } from "../src/core/projected-value-materialization.ts";
import { INTERACTION_RESERVED_LIBRARY_KEY } from "../src/internal/interaction-storage.ts";
import { make_echo_document_authority } from "../src/api/echo/echo.document-authority.ts";

const DataSchema: HsonSchema = Hson.schema`<type "data" content <value "string">>`;
const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" content "empty">`;
const LocalSchema: HsonSchema = Hson.schema`<type "data" content <value "string">>`;
const authority = hsonLiveMap.fromLibraries({
  visibleA: { data: { value: "A0" }, schema: DataSchema },
  visibleB: { data: { value: "B0" }, schema: DataSchema },
  PRIVATE_NAME_SENTINEL: { data: { value: "PRIVATE_ROOT_SENTINEL" }, schema: DataSchema },
  UNSELECTED_NAME_SENTINEL: { data: { value: "UNSELECTED_ROOT_SENTINEL" }, schema: DataSchema },
  page: { document: "<main/>", schema: PageSchema },
  hiddenDoc: { document: "<main/>", schema: PageSchema },
});
enable_interactions(authority);
const engine = internal_livemap_aggregate_authority(authority);
const initial = engine.captureHosted();
const exposure = initial.registry.libraries.filter((entry) => entry.scope !== "hson-internal").map((entry) => ({
  library: entry.name, exposure: entry.name === "PRIVATE_NAME_SENTINEL" || entry.name === "hiddenDoc" ? "server-private" as const : "client-public" as const,
}));
const policy = make_locus_hosted_projection_policy(initial.registry, initial.authority, exposure, undefined,
  () => ({ libraries: ["visibleA", "visibleB", "page"], systemFeatures: ["interactions"] }));
const selectedA = await normalize_locus_effective_projection(policy,
  { libraries: ["visibleA", "page"], systemFeatures: ["interactions"] });
const selectedB = await normalize_locus_effective_projection(policy, { libraries: ["visibleB"] });
const selectedBoth = await normalize_locus_effective_projection(policy, { libraries: ["visibleA", "visibleB"] });
const snapshotA = project_authority_snapshot(initial, selectedA);
const snapshotB = project_authority_snapshot(initial, selectedB);
const authorityProgress = project_locus_live_revision_internal(Object.freeze({
  format: "hson-hosted-commit", authority: initial.authority, registryDigest: initial.registryDigest,
  changed: false, prevRev: initial.revision, rev: initial.revision + 1,
  operations: Object.freeze([]), replay: Object.freeze({ operations: Object.freeze([]) }),
}), initial, Object.freeze({ ...initial, revision: initial.revision + 1 }), selectedA);
assert.equal(authorityProgress.kind, "progress");
const clientA = hsonLiveMap.fromClientSnapshot({ authority: snapshotA,
  localLibraries: { local: { data: { value: "LOCAL" }, schema: LocalSchema } } });
const clientB = hsonLiveMap.fromClientSnapshot({ authority: snapshotB,
  localLibraries: { local: { data: { value: "LOCAL" }, schema: LocalSchema } } });
const replicaA = create_echo_aggregate_replica_capability_internal(clientA);
const replicaB = create_echo_aggregate_replica_capability_internal(clientB);
let before = initial;
let cursorA = initial.revision;
let cursorB = initial.revision;
const ids = new Map(initial.registry.libraries.filter((entry) => entry.scope !== "hson-internal")
  .map((entry, index) => [entry.name, engine.libraries()[index]!]));
function set(name: string, value: string) {
  const identity = ids.get(name);
  if (identity === undefined) throw new Error("Missing library identity.");
  return { target: engine.target(identity, ["value"]), kind: "set" as const, value };
}
function deliver(commit: NonNullable<ReturnType<typeof engine.commit>["hosted"]>) {
  const after = engine.captureHosted();
  const a = project_locus_live_revision_internal(commit, before, after, selectedA);
  const b = project_locus_live_revision_internal(commit, before, after, selectedB);
  for (const [event, projection, replica, cursor] of [[a, selectedA, replicaA, cursorA], [b, selectedB, replicaB, cursorB]] as const) {
    const projectedRegistry = replica.clientProjection()?.registry.digest;
    assert.ok(projectedRegistry);
    const encoded = JSON.stringify(event.kind === "commit" ? {
      format: LOCUS_LIVE_PROJECTED_WIRE_FORMAT, logicalMapId: projection.authority.logicalMapId,
      incarnationId: projection.authority.incarnationId, registryDigest: event.commit.registryDigest, commit: event.commit,
    } : event.progress);
    for (const sentinel of ["PRIVATE_NAME_SENTINEL", "PRIVATE_SENTINEL", "UNSELECTED_NAME_SENTINEL", "UNSELECTED_SENTINEL", "HIDDEN_INTERACTION_SENTINEL"]) {
      assert.equal(encoded.includes(sentinel), false, `Hidden sentinel crossed: ${sentinel}`);
    }
    assert.equal(encoded.toLowerCase().includes("quid"), false);
    if (event.kind === "commit") {
      assert.equal(event.commit.prevRev, cursor);
      assert.equal(event.commit.rev, after.revision);
      const decoded = decode_locus_live_projected_envelope_internal(JSON.parse(encoded), {
        logicalMapId: projection.authority.logicalMapId, incarnationId: projection.authority.incarnationId,
        registryDigest: projectedRegistry,
      });
      replica.replayHosted(decoded, cursor);
    } else {
      assert.equal(event.progress.prevRev, cursor);
      assert.equal(event.progress.rev, after.revision);
      assert.deepEqual(Object.keys(JSON.parse(encoded)).sort(), ["incarnationId", "logicalMapId", "prevRev", "registryDigest", "rev"]);
      replica.advanceHostedProgress(event.progress);
    }
  }
  cursorA = after.revision;
  cursorB = after.revision;
  before = after;
  return { a, b };
}

const first = engine.commit([set("visibleA", "VISIBLE_SENTINEL"), set("visibleB", "B1"),
  set("PRIVATE_NAME_SENTINEL", "PRIVATE_SENTINEL"), set("UNSELECTED_NAME_SENTINEL", "UNSELECTED_SENTINEL")]).hosted;
assert.ok(first);
const both = project_locus_live_revision_internal(first, initial, engine.captureHosted(), selectedBoth);
assert.equal(both.kind, "commit");
if (both.kind === "commit") {
  assert.equal(both.commit.rev, first.rev);
  assert.deepEqual(both.commit.operations.map((entry) => entry.library), ["visibleA", "visibleB"]);
}
const mixed = deliver(first);
assert.equal(mixed.a.kind, "commit");
assert.equal(mixed.b.kind, "commit");
if (mixed.a.kind === "commit" && mixed.b.kind === "commit") {
  assert.deepEqual(mixed.a.commit.operations.map((entry) => entry.library), ["visibleA"]);
  assert.deepEqual(mixed.b.commit.operations.map((entry) => entry.library), ["visibleB"]);
  assert.equal(mixed.a.commit.rev, mixed.b.commit.rev);
}
const dataA = clientA.lib("visibleA");
const dataB = clientB.lib("visibleB");
const localA = clientA.lib("local");
if (dataA.mode === "document" || dataB.mode === "document" || localA.mode === "document") throw new Error("Expected data libraries.");
assert.equal(dataA.snap(["value"]), "VISIBLE_SENTINEL");
assert.equal(dataB.snap(["value"]), "B1");
assert.equal(clientA.rev, 1);
assert.equal(clientB.rev, 1);

const completionListeners = new Set<(revision: number) => void>();
const completion = make_echo_document_authority(
  async () => Object.freeze({ accepted: true, completionRev: 2 }),
  () => cursorA,
  (listener) => { completionListeners.add(listener); return () => { completionListeners.delete(listener); }; },
  () => true, replicaA.onDispose, async () => {},
  () => selectedA.authority, replicaA.onStateChange, () => replicaA.failure,
);
let completed = false;
const waiting = completion.enqueue(() => Object.freeze({ name: "document.attrs.clear" as const,
  payload: { target: { kind: "path" as const, path: [0] } } }));
void waiting.then(() => { completed = true; });
for (let turn = 0; turn < 8 && completion.pendingRevisionWaits() === 0; turn += 1) await Promise.resolve();
assert.equal(completion.pendingRevisionWaits(), 1);

localA.at(["value"]).set("LOCAL_MUTATION");
assert.equal(clientA.rev, 2);
assert.equal(completed, false);
const privateOnly = engine.commit([set("PRIVATE_NAME_SENTINEL", "PRIVATE_SENTINEL_2")]).hosted;
assert.ok(privateOnly);
const hidden = deliver(privateOnly);
assert.equal(hidden.a.kind, "progress");
assert.equal(hidden.b.kind, "progress");
assert.equal(clientA.rev, 2);
assert.equal(clientB.rev, 1);
assert.equal(localA.snap(["value"]), "LOCAL_MUTATION");
assert.equal(cursorA, 2);
for (const listener of completionListeners) listener(cursorA);
await waiting;
assert.equal(completed, true);
assert.equal(completion.pendingRevisionWaits(), 0);
completion.dispose();

const unselectedOnly = engine.commit([set("UNSELECTED_NAME_SENTINEL", "UNSELECTED_SENTINEL_2")]).hosted;
assert.ok(unselectedOnly);
assert.equal(deliver(unselectedOnly).a.kind, "progress");
const nextVisible = engine.commit([set("visibleA", "A2")]).hosted;
assert.ok(nextVisible);
const subsequent = deliver(nextVisible);
assert.equal(subsequent.a.kind, "commit");
assert.equal(subsequent.b.kind, "progress");
assert.equal(clientA.rev, 3);
assert.equal(localA.snap(["value"]), "LOCAL_MUTATION");
assert.equal(cursorA, 4);

const listener = Object.freeze({ event: "click", target: "element" as const, capture: false, once: false,
  passive: false, missingTarget: "ignore" as const, preventDefault: false, stopPropagation: false,
  stopImmediatePropagation: false });
let observed: NonNullable<ReturnType<typeof engine.commit>["hosted"]> | undefined;
const stop = engine.observe((commit) => { observed = commit.hosted; });
add_interaction(authority, { id: "visible", subject: { library: "page", path: [99] }, listener,
  kind: "browser-local", key: "VISIBLE_INTERACTION_SENTINEL", args: Hson.data.from(null) });
assert.ok(observed);
const visibleInteraction = deliver(observed);
assert.equal(visibleInteraction.a.kind, "commit");
assert.equal(visibleInteraction.b.kind, "progress");
if (visibleInteraction.a.kind === "commit") {
  assert.deepEqual(visibleInteraction.a.commit.operations.map((entry) => entry.library), ["@hson/canonical-interactions/v1"]);
  assert.ok(JSON.stringify(visibleInteraction.a).includes("VISIBLE_INTERACTION_SENTINEL"));
}
observed = undefined;
add_interaction(authority, { id: "hidden", subject: { library: "hiddenDoc", path: [99] }, listener,
  kind: "browser-local", key: "HIDDEN_INTERACTION_SENTINEL", args: Hson.data.from(null) });
assert.ok(observed);
const hiddenInteraction = deliver(observed);
assert.equal(hiddenInteraction.a.kind, "progress");
assert.equal(hiddenInteraction.b.kind, "progress");
const system = engine.systemState(INTERACTION_RESERVED_LIBRARY_KEY);
assert.ok(system);
const interactionState = materialize_projected_value(projected_value_from_hson_node(engine.systemRoot(system)));
const descriptors = JSON.parse(JSON.stringify(interactionState)).descriptors;
const extra = { ...descriptors[0], id: "visible-two", key: "VISIBLE_INTERACTION_TWO_SENTINEL" };
const mixedSystem = engine.commit([set("visibleA", "A_SYSTEM"), {
  target: engine.systemTarget(system, ["descriptors"]), kind: "replace", value: [...descriptors, extra],
}]).hosted;
assert.ok(mixedSystem);
const mixedSystemEvent = deliver(mixedSystem);
assert.equal(mixedSystemEvent.a.kind, "commit");
assert.equal(mixedSystemEvent.b.kind, "progress");
if (mixedSystemEvent.a.kind === "commit") {
  assert.deepEqual(mixedSystemEvent.a.commit.operations.map((entry) => entry.library), ["visibleA", INTERACTION_RESERVED_LIBRARY_KEY]);
  const wire = JSON.stringify(mixedSystemEvent.a);
  assert.ok(wire.includes("VISIBLE_INTERACTION_TWO_SENTINEL"));
  assert.equal(wire.includes("HIDDEN_INTERACTION_SENTINEL"), false);
}
observed = undefined;
const page = authority.lib("page");
if (page.mode !== "document") throw new Error("Expected page document.");
page.document.attrs.set({ kind: "path", path: [0] }, "title", "VISIBLE_DOCUMENT_SENTINEL");
assert.ok(observed);
const documentEffect = deliver(observed);
assert.equal(documentEffect.a.kind, "commit");
assert.equal(documentEffect.b.kind, "progress");
if (documentEffect.a.kind === "commit") {
  const documentDigest = documentEffect.a.commit.registryDigest;
  assert.deepEqual(documentEffect.a.commit.operations.map((entry) => entry.library), ["page"]);
  assert.ok(JSON.stringify(documentEffect.a).includes("VISIBLE_DOCUMENT_SENTINEL"));
  const forged = JSON.parse(JSON.stringify({ format: LOCUS_LIVE_PROJECTED_WIRE_FORMAT,
    logicalMapId: selectedA.authority.logicalMapId, incarnationId: selectedA.authority.incarnationId,
    registryDigest: documentDigest, commit: documentEffect.a.commit }));
  forged.commit.prevRev = cursorA;
  forged.commit.rev = cursorA + 1;
  forged.commit.operations[0].kind = "ensure-quid";
  forged.commit.operations[0].payload = JSON.stringify({ ...JSON.parse(forged.commit.operations[0].payload), quid: "000000001" });
  const prior = clientA.rev;
  assert.throws(() => replicaA.replayHosted(decode_locus_live_projected_envelope_internal(forged, {
    ...selectedA.authority, registryDigest: documentDigest,
  }), cursorA));
  assert.equal(clientA.rev, prior);
}
const atomic = engine.commit([set("visibleA", "A3"), set("visibleA", "A4")]).hosted;
assert.ok(atomic);
const afterAtomic = engine.captureHosted();
const atomicA = project_locus_live_revision_internal(atomic, before, afterAtomic, selectedA);
assert.equal(atomicA.kind, "commit");
if (atomicA.kind === "commit") {
  assert.equal(atomicA.commit.operations.length, 2);
  const wire = { format: LOCUS_LIVE_PROJECTED_WIRE_FORMAT,
    logicalMapId: selectedA.authority.logicalMapId, incarnationId: selectedA.authority.incarnationId,
    registryDigest: atomicA.commit.registryDigest, commit: atomicA.commit };
  const priorRev = clientA.rev;
  const priorValue = dataA.snap(["value"]);
  const oldVersion = JSON.parse(JSON.stringify(wire));
  oldVersion.commit.format = "hson-hosted-client-commit-v1";
  assert.throws(() => decode_locus_live_projected_envelope_internal(oldVersion, {
    ...selectedA.authority, registryDigest: atomicA.commit.registryDigest,
  }));
  const hostile = JSON.parse(JSON.stringify(wire));
  hostile.commit.operations[1].payload = "MALFORMED_SENTINEL";
  assert.throws(() => replicaA.replayHosted(decode_locus_live_projected_envelope_internal(hostile, {
    ...selectedA.authority, registryDigest: atomicA.commit.registryDigest,
  }), cursorA));
  assert.equal(clientA.rev, priorRev);
  assert.equal(dataA.snap(["value"]), priorValue);
  const localTarget = JSON.parse(JSON.stringify(wire));
  localTarget.commit.operations[0].library = "local";
  assert.throws(() => replicaA.replayHosted(decode_locus_live_projected_envelope_internal(localTarget, {
    ...selectedA.authority, registryDigest: atomicA.commit.registryDigest,
  }), cursorA));
  assert.equal(clientA.rev, priorRev);
  assert.equal(localA.snap(["value"]), "LOCAL_MUTATION");
}
deliver(atomic);
stop();

replicaA.dispose();
replicaB.dispose();
process.stdout.write("Step 6C live projection acceptance passed.\n");
