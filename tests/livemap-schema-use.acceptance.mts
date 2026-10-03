import { locus_map_internal } from "../src/internal/governor-maps.js";
import { authority_definition_from_fixture_options } from "./helpers/locus-definition-fixture.mts";
import { client_projection_map } from "./helpers/client-projection.mts";
import assert from "node:assert/strict";
import { ANY_DATA, ANY_DOCUMENT, Hson, hsonLiveMap, type HsonSchema } from "../src/index.ts";
import { install_libraries_snapshot } from "../src/api/livemap/livemap.libraries.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { HsonSchema as RuntimeHsonSchema } from "../src/api/schema/hson-schema.ts";
import { project_authority_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import { test_public_projection } from "./helpers/hosted-catalog.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livemap.schema-use",
  title: "LiveMap post-hoc Schema attachment",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["livemap", "schema", "replay", "atomicity"]),
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
function check(name: string, run: () => void): void {
  events.case_begin(name, name);
  try { run(); checks += 1; events.case_end(name, "pass"); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}

const SlideSchema = Hson.schema`<type "document" tag "main" attrs <props <title <optional "string">>> content "empty">` as HsonSchema<unknown, "document">;
const OtherSlideSchema = Hson.schema`<type "document" tag "section" content "empty">` as HsonSchema<unknown, "document">;
const StateSchema = Hson.schema`<type "data" content <count "number">>` as HsonSchema<unknown, "data">;
const OtherStateSchema = Hson.schema`<type "data" content <name "string">>` as HsonSchema<unknown, "data">;

check("document tightening is one portable transition and capture/replay retain it", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema: ANY_DOCUMENT } });
  map.lib("page").css.stylesheet("main { color: red; }");
  const beforeRoot = map.lib("page").root();
  const beforeCss = map.lib("page").css.snapshot();
  const beforeCapture = map.capture();
  const commit = map.lib("page").schema.use(SlideSchema);
  assert.deepEqual([commit.changed, commit.prevRev, commit.rev, map.rev], [true, 1, 2, 2]);
  assert.equal(commit.operations.length, 1);
  assert.deepEqual(commit.operations[0], {
    library: "page",
    operation: {
      kind: "library-schema-use",
      previousSchemaDigest: beforeCapture.registry.libraries[0]?.schemaDigest,
      schema: SlideSchema.toHson(),
    },
  });
  assert.deepEqual(map.lib("page").root(), beforeRoot);
  assert.equal(map.lib("page").css.snapshot(), beforeCss);
  assert.equal(map.lib("page").schema.get(), SlideSchema);
  assert.throws(() => map.lib("page").document.attrs.set({ kind: "path", path: [0] }, "title", true), /Schema|schema/i);

  const after = map.capture();
  assert.equal(after.registry.libraries[0]?.schema, SlideSchema.toHson());
  assert.notEqual(after.registry.digest, beforeCapture.registry.digest);
  assert.throws(() => map.restore(beforeCapture), /topology/i);
  map.restore(after);
  const reconstructed = install_libraries_snapshot(after).map;
  assert.equal(reconstructed.lib("page").schema.get().toHson(), SlideSchema.toHson());

  const replay = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  replay.lib("page").css.stylesheet("main { color: red; }");
  const applied = replay.replay(commit);
  assert.deepEqual(applied, commit);
  assert.equal(replay.lib("page").schema.get().toHson(), SlideSchema.toHson());
});

check("data tightening governs future writes and explicit family ANY is recognized canonically", () => {
  const reconstructedAny = HsonSchemaFrom(ANY_DATA.toHson());
  const map = hsonLiveMap.fromLibraries({ state: { data: { count: 1 }, schema: reconstructedAny } });
  const commit = map.lib("state").schema.use(StateSchema);
  assert.equal(commit.changed, true);
  assert.equal(map.lib("state").schema.get(), StateSchema);
  assert.throws(() => map.lib("state").at(["count"]).set("wrong" as never), /Schema|schema/i);
  assert.equal(map.lib("state").snap(["count"]), 1);
});

check("invalid roots, wrong families, and different specific contracts reject atomically", () => {
  const invalid = hsonLiveMap.fromLibraries({ page: { document: "<section/>" } });
  const invalidBefore = invalid.capture();
  assert.throws(() => invalid.lib("page").schema.use(SlideSchema));
  assert.deepEqual(invalid.capture(), invalidBefore);
  assert.equal(invalid.lib("page").schema.get().toHson(), ANY_DOCUMENT.toHson());

  const wrong = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  const wrongBefore = wrong.capture();
  assert.throws(() => wrong.lib("page").schema.use(StateSchema as unknown as HsonSchema<unknown, "document">), /document Schema/i);
  assert.deepEqual(wrong.capture(), wrongBefore);

  wrong.lib("page").schema.use(SlideSchema);
  const fixed = wrong.capture();
  assert.throws(() => wrong.lib("page").schema.use(OtherSlideSchema));
  assert.deepEqual(wrong.capture(), fixed);

  const data = hsonLiveMap.fromLibraries({ state: { data: { count: 1 }, schema: StateSchema } });
  assert.throws(() => data.lib("state").schema.use(OtherStateSchema as never));
});

check("canonical equality is an unchanged no-op", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  map.lib("page").schema.use(SlideSchema);
  let publications = 0;
  map.commits.observe(() => { publications += 1; });
  const canonicalTwin = HsonSchemaFrom(SlideSchema.toHson());
  const noop = map.lib("page").schema.use(canonicalTwin as HsonSchema<unknown, "document">);
  assert.deepEqual(noop, { kind: "map", changed: false, prevRev: 1, rev: 1, operations: [] });
  assert.equal(publications, 0);
  assert.equal(map.lib("page").schema.get(), SlideSchema);
});

check("accepted observer failures do not turn success into a thrown rejection", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { count: 1 } } });
  let later = 0;
  map.commits.observe(() => { throw new Error("observer failed after acceptance"); });
  map.commits.observe(() => { later += 1; });
  const beforeReports = observerReports.length;
  const commit = map.lib("state").schema.use(StateSchema);
  assert.equal(commit.changed, true);
  assert.equal(map.rev, 1);
  assert.equal(map.lib("state").schema.get(), StateSchema);
  assert.equal(later, 1);
  assert.equal(observerReports.length, beforeReports + 1);
  assert.match(String((observerReports.at(-1) as Error | undefined)?.cause), /observer failed after acceptance/);
});

check("restore and authority-position observers are fair, isolated, and reported", () => {
  const source = hsonLiveMap.fromLibraries({ state: { data: { count: 1 } } });
  source.lib("state").at(["count"]).set(2);
  const target = hsonLiveMap.fromLibraries({ state: { data: { count: 1 } } });
  const authority = internal_livemap_aggregate_authority(target);
  const delivered: string[] = [];
  authority.observeRestore(() => { delivered.push("restore-1"); throw new Error("restore observer"); });
  authority.observeRestore(() => { delivered.push("restore-2"); });
  authority.observeAuthorityPosition(() => { delivered.push("position-1"); throw new Error("position observer"); });
  authority.observeAuthorityPosition(() => { delivered.push("position-2"); });
  const beforeReports = observerReports.length;
  target.restore(source.capture());
  assert.equal(target.lib("state").snap(["count"]), 2);
  assert.deepEqual(delivered, ["restore-1", "restore-2", "position-1", "position-2"]);
  assert.equal(observerReports.length, beforeReports + 2);
});

check("portable Schema-use replay rejects tampering and revision mismatch atomically", () => {
  const source = hsonLiveMap.fromLibraries({ page: { document: "<main/>" } });
  const commit = source.lib("page").schema.use(SlideSchema);
  const reject = (candidate: unknown, root = "<main/>") => {
    const target = hsonLiveMap.fromLibraries({ page: { document: root } });
    const before = target.capture();
    assert.throws(() => target.replay(candidate as never));
    assert.deepEqual(target.capture(), before);
  };
  const operation = commit.operations[0];
  assert.ok(operation && "kind" in operation.operation && operation.operation.kind === "library-schema-use");
  reject({ ...commit, operations: [{ ...operation, operation: { ...operation.operation, previousSchemaDigest: "0".repeat(64) } }] });
  reject({ ...commit, operations: [{ ...operation, operation: { ...operation.operation, schema: `${SlideSchema.toHson()} ` } }] });
  reject({ ...commit, operations: [{ ...operation, operation: { ...operation.operation, schema: StateSchema.toHson() } }] });
  reject({ ...commit, operations: [{ ...operation, operation: { ...operation.operation, schema: OtherSlideSchema.toHson() } }] });
  reject({ ...commit, prevRev: 1, rev: 2 });
});

check("Schema attachment preserves retained facades, locations, identity epoch, CSS, and unrelated libraries", () => {
  const map = hsonLiveMap.fromLibraries({
    page: { document: '<main title="before"/> ' },
    state: { data: { count: 1 } },
  });
  const page = map.lib("page");
  const location = page.at([]);
  const locationBefore = location.snap();
  page.css.stylesheet("main { color: red; }");
  const css = page.css.snapshot();
  const root = page.root();
  const state = map.lib("state");
  const stateRoot = state.root();
  const epoch = internal_livemap_aggregate_authority(map).identityEpoch();
  const owner = epoch.owner;
  const generation = epoch.current();
  page.schema.use(SlideSchema);
  assert.equal(map.lib("page"), page);
  assert.deepEqual(page.root(), root);
  assert.deepEqual(location.snap(), locationBefore);
  assert.equal(page.css.snapshot(), css);
  assert.equal(map.lib("state"), state);
  assert.deepEqual(state.root(), stateRoot);
  assert.equal(state.snap(["count"]), 1);
  assert.equal(epoch.owner, owner);
  assert.equal(epoch.current(), generation);
});

check("Locus-managed authority rejects synchronous attachment", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { count: 1 } } });
  const locus = hsonLiveMap.locus.create(authority_definition_from_fixture_options({ map, ...test_public_projection(map) }));
  const before = locus_map_internal(locus).capture();
  assert.equal("use" in locus.lib("state").schema, false);
  assert.deepEqual(locus_map_internal(locus).capture(), before);
  locus.dispose();
});

check("projected client rejects replica-only attachment", () => {
  const authority = hsonLiveMap.fromLibraries({ state: { data: { count: 1 } } });
  const captured = internal_livemap_aggregate_authority(authority).captureHosted();
  const configured = test_public_projection(authority);
  const policy = make_locus_hosted_projection_policy(captured.registry, captured.authority,
    configured.libraries, configured.defaultProjection, configured.authorizeProjection);
  const effective = normalize_locus_effective_projection(policy, configured.defaultProjection);
  if (effective instanceof Promise) throw new Error("Expected synchronous test projection.");
  const projected = client_projection_map({
    authority: project_authority_snapshot(captured, effective),
    local: {},
  });
  const before = projected.capture();
  assert.throws(() => projected.lib("state").schema.use(StateSchema), /shared|Locus authority|projected/i);
  assert.deepEqual(projected.capture(), before);
});

function HsonSchemaFrom(source: string): HsonSchema {
  return RuntimeHsonSchema.fromHson(source);
}

events.terminal("pass");
console.log(JSON.stringify({ livemapSchemaUse: "passed", checks }));
