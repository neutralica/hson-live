import assert from "node:assert/strict";
import { isMainThread, parentPort } from "node:worker_threads";
import { ANY_DATA, ANY_DOCUMENT, Hson, hsonLiveMap, enable_interactions, type HsonSchema, type LiveMap } from "../src/index.ts";
import { install_libraries_snapshot, type LiveMapCommit } from "../src/api/livemap/index.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { HsonSchema as RuntimeHsonSchema } from "../src/api/schema/hson-schema.ts";
import { project_authority_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import { projected_registry_digest } from "../src/api/locus/locus.live-projection.ts";
import { locus_map_internal } from "../src/internal/governor-maps.ts";
import { authority_definition_from_fixture_options, create_locus_fixture } from "./helpers/locus-definition-fixture.mts";
import { client_projection_map } from "./helpers/client-projection.mts";
import { test_public_projection } from "./helpers/hosted-catalog.mts";
import { acquire_projected_identity, acquire_document_identity } from "./helpers/livemap-identity-internal.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { HostedAggregateRepresentationError, make_portable_aggregate_snapshot, registry_from_entries } from "../src/api/livemap/livemap.hosted.ts";
import { hson_schema_digest } from "../src/api/schema/hson-schema.ts";
import { compose_client_portable_aggregate_internal } from "../src/api/echo/echo.projection.ts";
import { create_echo_aggregate_replica_capability_internal } from "../src/api/echo/echo.aggregate-replica.lifecycle.ts";
import type { LiveMapSnapshot } from "../src/types/livemap.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.schema-use", title: "Immutable admitted Library Schema bindings",
  category: "LiveMap", runtime: "node", tags: Object.freeze(["livemap", "schema", "replay", "atomicity", "worker"]),
});
const events = create_test_event_emitter("livemap.schema-use");
const observerReports: unknown[] = [];
const reportingGlobal = globalThis as typeof globalThis & { reportError?: (error: unknown) => void };
const originalReportError = reportingGlobal.reportError;
reportingGlobal.reportError = error => { observerReports.push(error); };
process.once("exit", () => {
  if (originalReportError === undefined) Reflect.deleteProperty(reportingGlobal, "reportError");
  else reportingGlobal.reportError = originalReportError;
});
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  events.case_begin(name, name);
  try { await run(); checks += 1; events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
const SlideSchema = Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "main" attrs <props <title <optional "string">>> content "empty">]>>]>>` as HsonSchema<unknown, "document">;
const OtherSlideSchema = Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "section" content "empty">]>>]>>` as HsonSchema<unknown, "document">;
const StateSchema = Hson.schema`<type "data" content <count "number">>` as HsonSchema<unknown, "data">;
const OtherStateSchema = Hson.schema`<type "data" content <name "string">>` as HsonSchema<unknown, "data">;

// Capture both public state and exact internal authority/identity evidence.
function evidence(map: LiveMap) {
  const authority = internal_livemap_aggregate_authority(map);
  const epoch = authority.identityEpoch();
  return {
    snapshot: map.capture(), hosted: authority.captureHosted(), position: authority.hostedPosition(),
    registry: authority.hostedRegistry(), epoch: epoch.current(), owner: epoch.owner, issued: epoch.issued(),
    telemetry: authority.telemetry(), libraries: authority.libraries(),
    schemas: authority.libraries().map(library => authority.librarySchema(library)),
    roots: authority.libraries().map(library => authority.root(library)),
  };
}
function unchanged(map: LiveMap, before: ReturnType<typeof evidence>) {
  const after = evidence(map);
  assert.deepEqual(after, before);
  assert.equal(after.registry, before.registry);
  assert.equal(after.epoch, before.epoch);
  assert.equal(after.owner, before.owner);
  assert.equal(after.issued, before.issued);
  after.schemas.forEach((schema, index) => assert.equal(schema, before.schemas[index]));
  after.roots.forEach((root, index) => assert.equal(root, before.roots[index]));
}

await check("initial construction and later Library admission select independent fixed Schemas", () => {
  const map = hsonLiveMap.fromLibraries({
    state: { json: { count: 1 }, schema: StateSchema },
    page: { document: "<main/>", schema: SlideSchema },
  });
  assert.equal(map.rev, 0);
  assert.equal(map.data.must("state").schema.get(), StateSchema);
  assert.equal(map.doc.must("page").schema.get(), SlideSchema);
  map.addLibraries({ other: { json: { name: "Ada" }, schema: OtherStateSchema } });
  assert.equal(map.data.must("other").schema.get(), OtherStateSchema);
  assert.throws(() => hsonLiveMap.fromLibraries({ bad: { json: { count: "wrong" }, schema: StateSchema } }), /Schema/i);
  const before = evidence(map);
  assert.throws(() => map.addLibraries({ bad: { json: { count: "wrong" }, schema: StateSchema } }), /Schema/i);
  unchanged(map, before);
  assert.throws(() => map.data.must("state").at(["count"]).set("wrong"), /Schema/i);
  map.data.must("state").at(["count"]).set(2);
  assert.equal(map.data.must("state").schema.get(), StateSchema);
  assert.equal(map.data.must("other").schema.get(), OtherStateSchema);
});

await check("family tops are admitted bindings at revision zero with no grace period", () => {
  for (const explicit of [false, true]) {
    const map = hsonLiveMap.fromLibraries({
      state: { json: { count: 1 }, ...(explicit ? { schema: RuntimeHsonSchema.fromHson(ANY_DATA.toHson()) } : {}) },
      page: { document: "<main/>", ...(explicit ? { schema: ANY_DOCUMENT } : {}) },
    });
    const before = evidence(map);
    assert.throws(() => map.data.must("state").schema.use(StateSchema), /immutable after admission/);
    assert.throws(() => map.doc.must("page").schema.use(SlideSchema), /immutable after admission/);
    unchanged(map, before);
    map.data.must("state").at(["count"]).set("still allowed by family top");
    assert.equal(map.data.must("state").snap(["count"]), "still allowed by family top");
    map.addLibraries({ added: { json: { count: 1 } } });
    const addedBefore = evidence(map);
    assert.throws(() => map.data.must("added").schema.use(StateSchema), /immutable after admission/);
    unchanged(map, addedBefore);
  }
});

await check("replacement after operational use is atomic for Data, CSS, identity, observers and retained handles", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1, active: {}, retired: {} } }, page: { document: "<main/>" } });
  const state = map.data.must("state"), page = map.doc.must("page");
  const active = acquire_projected_identity(state, ["active"]);
  const retired = acquire_projected_identity(state, ["retired"]);
  const documentIdentity = acquire_document_identity(page.document, { kind: "path", path: [0, 0, 1, 0, 0] });
  state.at(["retired"]).delete();
  state.at(["count"]).set(2);
  page.css.stylesheet("main { color: red; }");
  const location = page.at([]), locationBefore = location.snap();
  const css = page.css.snapshot();
  let commits = 0, positions = 0, restores = 0, watches = 0;
  const authority = internal_livemap_aggregate_authority(map);
  map.commits.observe(() => { commits++; });
  authority.observeAuthorityPosition(() => { positions++; });
  authority.observeRestore(() => { restores++; });
  authority.watch(authority.libraries()[0]!, ["count"], () => { watches++; });
  const before = evidence(map);
  assert.throws(() => state.schema.use(StateSchema), /immutable after admission/);
  assert.throws(() => page.schema.use(SlideSchema), /immutable after admission/);
  unchanged(map, before);
  assert.deepEqual([commits, positions, restores, watches], [0, 0, 0, 0]);
  assert.equal(map.data.must("state"), state);
  assert.equal(map.doc.must("page"), page);
  assert.equal(active.active, true);
  assert.equal(retired.active, false);
  assert.equal(documentIdentity.active, true);
  assert.deepEqual(location.snap(), locationBefore);
  assert.equal(page.css.snapshot(), css);
  state.at(["count"]).set(3);
  assert.deepEqual([commits, positions, restores, watches], [1, 1, 0, 1]);
  assert.equal(active.active, true);
  assert.equal(retired.active, false);
});

await check("failed replacement does not invalidate an already prepared valid Data transaction", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 } } });
  const authority = internal_livemap_aggregate_authority(map);
  const library = authority.libraries()[0]!;
  const prepared = authority.prepare([{ target: { domain: "application", library, path: ["count"] }, kind: "set", value: 2 }]);
  const before = evidence(map);
  assert.throws(() => map.data.must("state").schema.use(StateSchema), /immutable after admission/);
  unchanged(map, before);
  authority.assertPrepared(prepared);
  authority.accept(prepared);
  assert.equal(map.data.must("state").snap(["count"]), 2);
  assert.equal(map.rev, 1);
});

await check("same object and canonically equal Schemas are unchanged no-ops preserving the admitted object", () => {
  for (const schema of [StateSchema, ANY_DATA]) {
    const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 }, schema } });
    map.data.must("state").at(["count"]).set(2);
    for (const candidate of [schema, RuntimeHsonSchema.fromHson(schema.toHson())]) {
      const before = evidence(map);
      const noop = Reflect.apply(map.data.must("state").schema.use, undefined, [candidate]);
      assert.deepEqual(noop, { kind: "map", changed: false, prevRev: 1, rev: 1, operations: [] });
      unchanged(map, before);
      assert.equal(map.data.must("state").schema.get(), schema);
    }
  }
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema: SlideSchema } });
  const before = evidence(map);
  assert.equal(map.doc.must("page").schema.use(SlideSchema).changed, false);
  assert.equal(Reflect.apply(map.doc.must("page").schema.use, undefined, [RuntimeHsonSchema.fromHson(SlideSchema.toHson())]).changed, false);
  unchanged(map, before);
});

await check("wrong families and replacement specific contracts retain established error conventions", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 }, schema: StateSchema }, page: { document: "<main/>", schema: SlideSchema } });
  const before = evidence(map);
  assert.throws(() => Reflect.apply(map.doc.must("page").schema.use, undefined, [StateSchema]), /document Schema/i);
  assert.throws(() => Reflect.apply(map.data.must("state").schema.use, undefined, [OtherStateSchema]), /immutable after admission/);
  assert.throws(() => Reflect.apply(map.doc.must("page").schema.use, undefined, [OtherSlideSchema]), /immutable after admission/);
  assert.throws(() => Reflect.apply(map.data.must("state").schema.use, undefined, [{}]), TypeError);
  unchanged(map, before);
});

await check("forged portable Schema-use replay cannot replace either binding or poison valid replay", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 } } });
  const before = evidence(map);
  const operation = { library: "state", operation: { kind: "library-schema-use", previousSchemaDigest: before.snapshot.registry.libraries[0]!.schemaDigest, schema: StateSchema.toHson() } };
  for (const candidate of [operation, { ...operation, operation: { ...operation.operation, previousSchemaDigest: "0".repeat(64) } },
    { ...operation, operation: { ...operation.operation, schema: ANY_DATA.toHson() } }]) {
    assert.throws(() => Reflect.apply(map.replay, undefined, [{ kind: "map", changed: true, prevRev: 0, rev: 1, operations: [candidate] }]));
    unchanged(map, before);
  }
  const source = hsonLiveMap.fromLibraries({ state: { json: { count: 1 } } });
  let valid: LiveMapCommit | undefined;
  source.commits.observe(commit => { valid = commit; });
  source.addLibraries({ extra: { json: { name: "Ada" }, schema: OtherStateSchema } });
  assert.ok(valid);
  map.replay(valid);
  map.data.must("state").at(["count"]).set(2);
  assert.equal(map.data.must("state").snap(["count"]), 2);
  assert.equal(map.data.must("state").schema.get(), ANY_DATA);
});

await check("capture, cut, fresh installation and same-contract restore retain fixed Schema semantics", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 }, schema: StateSchema }, page: { document: "<main/>", schema: SlideSchema } });
  const selected = map.data.must("state");
  const initial = map.capture();
  const identity = acquire_projected_identity(selected, []);
  selected.at(["count"]).set(2);
  assert.equal(selected.schema.get(), StateSchema);
  map.restore(initial);
  assert.equal(identity.active, false, "portable restoration fences prior runtime identity");
  assert.equal(selected.schema.get(), StateSchema);
  const cut = map.cut({ documents: [] });
  const installed = install_libraries_snapshot(cut.libs).map;
  assert.equal(installed.data.must("state").schema.get().toHson(), StateSchema.toHson());
  const before = evidence(map);
  const different = hsonLiveMap.fromLibraries({ state: { json: { count: 1 } }, page: { document: "<main/>", schema: SlideSchema } }).capture();
  assert.throws(() => map.restore(different), /topology|immutable/i);
  unchanged(map, before);
  assert.throws(() => installed.data.must("state").schema.use(ANY_DATA), /immutable after admission/);
  installed.data.must("state").at(["count"]).set(3);
});

await check("Locus-managed parity retains binding, projection, revision and later valid mutations", async () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 } } });
  const locus = create_locus_fixture(authority_definition_from_fixture_options({ map, ...test_public_projection(map) }));
  try {
    const session = await locus.session.create({ libraries: ["state"] });
    const captured = session.now();
    const managed = locus_map_internal(locus);
    const before = evidence(managed);
    assert.equal("use" in locus.data.must("state").schema, false);
    assert.throws(() => managed.data.must("state").schema.use(StateSchema), /managed|authority|controlled/i);
    unchanged(managed, before);
    assert.deepEqual(session.now(), captured);
    await locus.data.must("state").at(["count"]).set(2);
    assert.equal(locus.data.must("state").snap(["count"]), 2);
    assert.equal(locus.data.must("state").schema.get(), before.schemas[0]);
  } finally { locus.dispose(); }
});

await check("projected Echo map and client-local Library both retain their admitted bindings", async () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 } } });
  const authority = internal_livemap_aggregate_authority(map);
  const captured = authority.captureHosted(), configured = test_public_projection(map);
  const policy = make_locus_hosted_projection_policy(captured.registry, captured.authority,
    configured.libraries, configured.defaultProjection, configured.authorizeProjection);
  const effective = await normalize_locus_effective_projection(policy, configured.defaultProjection);
  const digest = projected_registry_digest(effective);
  const projected = client_projection_map({ authority: project_authority_snapshot(captured, effective), local: { local: { json: { count: 1 } } } });
  const before = evidence(projected);
  assert.throws(() => projected.data.must("state").schema.use(StateSchema), /shared|Locus authority|projected/i);
  assert.throws(() => projected.data.must("local").schema.use(StateSchema), /immutable after admission/);
  unchanged(projected, before);
  const mapBefore = evidence(map);
  assert.throws(() => map.data.must("state").schema.use(StateSchema), /immutable after admission/);
  unchanged(map, mapBefore);
  assert.equal(projected_registry_digest(effective), digest, "R1 immutable effective projection remains reusable");
  projected.data.must("local").at(["count"]).set(2);
  assert.equal(projected.data.must("local").snap(["count"]), 2);
});

await check("accepted Data observer failures remain isolated and reported", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 }, schema: StateSchema } });
  let later = 0;
  map.commits.observe(() => { throw new Error("observer failed after acceptance"); });
  map.commits.observe(() => { later++; });
  const reports = observerReports.length;
  const commit = map.data.must("state").at(["count"]).set(2);
  assert.equal(commit.changed, true);
  assert.equal(map.rev, 1);
  assert.equal(later, 1);
  assert.equal(observerReports.length, reports + 1);
});

await check("restore and authority-position observers remain fair, isolated and reported", () => {
  const source = hsonLiveMap.fromLibraries({ state: { json: { count: 1 } } });
  source.data.must("state").at(["count"]).set(2);
  const target = hsonLiveMap.fromLibraries({ state: { json: { count: 1 } } });
  const authority = internal_livemap_aggregate_authority(target);
  const delivered: string[] = [];
  authority.observeRestore(() => { delivered.push("restore-1"); throw new Error("restore observer"); });
  authority.observeRestore(() => { delivered.push("restore-2"); });
  authority.observeAuthorityPosition(() => { delivered.push("position-1"); throw new Error("position observer"); });
  authority.observeAuthorityPosition(() => { delivered.push("position-2"); });
  const reports = observerReports.length;
  target.restore(source.capture());
  assert.equal(target.data.must("state").snap(["count"]), 2);
  assert.deepEqual(delivered, ["restore-1", "restore-2", "position-1", "position-2"]);
  assert.equal(observerReports.length, reports + 2);
});

const BoundedState = Hson.schema`<type "data" content <count <number <min 0>>>>`;
const PlainPage = Hson.schema`<type "document" tag "html" content <sequence [<tag "head" content "empty">, <tag "body" content <sequence [<tag "main" content "empty">]>>]>>`;

function reject_restore(map: LiveMap, snapshot: LiveMapSnapshot, expected: RegExp = /immutable|topology|metadata|registry/i) {
  const state = map.data.must("state"), page = map.doc.must("page");
  const before = evidence(map), css = page.css.snapshot();
  const counts = [0, 0, 0, 0];
  const authority = internal_livemap_aggregate_authority(map);
  const off = [map.commits.observe(() => counts[0]++), authority.observeRestore(() => counts[1]++),
    authority.observeAuthorityPosition(() => counts[2]++),
    authority.watch(authority.libraries()[0]!, ["count"], () => counts[3]++)];
  try {
    assert.throws(() => map.restore(snapshot), expected);
    unchanged(map, before);
    assert.deepEqual(counts, [0, 0, 0, 0]);
    assert.equal(map.data.must("state"), state);
    assert.equal(map.doc.must("page"), page);
    assert.equal(page.css.snapshot(), css);
  } finally { off.forEach(stop => stop()); }
}

for (const family of ["data", "document"] as const) {
  const schemas = family === "data"
    ? [[ANY_DATA, StateSchema], [StateSchema, BoundedState], [StateSchema, ANY_DATA]]
    : [[ANY_DOCUMENT, SlideSchema], [SlideSchema, PlainPage], [SlideSchema, ANY_DOCUMENT]];
  for (const [initial, replacement] of schemas) await check(`${family} restore rejects ${initial === (family === "data" ? ANY_DATA : ANY_DOCUMENT) ? "top to specific" : replacement === (family === "data" ? ANY_DATA : ANY_DOCUMENT) ? "specific to top" : "different specific"} before and after Data changes`, () => {
    const definitions = (schema: HsonSchema) => ({ state: { json: { count: 1 }, schema: family === "data" ? schema : StateSchema },
      page: { document: "<main/>", schema: family === "document" ? schema : SlideSchema } });
    const map = hsonLiveMap.fromLibraries(definitions(initial!));
    const incoming = hsonLiveMap.fromLibraries(definitions(replacement!)).capture();
    const retained = map.data.must("state"), initialSnapshot = map.capture();
    for (const mutated of [false, true]) {
      if (mutated) retained.at(["count"]).set(2);
      reject_restore(map, incoming);
      const authority = internal_livemap_aggregate_authority(map), before = evidence(map);
      assert.throws(() => authority.restoreLibraries(incoming), /immutable/i);
      unchanged(map, before);
      retained.at(["count"]).set(3);
      map.data.must("state").at(["count"]).set(4);
      map.restore(initialSnapshot);
      assert.equal(retained.snap(["count"]), 1);
    }
  });
}

await check("public restore captures a registry-changing Proxy without property reads", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 } }, page: { document: "<main/>" } });
  const current = map.capture();
  const incoming = structuredClone(hsonLiveMap.fromLibraries({ state: { json: { count: 2 }, schema: StateSchema }, page: { document: "<main/>" } }).capture());
  let reads = 0;
  const proxy = new Proxy(incoming, { get(target, key, receiver) {
    if (key === "registry" && ++reads === 1) return current.registry;
    return Reflect.get(target, key, receiver);
  } });
  reject_restore(map, proxy);
  assert.equal(reads, 0, "restoration uses descriptor capture, never the Proxy's property interpretation");
});

await check("nested Schema registry root and CSS evidence is captured once before qualification", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 }, schema: StateSchema }, page: { document: "<main/>" } });
  const retained = map.data.must("state");
  const snapshot = structuredClone(map.capture());
  let schemaReads = 0, propertyReads = 0, payloadReads = 0;
  const first = snapshot.registry.libraries[0]!;
  Object.defineProperty(snapshot.registry.libraries, 0, { value: new Proxy(first, {
    get() { propertyReads++; throw new Error("nested property reads are forbidden"); },
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (key === "schema" && ++schemaReads > 1) return { ...descriptor, value: ANY_DATA.toHson() };
      return descriptor;
    },
  }) });
  const encoded = snapshot.libraries[0]!.root;
  Object.defineProperty(snapshot.libraries, 0, { value: { ...snapshot.libraries[0]!, root: new Proxy(encoded, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (key === "payload") {
        payloadReads++;
        // Mutating an already captured caller field cannot change the admitted Schema.
        Object.defineProperty(first, "schema", { value: ANY_DATA.toHson() });
      }
      return descriptor;
    },
  }) } });
  map.restore(snapshot);
  assert.equal(schemaReads, 1); assert.equal(payloadReads, 1); assert.equal(propertyReads, 0);
  assert.equal(retained.schema.get(), StateSchema);
  retained.at(["count"]).set(2);
  assert.equal(retained.snap(["count"]), 2);
  const hostile = structuredClone(map.capture());
  Object.defineProperty(hostile.libraries, 0, { value: new Proxy({ ...hostile.libraries[0]!, schema: ANY_DATA.toHson() }, {
    get(target, key, receiver) { propertyReads++; return key === "schema" ? StateSchema.toHson() : Reflect.get(target, key, receiver); },
  }) });
  reject_restore(map, hostile);
  assert.equal(propertyReads, 0);
  const forgedDigest = structuredClone(map.capture());
  Object.defineProperty(forgedDigest.registry.libraries, 0, { value: {
    ...forgedDigest.registry.libraries[0]!, schema: ANY_DATA.toHson(),
  } });
  reject_restore(map, forgedDigest, /immutable/);
});

await check("snapshot admission rejects getters sparse arrays cycles and reflection failures without invoking getters", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 } }, page: { document: "<main/>" } });
  let invoked = 0;
  for (const location of ["registry", "schema", "payload", "css"] as const) {
    const snapshot = structuredClone(map.capture());
    const target = location === "registry" ? snapshot : location === "schema" ? snapshot.registry.libraries[0]!
      : location === "payload" ? snapshot.libraries[0]!.root : snapshot.libraries[1]!;
    Object.defineProperty(target, location, { enumerable: true, get() { invoked++; throw new Error("getter invoked"); } });
    reject_restore(map, snapshot, /exact own data fields/);
  }
  assert.equal(invoked, 0);
  const sparse = structuredClone(map.capture()); Reflect.deleteProperty(sparse.libraries, 0);
  reject_restore(map, sparse, /exact own data fields/);
  const cyclic = structuredClone(map.capture()); Object.defineProperty(cyclic, "cycle", { value: cyclic, enumerable: true });
  reject_restore(map, cyclic, /exact own data fields/);
  const failure = new Error("descriptor failure");
  const hostile = new Proxy(structuredClone(map.capture()), { ownKeys() { throw failure; } });
  const before = evidence(map);
  assert.throws(() => map.restore(hostile), error => error instanceof HostedAggregateRepresentationError
    && error.cause instanceof Error && error.cause.cause === failure);
  unchanged(map, before);
  map.restore(map.capture()); map.data.must("state").at(["count"]).set(2);
});

await check("canonical-equal restoration retains original governing authority and Library records", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 }, schema: StateSchema }, page: { document: "<main/>", schema: SlideSchema } });
  const state = map.data.must("state"), page = map.doc.must("page");
  const a = internal_livemap_aggregate_authority(map), ids = a.libraries();
  const incoming = hsonLiveMap.fromLibraries({ state: { json: { count: 7 }, schema: RuntimeHsonSchema.fromHson(StateSchema.toHson() + "\n") },
    page: { document: "<main/>", schema: RuntimeHsonSchema.fromHson(SlideSchema.toHson() + "\n") } }).capture();
  map.restore(incoming);
  assert.deepEqual(a.libraries(), ids); assert.equal(map.data.must("state"), state); assert.equal(map.doc.must("page"), page);
  assert.equal(state.schema.get(), StateSchema); assert.equal(page.schema.get(), SlideSchema);
  assert.equal(state.snap(["count"]), 7);
});

await check("exact hosted restoration retains living provenance and rejects portable or copied identity claims", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 }, schema: StateSchema }, page: { document: "<main/>" } });
  const a = internal_livemap_aggregate_authority(map), captured = a.captureHosted(), state = map.data.must("state");
  state.at(["count"]).set(2);
  const before = evidence(map);
  assert.throws(() => Reflect.apply(a.restoreHosted, undefined, [map.capture()]), HostedAggregateRepresentationError);
  assert.throws(() => a.restoreHosted(structuredClone(captured)), /original living runtime/);
  unchanged(map, before);
  a.restoreHosted(captured);
  assert.equal(state.snap(["count"]), 1);
  assert.equal(state.schema.get(), StateSchema);
});

await check("rejected restoration preserves identity retirement prepared tokens reservations and grants", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1, active: {}, retired: {} } }, page: { document: "<main/>" } });
  const state = map.data.must("state"), a = internal_livemap_aggregate_authority(map);
  const active = acquire_projected_identity(state, ["active"]), retired = acquire_projected_identity(state, ["retired"]);
  const documentIdentity = acquire_document_identity(map.doc.must("page").document, { kind: "path", path: [0, 0, 1, 0, 0] });
  state.at(["retired"]).delete(); map.doc.must("page").css.stylesheet("main { color: red; }");
  const incoming = hsonLiveMap.fromLibraries({ state: { json: { count: 1 }, schema: StateSchema }, page: { document: "<main/>" } }).capture();
  const id = a.libraries()[0]!;
  const token = a.prepare([{ target: a.target(id, ["count"]), kind: "set", value: 2 }]);
  reject_restore(map, incoming); a.assertPrepared(token);
  const release = a.reserve(token);
  try { reject_restore(map, incoming, /reserved/); a.assertPrepared(token); } finally { release(); }
  a.accept(token); assert.equal(state.snap(["count"]), 2);
  const owner = {}; a.claimManagement(owner); const grant = a.captureManagementFence(owner);
  const prepared = a.prepareManaged(owner, [{ target: a.target(id, ["count"]), kind: "set", value: 3 }]);
  reject_restore(map, incoming, /controlled|managed|Locus/); grant(); a.assertPrepared(prepared); a.accept(prepared); grant();
  a.releaseManagement(owner);
  assert.equal(active.active, true); assert.equal(retired.active, false);
  assert.equal(documentIdentity.active, true);
  assert.equal(map.data.must("state"), state); state.at(["count"]).set(4);
});

await check("internal topology restoration admits new names while preserving existing governing records", () => {
  const map = hsonLiveMap.fromLibraries({ state: { json: { count: 1 }, schema: StateSchema }, page: { document: "<main/>" } });
  const state = map.data.must("state"), a = internal_livemap_aggregate_authority(map), id = a.libraries()[0]!;
  const incoming = hsonLiveMap.fromLibraries({ state: { json: { count: 2 }, schema: StateSchema }, page: { document: "<main/>" },
    extra: { json: { name: "Ada" }, schema: OtherStateSchema } }).capture();
  reject_restore(map, incoming, /topology/);
  a.restoreLibraries(incoming);
  assert.equal(a.libraries()[0], id); assert.equal(state.schema.get(), StateSchema); assert.equal(state.snap(["count"]), 2);
  assert.equal(a.librarySchema(a.libraries()[2]!).toHson(), OtherStateSchema.toHson());
  state.at(["count"]).set(3);
});

await check("Echo receiving rejects replacement contracts and accepts same-binding recovery", () => {
  const source = hsonLiveMap.fromLibraries({ state: { json: { count: 1 } }, page: { document: "<main/>" } });
  const original = make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(source).captureHosted());
  const map = compose_client_portable_aggregate_internal(original, []), cap = create_echo_aggregate_replica_capability_internal(map);
  try {
    const next = hsonLiveMap.fromLibraries({ state: { json: { count: 2 }, schema: StateSchema }, page: { document: "<main/>" } });
    const snapshot = make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(next).captureHosted());
    const before = evidence(map);
    assert.throws(() => cap.restoreHosted({ ...snapshot, authority: original.authority }), /immutable/i);
    unchanged(map, before);
    cap.restoreHosted(original);
    assert.equal(map.data.must("state").snap(["count"]), 1);
  } finally { cap.dispose(); }
});

await check("Echo restoration preserves an established internal governing Schema as well as application bindings", () => {
  const source = hsonLiveMap.fromLibraries({ state: { json: { count: 1 } }, page: { document: "<main/>" } });
  enable_interactions(source);
  const original = make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(source).captureHosted());
  const map = compose_client_portable_aggregate_internal(original, []), cap = create_echo_aggregate_replica_capability_internal(map);
  const registry = registry_from_entries(original.registry.libraries.map(entry => entry.scope === "hson-internal"
    ? { ...entry, schema: ANY_DATA.toHson(), schemaDigest: hson_schema_digest(ANY_DATA) } : entry));
  const forged = { ...original, registry, registryDigest: registry.digest,
    libraries: original.libraries.map(entry => entry.name === original.registry.libraries.find(item => item.scope === "hson-internal")!.name
      ? { ...entry, schema: ANY_DATA.toHson(), schemaDigest: hson_schema_digest(ANY_DATA) } : entry) };
  try {
    const before = evidence(map);
    assert.throws(() => cap.restoreHosted(forged), /immutable/);
    unchanged(map, before);
    cap.restoreHosted(original);
    assert.equal(map.data.must("state").snap(["count"]), 1);
  } finally { cap.dispose(); }
});

if (isMainThread) {
  const worker = repository_typescript_worker(new URL(import.meta.url));
  try {
    const count = await new Promise<number>((resolve, reject) => {
      worker.once("message", resolve); worker.once("error", reject);
      worker.once("exit", code => reject(new Error(`Schema binding Worker exited ${code}`)));
    });
    assert.equal(count, checks);
  } finally { await worker.terminate(); }
  events.terminal("pass");
  console.log(JSON.stringify({ immutableSchemaBindings: "passed", node: checks, worker: checks }));
} else { events.terminal("pass"); parentPort!.postMessage(checks); }
