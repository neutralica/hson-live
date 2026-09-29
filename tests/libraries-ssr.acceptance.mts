import { decode_hosted_root } from "../src/api/livemap/livemap.hosted.ts";
import { test_public_exposure } from "./helpers/hosted-exposure.mts";
import assert from "node:assert/strict";
import {
  DocumentSsrError,
  Hson,
  hsonTransform,
  encode_ssr_bootstrap,
  decode_ssr_bootstrap,
  add_interaction,
  enable_interactions,
  hsonLiveMap,
  hsonLocus,
  type HsonSchema,
} from "../src/index.ts";
import type { LocusSocketLike, Locus } from "../src/types/locus.types.ts";
import { install_libraries_snapshot } from "../src/api/livemap/index.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { INTERACTION_RESERVED_LIBRARY_KEY } from "../src/internal/interaction-storage.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";
import { create_test_event_emitter } from "./test-events.mjs";

const StateSchema: HsonSchema = Hson.schema`<type "data" content <count "number">>`;
const PageSchema: HsonSchema = Hson.schema`<type "document" tag "main" attrs <props <title <optional "string">>> content <repeat <tag "item" content "empty">>>`;
const AdminSchema: HsonSchema = Hson.schema`<type "document" tag "aside" content "empty">`;
const QUID = "000009701";

const testEvents = create_test_event_emitter("libraries.ssr");
let checks = 0;
function check(name: string, run: () => void): void {
  testEvents.case_begin(name, name);
  try { run(); testEvents.case_end(name, "pass"); }
  catch (error) { testEvents.case_end(name, "fail"); testEvents.terminal("fail"); throw error; }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

function map_fixture(multiple = false) {
  return admit_exact_runtime_livemap_libraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: parse_hson_exact_runtime(`<main title="zero" <item @${QUID}/>/>`, { allowTopLevelDocumentText: true }), schema: PageSchema },
    ...(multiple ? { admin: { document: "<aside/>", schema: AdminSchema } } : {}),
  });
}

function hosted_map_fixture(multiple = false) {
  return hsonLiveMap.fromLibraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: '<main title="zero" <item/>/>', schema: PageSchema },
    ...(multiple ? { admin: { document: "<aside/>", schema: AdminSchema } } : {}),
  });
}

function expect_phase(phase: "select" | "realize", operation: () => unknown): void {
  assert.throws(operation, (cause) => cause instanceof DocumentSsrError && cause.phase === phase);
}

function data(map: ReturnType<typeof install_libraries_snapshot>["map"], name: string) {
  const selected = map.lib(name);
  if (selected.mode === "document") throw new Error(`Expected data Library ${name}.`);
  return selected;
}

function document(map: ReturnType<typeof install_libraries_snapshot>["map"], name: string) {
  const selected = map.lib(name);
  if (selected.mode !== "document") throw new Error(`Expected document Library ${name}.`);
  return selected;
}

function authorized_session<TMap extends import("../src/types/livemap.types.ts").LiveMap>(locus: Locus<TMap>, libraries: string[]) {
  let receive: ((raw: string) => void) | undefined;
  let sessionId: string | undefined;
  const socket: LocusSocketLike = {
    send(raw) { const message = JSON.parse(raw); if (message.type === "session-created") sessionId = message.sessionId; },
    close() {},
    onMessage(listener) { receive = listener; return () => { receive = undefined; }; },
    onClose() { return () => {}; },
  };
  const close = locus.connect(socket);
  receive?.(JSON.stringify({ type: "session-create", id: "ssr", projection: {
    libraries,
  } }));
  if (sessionId === undefined) throw new Error("Session authorization failed.");
  return { sessionId, close };
}

check("capture and local install preserve the complete detached aggregate snapshot", () => {
  const map = map_fixture();
  enable_interactions(map);
  const snapshot = map.capture();
  const retained = JSON.stringify(snapshot);
  assert.equal(snapshot.revision, map.rev);
  assert.deepEqual(snapshot.registry.libraries.map((entry) => entry.name), [
    "state", "page", INTERACTION_RESERVED_LIBRARY_KEY,
  ]);
  assert.equal(snapshot.registry.libraries[2]?.scope, "hson-internal");
  map.lib("state").at(["count"]).set(1);
  map.lib("page").at([]).asElement()!.attrs.set("title", "source-moved");
  assert.equal(JSON.stringify(snapshot), retained);

  const installed = install_libraries_snapshot(snapshot);
  assert.notEqual(installed.map, map);
  assert.notEqual(installed.map.lib("page"), map.lib("page"));
  assert.deepEqual(installed.map.capture(), snapshot);
  assert.equal(installed.map.rev, snapshot.revision);
  assert.equal(data(installed.map, "state").snap(["count"]), 0);
  assert.equal(document(installed.map, "page").at([]).asElement()!.attrs.get("title"), "zero");
  assert.throws(() => (installed.map.lib as (name: string) => unknown)(INTERACTION_RESERVED_LIBRARY_KEY), /Unknown/);
  data(installed.map, "state").at(["count"]).set(2);
  assert.equal(JSON.stringify(snapshot), retained);
});

check("explicit HTML cut transfers all families by default", () => {
  const map = map_fixture();
  enable_interactions(map);
  const ssr = map.cut({ html: "page" });
  const repeated = map.cut({ html: "page" });
  assert.equal(ssr.document, "page");
  assert.equal(repeated.html, ssr.html);
  assert.deepEqual(repeated.libs, ssr.libs);
  assert.match(ssr.html, /^<main/);
  assert.equal(ssr.libs.libraries.length, 3);
  assert.equal(ssr.libs.registry.libraries.some((entry) => entry.name === "state"), true);
  assert.equal(ssr.libs.registry.libraries.some((entry) => entry.scope === "hson-internal"), true);
});

check("HTML selection switches realization while retaining default state", () => {
  const map = map_fixture(true);
  const page = map.cut({ html: "page" });
  const admin = (map as import("../src/types/livemap.types.ts").LiveMap).cut({ html: "admin" });
  assert.equal(page.document, "page");
  assert.equal(admin.document, "admin");
  assert.match(page.html, /^<main/);
  assert.match(admin.html, /^<aside/);
  assert.deepEqual(page.libs, admin.libs);
  assert.equal(install_libraries_snapshot(page.libs).map.lib("admin").mode, "document");
  assert.throws(() => map.cut({ html: "state" } as any));
  assert.throws(() => map.cut({ html: "missing" } as any));
});

check("hidden storage travels automatically and cannot be selected", () => {
  const map = map_fixture();
  enable_interactions(map);
  const ssr = map.cut({ html: "page" });
  assert.equal(ssr.document, "page");
  assert.throws(() => map.cut({ html: INTERACTION_RESERVED_LIBRARY_KEY } as any));
  const hidden = ssr.libs.registry.libraries.find((entry) => entry.name === INTERACTION_RESERVED_LIBRARY_KEY);
  assert.equal(hidden?.scope, "hson-internal");
});

check("retired server QUID history stays outside local SSR/install", () => {
  const map = map_fixture();
  map.lib("page").at([]).at([0]).delete();
  const ssr = map.cut({ html: "page" });
  assert.equal("identity" in ssr.libs, false);
  assert.equal(JSON.stringify(ssr.libs).includes(QUID), false);
  assert.doesNotMatch(JSON.stringify(ssr.libs), /identityEpoch|issuedQuids|"quid"/);
  assert.doesNotMatch(ssr.html, /hson:quid/);
  assert.equal(ssr.html.includes(QUID), false);
  const installed = install_libraries_snapshot(ssr.libs).map;
  assert.equal("identity" in installed.capture(), false);
  assert.equal(installed.rev, ssr.libs.revision);
});

check("schema and registry tampering fails closed", () => {
  const snapshot = map_fixture(true).cut().libs;
  const mutations: Array<(value: any) => void> = [
    (value) => { value.registry.libraries[0].schema = PageSchema; },
    (value) => { value.registry.libraries[0].schemaDigest = "0".repeat(64); },
    (value) => { value.registry.libraries[0].mode = "document"; },
    (value) => { value.registry.libraries[0].name = "renamed"; },
    (value) => { value.registry.libraries.reverse(); },
    (value) => { value.registryDigest = "0".repeat(64); },
  ];
  for (const mutate of mutations) {
    const tampered = structuredClone(snapshot) as any;
    mutate(tampered);
    assert.throws(() => install_libraries_snapshot(tampered));
  }
});

check("cut retains its HTML, data and interactions after source mutation", () => {
  const map = map_fixture();
  enable_interactions(map);
  const before = map.capture();
  const ssr = map.cut({ html: "page" });
  map.lib("page").at([]).asElement()!.attrs.set("title", "one");
  map.lib("state").at(["count"]).set(1);
  add_interaction(map, Object.freeze({
    id: "after-cut",
    subject: Object.freeze({ library: "page", path: [0, 0, 0] }),
    listener: Object.freeze({
      event: "click", target: "element", capture: false, once: false, passive: false,
      missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false,
    }),
    kind: "browser-local",
    key: "noop",
    args: Hson.data.from(null),
  }));
  assert.deepEqual(ssr.libs, before);
  assert.match(ssr.html, /title="zero"/);
  assert.equal(data(install_libraries_snapshot(ssr.libs).map, "state").snap(["count"]), 0);
  assert.equal(map.rev, 3);
});

check("state-only defaults and explicit family empties reconstruct as independent topologies", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { count: 7 }, schema: StateSchema },
    page: { document: "<main/>", schema: PageSchema }, admin: { document: "<aside/>", schema: AdminSchema } });
  const names = (libs: import("../src/types/livemap.types.ts").LiveMapSnapshot) => libs.registry.libraries.map(entry => entry.name);
  assert.deepEqual(Object.keys(map.cut()), ["libs"]);
  assert.deepEqual(map.cut().libs, map.capture());
  const selections = [
    { options: { documents: [] }, names: ["state"] },
    { options: { data: [] }, names: ["page", "admin"] },
    { options: { data: [], documents: ["page"] }, names: ["page"] },
    { options: { data: ["state"], documents: ["admin"] }, names: ["state", "admin"] },
    { options: { data: [], documents: [] }, names: [] },
  ];
  for (const selection of selections) {
    const { libs } = (map as import("../src/types/livemap.types.ts").LiveMap).cut(selection.options);
    assert.deepEqual(names(libs), selection.names);
    assert.deepEqual(libs.libraries.map(entry => entry.name), selection.names);
    assert.equal(libs.registryDigest, libs.registry.digest);
    assert.notEqual(libs.registryDigest, map.capture().registryDigest);
    assert.deepEqual(install_libraries_snapshot(libs).map.capture(), libs);
    assert.equal("htmlDocument" in libs, false);
  }
  assert.deepEqual(map.cut({ data: [], documents: ["admin", "page"] }).libs,
    map.cut({ data: [], documents: ["page", "admin"] }).libs);
});

check("cut rejects invalid names, families, duplicates and HTML outside transferred documents", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: 1 }, page: { document: "<main/>" }, admin: { document: "<aside/>" } });
  const cut: (options: unknown) => unknown = options => map.cut(options as any);
  for (const options of [null, [], { data: "state" }, { documents: "page" }, { data: ["missing"] },
    { documents: ["missing"] }, { data: ["state", "state"] }, { documents: ["page", "page"] },
    { data: ["page"] }, { documents: ["state"] }, { data: [INTERACTION_RESERVED_LIBRARY_KEY] },
    { documents: [INTERACTION_RESERVED_LIBRARY_KEY] }, { html: "missing" }, { html: "state" },
    { html: INTERACTION_RESERVED_LIBRARY_KEY }, { html: 1 }, { documents: [], html: "page" },
    { documents: ["admin"], html: "page" }, { internal: [] }]) assert.throws(() => cut(options));
  assert.equal(map.rev, 0);
});

check("HTML selection is normalized once before detached state capture", () => {
  const map = hsonLiveMap.fromLibraries({ page: { document: "<main/>" }, admin: { document: "<aside/>" } });
  let reads = 0;
  const options = { get html(): "page" | "admin" { reads += 1; return reads === 1 ? "page" : "admin"; } };
  const cut = map.cut(options);
  assert.equal(reads, 1);
  assert.equal(cut.document, "page");
  assert.equal(cut.html, "<main></main>");
});

check("runtime admissions and dynamic strings retain cut admission and reconstruction", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: 1 }, page: { document: "<main/>" } });
  map.addLibraries({ later: { document: "<aside/>" }, laterState: { data: 2 } });
  const selected = map.cut({ data: ["laterState"], documents: ["later"], html: "later" });
  const name: "later" = selected.document;
  assert.equal(name, "later");
  assert.equal(selected.html, "<aside></aside>");
  assert.deepEqual(selected.libs.registry.libraries.map(entry => entry.name), ["later", "laterState"]);
  assert.deepEqual(install_libraries_snapshot(selected.libs).map.cut().libs, selected.libs);
  const documentName: string = "page";
  const dataName: string = "laterState";
  assert.equal(map.cut({ data: [dataName], documents: [documentName], html: documentName }).html, "<main></main>");
  for (const invalid of ["missing", "state", INTERACTION_RESERVED_LIBRARY_KEY]) {
    const dynamicName: string = invalid;
    assert.throws(() => map.cut({ documents: [dynamicName], html: dynamicName }));
  }
  assert.throws(() => map.cut({ data: [documentName] }));
  assert.equal(map.rev, 1);
});

check("interaction storage follows selected documents and preserves enabled-empty state", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: 1 }, page: { document: "<main <button/>/>" }, admin: { document: "<aside <button/>/>" } });
  assert.equal(map.cut({ data: [], documents: [] }).libs.libraries.length, 0);
  enable_interactions(map);
  for (const library of ["page", "admin"]) add_interaction(map, {
    id: `${library}-click`, subject: { library, path: [0, 0, 0] },
    listener: { event: "click", target: "element", capture: false, once: false, passive: false,
      missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false },
    kind: "browser-local", key: "noop", args: Hson.data.from(null),
  });
  const descriptors = (libs: import("../src/types/livemap.types.ts").LiveMapSnapshot) => {
    const installed = install_libraries_snapshot(libs).map;
    const aggregate = internal_livemap_aggregate_authority(installed);
    const system = aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY);
    assert.ok(system);
    return hsonTransform.fromNode(aggregate.systemRoot(system)).toJson().serialize();
  };
  const selected = map.cut({ data: [], documents: ["page"] });
  assert.deepEqual(selected.libs.registry.libraries.map(entry => entry.name), ["page", INTERACTION_RESERVED_LIBRARY_KEY]);
  assert.match(descriptors(selected.libs), /page-click/);
  assert.doesNotMatch(descriptors(selected.libs), /admin-click/);
  const empty = map.cut({ data: [], documents: [] });
  assert.equal(empty.libs.libraries.length, 1);
  assert.equal(empty.libs.registry.libraries[0]?.scope, "hson-internal");
  assert.deepEqual(JSON.parse(descriptors(empty.libs)), { descriptors: [] });
  assert.deepEqual(install_libraries_snapshot(empty.libs).map.capture(), empty.libs);
  assert.equal(empty.libs.revision, map.rev);
});

check("subset contracts retain the current governing Schema after tightening", () => {
  const map = hsonLiveMap.fromLibraries({ state: { data: { count: 3 } }, page: { document: "<main/>" } });
  const before = map.cut({ documents: [] });
  data(map, "state").schema.use(StateSchema);
  const { libs } = map.cut({ documents: [] });
  assert.equal(libs.revision, map.rev);
  assert.equal(libs.libraries[0]?.schema, StateSchema.toHson());
  assert.notEqual(libs.registryDigest, before.libs.registryDigest);
  assert.equal(libs.libraries[0]?.schemaDigest, libs.registry.libraries[0]?.schemaDigest);
  const installed = install_libraries_snapshot(libs).map;
  assert.equal(data(installed, "state").schema.get().toHson(), StateSchema.toHson());
  assert.throws(() => data(installed, "state").at(["count"]).set("invalid"));
});

check("aggregate-scale roots are consumable without changing ordinary exact-value limits", () => {
  const payload = "x".repeat(5 * 1024 * 1024);
  const map = hsonLiveMap.fromLibraries({ large: { data: { payload } }, page: { document: `<main "${payload}"/>` }, omitted: { data: false } });
  assert.equal(map.lib("page").render(), `<main>${payload}</main>`);
  const cut = map.cut({ data: ["large"], documents: ["page"], html: "page" });
  assert.ok(cut.libs.libraries.every(entry => entry.root.payload.length > 4 * 1024 * 1024));
  const installed = install_libraries_snapshot(cut.libs).map;
  assert.deepEqual(installed.cut().libs.registry, cut.libs.registry);
  assert.equal(data(installed, "large").snap(["payload"]), payload);
  assert.equal(document(installed, "page").render(), cut.html);
  installed.restore(cut.libs);
  assert.equal(data(installed, "large").snap(["payload"]), payload);
  const encoded = encode_ssr_bootstrap(cut.libs);
  const decoded = decode_ssr_bootstrap(encoded);
  assert.equal(decoded.kind, "libraries");
  assert.deepEqual(decoded.bootstrap, cut.libs);
  const root = cut.libs.libraries[0]!.root;
  assert.throws(() => decode_hosted_root(root), /bound|limit/i);
});

check("hosted rendering preserves its fence and produces the existing aggregate recovery cursor", () => {
  const map = hosted_map_fixture();
  enable_interactions(map);
  const locus = hsonLocus.create({ exposure: test_public_exposure(map), map,
    authorizeProjection: () => ({ libraries: ["state", "page"] }) });
  const session = authorized_session(locus, ["state", "page"]);
  const ssr = locus.session.get(session.sessionId)!.cut({ html: "page" });
  assert.equal(ssr.document, "page");
  assert.equal(ssr.libs.authority.logicalMapId, locus.logicalMapId);
  assert.equal(ssr.libs.authority.incarnationId, locus.incarnationId);
  const installed = hsonLiveMap.fromClientSnapshot({ authority: ssr.libs, localLibraries: {} });
  assert.equal(installed.rev, 0);
  session.close();
  locus.dispose();
});

check("only the selected document must satisfy parser realization", () => {
  const map = hsonLiveMap.fromLibraries({
    page: { document: "<main/>", schema: Hson.schema`<type "document" tag "main" content "empty">` },
    broken: { document: '<p <div "direct DOM only"/>/>', schema: Hson.schema`<type "document" tag "p" content <sequence [<tag "div" content "string">]>>` },
  });
  assert.equal(map.cut({ html: "page" }).document, "page");
  expect_phase("realize", () => map.cut({ html: "broken" }));
});

check("HTML cut retains complete transferable state", () => {
  const map = map_fixture();
  enable_interactions(map);
  const rendered = map.cut({ html: "page" });
  assert.deepEqual(Object.keys(rendered).sort(), ["document", "html", "libs"]);
  assert.equal(rendered.document, "page");
  assert.equal(rendered.libs.registry.libraries.some((entry) => entry.name === "state"), true);
  assert.equal(rendered.libs.registry.libraries.some((entry) => entry.scope === "hson-internal"), true);
  map.lib("state").at(["count"]).set(1);
  assert.equal(data(install_libraries_snapshot(rendered.libs).map, "state").snap(["count"]), 0);
  assert.equal(typeof encode_ssr_bootstrap(rendered.libs), "string");
  const hostedMap = hosted_map_fixture();
  const locus = hsonLocus.create({ exposure: test_public_exposure(hostedMap), map: hostedMap,
    authorizeProjection: () => ({ libraries: ["state", "page"] }) });
  const session = authorized_session(locus, ["state", "page"]);
  const hosted = locus.session.get(session.sessionId)!.cut({ html: "page" });
  assert.equal(hosted.document, "page");
  assert.equal(hosted.libs.libraries.some((entry) => entry.name === "state"), true);
  assert.equal(typeof encode_ssr_bootstrap(hosted.libs), "string");
  session.close();
  locus.dispose();
});

check("Libraries rendering selection and hosted cuts preserve the aggregate fence", () => {
  const map = map_fixture(true);
  assert.notEqual(map.cut({ html: "page" }).html, (map as import("../src/types/livemap.types.ts").LiveMap).cut({ html: "admin" }).html);
  const hostedMap = hosted_map_fixture(true);
  const locus = hsonLocus.create({ exposure: test_public_exposure(hostedMap), map: hostedMap,
    authorizeProjection: () => ({ libraries: ["page", "admin"] }) });
  const session = authorized_session(locus, ["page", "admin"]);
  assert.deepEqual(Object.keys(locus.session.get(session.sessionId)!.cut()), ["libs"]);
  const cut = locus.session.get(session.sessionId)!.cut({ html: "page" });
  assert.equal(cut.libs.revision, hostedMap.rev);
  session.close();
  locus.dispose();
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
