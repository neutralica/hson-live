import { test_public_exposure } from "./helpers/hosted-exposure.mts";
import assert from "node:assert/strict";
import {
  DocumentSsrError,
  Hson,
  HsonData,
  encode_ssr_bootstrap,
  add_interaction,
  enable_interactions,
  hsonLiveMap,
  hsonLocus,
  render_document,
  render_hosted_document,
  type HsonSchema,
} from "../src/index.ts";
import type { LocusSocketLike, Locus } from "../src/types/locus.types.ts";
import { install_libraries_snapshot, type LiveMapLibrariesSnapshot } from "../src/api/livemap/index.ts";
import { set_document_ssr_hook_for_tests } from "../src/api/ssr/ssr.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { INTERACTION_RESERVED_LIBRARY_KEY } from "../src/internal/interaction-storage.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries, admit_exact_runtime_livemap_node } from "../src/internal/exact-runtime-node-admission.ts";
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

function authorized_session<TMap extends import("../src/types/livemap.types.ts").LiveMapLibraries>(locus: Locus<TMap>, libraries: string[], htmlDocument?: string) {
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
    libraries, ...(htmlDocument === undefined ? {} : { htmlDocument }),
  } }));
  if (sessionId === undefined) throw new Error("Session authorization failed.");
  return { sessionId, close };
}

check("capture and local install preserve the complete detached aggregate cut", () => {
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

check("sole-document inference renders one document and returns the complete cut", () => {
  const map = map_fixture();
  enable_interactions(map);
  const ssr = render_document({ map });
  const repeated = render_document({ map });
  assert.equal(ssr.document, "page");
  assert.equal(repeated.html, ssr.html);
  assert.deepEqual(repeated.bootstrap, ssr.bootstrap);
  assert.match(ssr.html, /^<main/);
  assert.equal(ssr.bootstrap.libraries.length, 3);
  assert.equal(ssr.bootstrap.registry.libraries.some((entry) => entry.name === "state"), true);
  assert.equal(ssr.bootstrap.registry.libraries.some((entry) => entry.scope === "hson-internal"), true);
});

check("multiple documents require a name and switch only rendered HTML", () => {
  const map = map_fixture(true);
  expect_phase("select", () => render_document({ map }));
  const page = render_document({ map, document: "page" });
  const admin = render_document({ map, document: "admin" });
  assert.equal(page.document, "page");
  assert.equal(admin.document, "admin");
  assert.match(page.html, /^<main/);
  assert.match(admin.html, /^<aside/);
  assert.deepEqual(page.bootstrap, admin.bootstrap);
  assert.equal(install_libraries_snapshot(page.bootstrap).map.lib("admin").mode, "document");
  expect_phase("select", () => render_document({ map, document: "state" }));
  expect_phase("select", () => render_document({ map, document: "missing" }));
});

check("zero public document Libraries reject selection", () => {
  const map = hsonLiveMap.fromLibraries({
    state: { data: { count: 0 }, schema: StateSchema },
  });
  enable_interactions(map);
  expect_phase("select", () => render_document({ map }));
});

check("hidden storage is bootstrapped but never selectable or counted for inference", () => {
  const map = map_fixture();
  enable_interactions(map);
  const ssr = render_document({ map });
  assert.equal(ssr.document, "page");
  expect_phase("select", () => render_document({ map, document: INTERACTION_RESERVED_LIBRARY_KEY }));
  const hidden = ssr.bootstrap.registry.libraries.find((entry) => entry.name === INTERACTION_RESERVED_LIBRARY_KEY);
  assert.equal(hidden?.scope, "hson-internal");
});

check("retired server QUID history stays outside local SSR/install", () => {
  const map = map_fixture();
  map.lib("page").at([]).at([0]).delete();
  const ssr = render_document({ map });
  assert.equal("identity" in ssr.bootstrap, false);
  assert.equal(JSON.stringify(ssr.bootstrap).includes(QUID), false);
  assert.doesNotMatch(JSON.stringify(ssr.bootstrap), /identityEpoch|issuedQuids|"quid"/);
  assert.doesNotMatch(ssr.html, /hson:quid/);
  assert.equal(ssr.html.includes(QUID), false);
  const installed = install_libraries_snapshot(ssr.bootstrap).map;
  assert.equal("identity" in installed.capture(), false);
  assert.equal(installed.rev, ssr.bootstrap.revision);
});

check("schema and registry tampering fails closed", () => {
  const snapshot = map_fixture(true).capture();
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

check("same-cut rendering never rereads source Libraries after aggregate capture", () => {
  const map = map_fixture();
  enable_interactions(map);
  const before = map.cut().data;
  set_document_ssr_hook_for_tests((point) => {
    if (point !== "local-libraries-after-capture") return;
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
  });
  const ssr = render_document({ map });
  set_document_ssr_hook_for_tests(undefined);
  assert.deepEqual(ssr.bootstrap, before);
  assert.match(ssr.html, /title="zero"/);
  assert.equal(data(install_libraries_snapshot(ssr.bootstrap).map, "state").snap(["count"]), 0);
  assert.equal(map.rev, 3);
});

check("hosted rendering preserves its fence and produces the existing aggregate recovery cursor", () => {
  const map = hosted_map_fixture();
  enable_interactions(map);
  const locus = hsonLocus.create({ exposure: test_public_exposure(map), map,
    authorizeProjection: () => ({ libraries: ["state", "page"] }) });
  const session = authorized_session(locus, ["state"], "page");
  const ssr = render_hosted_document({ authority: locus, sessionId: session.sessionId });
  assert.equal(ssr.document, "page");
  assert.equal(ssr.bootstrap.authority.logicalMapId, locus.logicalMapId);
  assert.equal(ssr.bootstrap.authority.incarnationId, locus.incarnationId);
  const installed = hsonLiveMap.fromClientSnapshot({ authority: ssr.bootstrap, localLibraries: {} });
  assert.equal(installed.rev, 0);
  assert.equal(ssr.revision, ssr.bootstrap.revision);
  assert.equal(ssr.projectionDigest, ssr.bootstrap.projectionDigest);
  session.close();
  locus.dispose();
});

check("only the selected document must satisfy parser realization", () => {
  const map = hsonLiveMap.fromLibraries({
    page: { document: "<main/>", schema: Hson.schema`<type "document" tag "main" content "empty">` },
    broken: { document: '<p <div "direct DOM only"/>/>', schema: Hson.schema`<type "document" tag "p" content <sequence [<tag "div" content "string">]>>` },
  });
  assert.equal(render_document({ map, document: "page" }).document, "page");
  expect_phase("realize", () => render_document({ map, document: "broken" }));
});

check("Libraries object cuts infer one document and retain the complete continuation", () => {
  const map = map_fixture();
  enable_interactions(map);
  const cut = map.cut();
  const rendered = render_document({ map });
  assert.deepEqual(cut, { html: rendered.html, data: rendered.bootstrap, document: "page" });
  assert.deepEqual(Object.keys(cut).sort(), ["data", "document", "html"]);
  assert.equal(cut.data.registry.libraries.some((entry) => entry.name === "state"), true);
  assert.equal(cut.data.registry.libraries.some((entry) => entry.scope === "hson-internal"), true);
  map.lib("state").at(["count"]).set(1);
  assert.equal(data(install_libraries_snapshot(cut.data).map, "state").snap(["count"]), 0);
  assert.equal(typeof encode_ssr_bootstrap(cut.data), "string");
  const hostedMap = hosted_map_fixture();
  const locus = hsonLocus.create({ exposure: test_public_exposure(hostedMap), map: hostedMap,
    authorizeProjection: () => ({ libraries: ["state", "page"] }) });
  const session = authorized_session(locus, ["state"], "page");
  const hosted = locus.cut(session.sessionId);
  assert.equal(hosted.document, "page");
  assert.equal(hosted.data.libraries.some((entry) => entry.name === "state"), true);
  assert.equal(typeof encode_ssr_bootstrap(hosted.data), "string");
  session.close();
  locus.dispose();
});

check("Libraries selection and hosted object cuts preserve the aggregate fence", () => {
  const map = map_fixture(true);
  expect_phase("select", () => map.cut());
  assert.notEqual(map.cut("page").html, map.cut("admin").html);
  const hostedMap = hosted_map_fixture(true);
  const locus = hsonLocus.create({ exposure: test_public_exposure(hostedMap), map: hostedMap,
    authorizeProjection: () => ({ libraries: ["page", "admin"] }) });
  const session = authorized_session(locus, ["page", "admin"]);
  expect_phase("select", () => locus.cut(session.sessionId));
  const cut = locus.cut(session.sessionId, "page");
  const rendered = render_hosted_document({ authority: locus, sessionId: session.sessionId, document: "page" });
  assert.deepEqual(cut, { html: rendered.html, data: rendered.bootstrap, document: "page",
    revision: rendered.revision, projectionDigest: rendered.projectionDigest });
  assert.equal(cut.data.revision, hostedMap.rev);
  session.close();
  locus.dispose();
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
