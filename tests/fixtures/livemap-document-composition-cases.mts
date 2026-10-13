import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { install_libraries_snapshot, validate_document_path, type LiveMapCommit } from "../../src/api/livemap/index.ts";
import { compose_livemap_document_internal, make_livemap_from_authored_libraries_internal as authored,
  prepare_hosted_livemap_library_add_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { lookup_document_quad_internal as lookup, parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { expand_document_composition, document_composition_options } from "../../src/api/livemap/livemap.document.composition.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { admit_public_livemap_root } from "../../src/api/livemap/livemap.node-admission.ts";
import { admit_exact_runtime_livemap_libraries } from "../../src/internal/exact-runtime-node-admission.ts";
import { parse_hson_exact_runtime } from "../../src/internal/exact-runtime-hson-codec.ts";
import { ROOT_TAG, ELEM_TAG, STR_TAG } from "../../src/core/constants.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type { LiveMap, LiveMapDocumentLibrary, LiveMapDocumentRequestTarget } from "../../src/types/livemap.types.ts";
import { acquire_document_identity } from "../helpers/livemap-identity-internal.mts";
import { mint_hson_node_quid } from "../../src/core/hson-node-quid.ts";
import { set_livemap_quid_candidate_source_for_tests } from "../../src/api/livemap/livemap.quid-allocation.ts";

const empty = (): HsonNode => ({ $_tag: ROOT_TAG, $_content: [] });
const node = (value: unknown): HsonNode => { if (!is_Node(value)) throw Error("Expected a node"); return value; };
const target = (...path: number[]): LiveMapDocumentRequestTarget => ({ kind: "path", path });
const selection_controls = (selection: "whole" | "selected" | "customized" | "configured" | "receiving"): string => selection === "whole" ? ""
  : selection === "customized" ? ' quad="button" title="Customized" "Custom text"' : ' quad="button"';
const selection_options = (selection: string) => selection === "configured" || selection === "receiving"
  ? { configuration: { at: { slot: { attrs: { title: "Configured" }, text: "Configured text",
    ...(selection === "receiving" ? { as: "received" } : {}) } } } } : undefined;
const doc = (map: LiveMap, name: string): LiveMapDocumentLibrary => {
  const library = map.lib(name);
  if (library.mode !== "document") throw Error("Expected a document Library");
  return library;
};
const tokens = (root: HsonNode): string[] => {
  const result: string[] = [];
  const visit = (item: HsonNode): void => {
    if (item.$_tag === STR_TAG) { result.push(String(item.$_content[0])); return; }
    if (item.$_tag !== ROOT_TAG && item.$_tag !== ELEM_TAG) result.push(item.$_tag);
    for (const child of item.$_content) if (is_Node(child)) visit(child);
  };
  visit(root); return result;
};
const fixture = () => hsonLiveMap.fromLibraries({
  layout: { document: '<main <hson-template lib="components"/> <hson-template lib="components"/>/>' },
  components: { document: '<a href="/home" style="color:blue" "Home"/>' },
});
function atomic(map: LiveMap, run: () => unknown, pattern?: RegExp): void {
  const before = map.capture();
  const aggregate = internal_livemap_aggregate_authority(map);
  const epoch = aggregate.identityEpoch();
  const registry = aggregate.hostedRegistry(), ledger = epoch.issued(), revision = map.rev;
  const issued = enumerate_livemap_issued_quids(epoch.issued());
  const roots = aggregate.libraries().map(identity => aggregate.root(identity));
  const overlays = aggregate.libraries().filter((_identity, index) => aggregate.hostedRegistry().libraries[index]?.mode === "document")
    .map(identity => aggregate.documentOverlay(identity));
  const commits: LiveMapCommit[] = [];
  let positions = 0;
  const stopPosition = aggregate.observeAuthorityPosition(() => positions++);
  const subscription = map.commits.observe(commit => commits.push(commit));
  try { if (pattern) assert.throws(run, pattern); else assert.throws(run); }
  finally { subscription(); stopPosition(); }
  assert.deepEqual(map.capture(), before);
  assert.deepEqual(enumerate_livemap_issued_quids(epoch.issued()), issued);
  assert.equal(aggregate.identityEpoch(), epoch);
  assert.equal(aggregate.hostedRegistry(), registry);
  assert.equal(epoch.issued(), ledger);
  assert.equal(map.rev, revision);
  aggregate.libraries().forEach((identity, index) => assert.equal(aggregate.root(identity), roots[index]));
  const afterOverlays = aggregate.libraries().filter((_identity, index) => aggregate.hostedRegistry().libraries[index]?.mode === "document")
    .map(identity => aggregate.documentOverlay(identity));
  afterOverlays.forEach((overlay, index) => assert.equal(overlay, overlays[index]));
  assert.equal(commits.length, 0);
  assert.equal(positions, 0);
}

export function document_composition_cases(check: (name: string, run: () => void) => void): void {
  check("ordinary registration publishes one topology commit and a cached document handle", () => {
    const map = fixture();
    const commits: LiveMapCommit[] = [];
    map.commits.observe(commit => {
      assert.equal(doc(map, "page").mode, "document", "binding exists before publication");
      commits.push(commit);
    });
    const page = compose_livemap_document_internal(map, "layout", "page");
    assert.equal(page, map.lib("page"));
    assert.deepEqual([map.rev, page.rev, map.lib("components").rev], [1, 1, 1]);
    assert.equal(commits.length, 1);
    assert.deepEqual([commits[0]!.prevRev, commits[0]!.rev], [0, 1]);
    assert.equal(Reflect.get(commits[0]!.operations[0]!.operation, "kind"), "library-add");
    assert.deepEqual(tokens(page.root()), ["main", "a", "Home", "a", "Home"]);
    assert.match(page.render(), /href="\/home"/);
    assert.match(page.schema.get().toHson(), /document/);
    assert.equal(page.css.snapshot(), "");
    assert.equal(Reflect.get(map, "template"), undefined, "no new public API");
  });
  check("ordinary document edits commit to the map and keep sources independent", () => {
    const map = fixture();
    const layout = map.lib("layout").root();
    const component = map.lib("components").root();
    const page = compose_livemap_document_internal(map, "layout", "page");
    const commits: LiveMapCommit[] = [];
    map.commits.observe(commit => commits.push(commit));
    const change = page.document.attrs.set(target(0, 0, 0), "href", "/about");
    assert.deepEqual(change.operations.map(entry => entry.library), ["page"]);
    assert.deepEqual([change.prevRev, change.rev], [1, 2]);
    page.at([]).asElement()!.insert(2, { $_tag: "footer", $_content: [] });
    page.at([]).asElement()!.move(2, 0);
    page.document.content.remove(target(0, 0), 0);
    page.document.content.replace(target(0, 0, 0, 0), 0, { $_tag: STR_TAG, $_content: ["About"] });
    assert.equal(map.rev, 6);
    assert.equal(commits.length, 5);
    assert.deepEqual(tokens(page.root()), ["main", "a", "About", "a", "Home"]);
    assert.equal(page.document.attrs.get(target(0, 0, 0), "href"), "/about");
    assert.equal(page.document.attrs.get(target(0, 0, 1), "href"), "/home");
    assert.deepEqual(map.lib("layout").root(), layout);
    assert.deepEqual(map.lib("components").root(), component);
  });
  check("repeated occurrences own independent nested attribute storage", () => {
    const map = fixture();
    const page = compose_livemap_document_internal(map, "layout", "page");
    const aggregate = internal_livemap_aggregate_authority(map);
    const owned = aggregate.root(aggregate.libraries()[2]!);
    const children = node(node(owned.$_content[0]).$_content[0]).$_content;
    const first = node(children[0]), second = node(children[1]);
    const source = node(aggregate.root(aggregate.libraries()[1]!).$_content[0]);
    assert.notEqual(first, second); assert.notEqual(first, source);
    assert.notEqual(first.$_attrs, second.$_attrs); assert.notEqual(first.$_attrs, source.$_attrs);
    assert.equal(typeof first.$_attrs?.style, "object");
    assert.notEqual(first.$_attrs?.style, second.$_attrs?.style);
    assert.notEqual(first.$_attrs?.style, source.$_attrs?.style);
    assert.notEqual(first.$_content, second.$_content);
    assert.notEqual(node(first.$_content[0]), node(second.$_content[0]));
    assert.deepEqual(page.root(), JSON.parse(JSON.stringify(admit_public_livemap_root(page.root(), "document", "composition test"))));
  });
  check("source identities stay unchanged and receiving subjects acquire fresh sparse QUIDs", () => {
    const map = fixture();
    const sourceHandle = acquire_document_identity(map.lib("components").document, target(0));
    const sourceQuid = sourceHandle.snap()?.$_meta?.quid;
    assert.equal(typeof sourceQuid, "string");
    const aggregate = internal_livemap_aggregate_authority(map);
    const sourceIdentity = aggregate.libraries()[1]!;
    const beforeRoot = aggregate.root(sourceIdentity);
    const beforeOverlay = aggregate.documentOverlay(sourceIdentity);
    const epoch = aggregate.identityEpoch();
    const issued = enumerate_livemap_issued_quids(epoch.issued());
    const page = compose_livemap_document_internal(map, "layout", "page");
    assert.equal(aggregate.root(sourceIdentity), beforeRoot);
    assert.equal(aggregate.documentOverlay(sourceIdentity), beforeOverlay);
    assert.equal(aggregate.identityEpoch(), epoch);
    assert.deepEqual(enumerate_livemap_issued_quids(epoch.issued()), issued);
    assert.equal(aggregate.documentOverlay(aggregate.libraries()[2]!).size, 0);
    assert.equal(JSON.stringify(page.root()).includes("quid"), false);
    const first = acquire_document_identity(page.document, target(0, 0, 0));
    const second = acquire_document_identity(page.document, target(0, 0, 1));
    assert.notEqual(first.snap()?.$_meta?.quid, second.snap()?.$_meta?.quid);
    assert.notEqual(first.snap()?.$_meta?.quid, sourceQuid);
    assert.notEqual(second.snap()?.$_meta?.quid, sourceQuid);
    assert.equal(page.document.byQuid(String(sourceQuid)), undefined);
    assert.equal(map.rev, 1, "identity acquisition has no graph commit");
    page.at([]).asElement()!.move(0, 1);
    assert.deepEqual(first.path(), [0, 0, 1]);
    page.document.content.remove(target(0, 0), 1);
    assert.equal(first.active, false); assert.equal(second.active, true);
    assert.equal(sourceHandle.active, true); assert.deepEqual(sourceHandle.path(), [0]);
    assert.equal(aggregate.root(sourceIdentity), beforeRoot);
    assert.equal(aggregate.documentOverlay(sourceIdentity), beforeOverlay);
  });
  check("owner-proven canonical source QUIDs are stripped at every copied descendant", () => {
    const q1 = "000009001", q2 = "000009002";
    const map = admit_exact_runtime_livemap_libraries({
      layout: { document: '<main <hson-template lib="components"/> <hson-template lib="components"/>/>' },
      components: { document: parse_hson_exact_runtime(`<section @${q1} <a @${q2} "Text"/>/>`, { allowTopLevelDocumentText: true }) },
    });
    const before = map.lib("components").root();
    const page = compose_livemap_document_internal(map, "layout", "page");
    assert.equal(JSON.stringify(page.root()).includes("quid"), false);
    assert.deepEqual(map.lib("components").root(), before);
    assert.equal(map.lib("components").document.byQuid(q1)?.$_tag, "section");
    assert.equal(map.lib("components").document.byQuid(q2)?.$_tag, "a");
  });
  check("recursive finite hierarchy resolves completely and repeated references are legal", () => {
    const map = hsonLiveMap.fromLibraries({
      layout: { document: '<main <hson-template lib="header"/> <hson-template lib="header"/>/>' },
      header: { document: '<header <hson-template lib="nav"/>/>' },
      nav: { document: '<nav <hson-template lib="button"/> <hson-template lib="button"/>/>' },
      button: { document: '<button "Go"/>' },
    });
    const page = compose_livemap_document_internal(map, "layout", "page");
    assert.deepEqual(tokens(page.root()), ["main", "header", "nav", "button", "Go", "button", "Go", "header", "nav", "button", "Go", "button", "Go"]);
    assert.equal(JSON.stringify(page.root()).includes("hson-template"), false);
  });
  check("zero-root insertion removes empty ELEM carriers without introducing wrappers", () => {
    const map = hsonLiveMap.fromLibraries({
      layout: { document: '<main <hson-template lib="empty"/>/>' }, empty: { document: empty() },
      top: { document: '<hson-template lib="empty"/>' },
    });
    const page = compose_livemap_document_internal(map, "layout", "page");
    assert.deepEqual(page.root(), { $_tag: ROOT_TAG, $_content: [{ $_tag: "main", $_content: [] }] });
    assert.deepEqual(compose_livemap_document_internal(map, "top", "zero").root(), empty());
    assert.deepEqual(compose_livemap_document_internal(map, "empty", "zeroAgain").root(), empty());
  });
  check("multiple roots and text preserve exact order at nested and top-level connectors", () => {
    const map = hsonLiveMap.fromLibraries({
      layout: { document: '<main "before" <hson-template lib="mixed"/> "after"/>' },
      mixed: { document: '"left" <a "A"/> <b/> "right"' },
      top: { document: '<i/> <hson-template lib="mixed"/> <j/>' },
    });
    assert.deepEqual(tokens(compose_livemap_document_internal(map, "layout", "page").root()), ["main", "before", "left", "a", "A", "b", "right", "after"]);
    const multi = compose_livemap_document_internal(map, "top", "multi");
    assert.deepEqual(tokens(multi.root()), ["i", "left", "a", "A", "b", "right", "j"]);
    assert.throws(() => multi.render(), /browser-parser realization/i, "existing single-root render contract remains authoritative");
  });
  check("ordinary native template elements retain their content", () => {
    const map = hsonLiveMap.fromLibraries({ layout: { document: '<main <template lib="absent" <span "Native"/>/>/>' } });
    assert.deepEqual(tokens(compose_livemap_document_internal(map, "layout", "page").root()), ["main", "template", "span", "Native"]);
  });
  check("text-only roots and empty insertions between text preserve distinct canonical leaves", () => {
    const map = hsonLiveMap.fromLibraries({
      layout: { document: '<main "before" <hson-template lib="empty"/> <hson-template lib="text"/> "after"/>' },
      empty: { document: empty() }, text: { document: '"selected"' },
    });
    const page = compose_livemap_document_internal(map, "layout", "page");
    assert.deepEqual(tokens(page.root()), ["main", "before", "selected", "after"]);
    const leaves = node(node(page.root().$_content[0]).$_content[0]).$_content;
    assert.deepEqual(leaves.map(leaf => node(leaf).$_content), [["before"], ["selected"], ["after"]]);
    assert.deepEqual(compose_livemap_document_internal(map, "text", "textCopy").root(), map.lib("text").root());
  });
  check("construction has no later source dependency and compositions can be selected as sources", () => {
    const map = fixture();
    const page = compose_livemap_document_internal(map, "layout", "page");
    map.lib("components").document.attrs.set(target(0), "href", "/new");
    assert.equal(page.document.attrs.get(target(0, 0, 0), "href"), "/home");
    const next = compose_livemap_document_internal(map, "layout", "next");
    assert.equal(next.document.attrs.get(target(0, 0, 0), "href"), "/new");
    const copy = compose_livemap_document_internal(map, "page", "copy");
    page.document.attrs.set(target(0, 0, 0), "href", "/edited");
    assert.equal(copy.document.attrs.get(target(0, 0, 0), "href"), "/home");
  });
  check("missing and wrong-kind sources reject atomically", () => {
    const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template lib="missing"/>' }, data: { data: { count: 1 } }, wrong: { document: '<hson-template lib="data"/>' } });
    atomic(map, () => compose_livemap_document_internal(map, "absent", "page"), /Unknown.*Library/);
    atomic(map, () => compose_livemap_document_internal(map, "layout", "page"), /Unknown.*Library/);
    atomic(map, () => compose_livemap_document_internal(map, "data", "page"), /not a document/);
    atomic(map, () => compose_livemap_document_internal(map, "wrong", "page"), /not a document/);
  });
  check("whole Library override attributes reject instead of disappearing", () => {
    for (const attr of ['href="/about"', 'label="About"', 'id="marker"', 'style="color:red"']) {
      const map = hsonLiveMap.fromLibraries({ layout: { document: `<hson-template lib="component" ${attr}/>` }, component: { document: '<a/>' } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "page"), /requires explicit QUAD/);
    }
  });
  check("whole Library connectors require a nonempty string lib and absent content", () => {
    for (const document of ['<hson-template/>', '<hson-template lib=""/>', '<hson-template lib="component" "description"/>', '<hson-template lib="component" <span/>/>']) {
      const map = hsonLiveMap.fromLibraries({ layout: { document }, component: { document: '<a/>' } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "page"), /requires.*lib|requires explicit QUAD/);
    }
  });
  check("inherited lib getters cannot resolve connectors or reenter source reads", () => {
    const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template/>' }, component: { document: '<a/>' } });
    let calls = 0;
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "lib");
    Object.defineProperty(Object.prototype, "lib", { configurable: true, get() { calls++; return "component"; } });
    try { atomic(map, () => compose_livemap_document_internal(map, "layout", "page"), /requires.*lib/); }
    finally {
      if (previous === undefined) Reflect.deleteProperty(Object.prototype, "lib");
      else Object.defineProperty(Object.prototype, "lib", previous);
    }
    assert.equal(calls, 0);
  });
  check("direct and indirect active reference cycles reject atomically", () => {
    const direct = hsonLiveMap.fromLibraries({ a: { document: '<hson-template lib="a"/>' } });
    atomic(direct, () => compose_livemap_document_internal(direct, "a", "page"), /cycle: a -> a/);
    const indirect = hsonLiveMap.fromLibraries({ a: { document: '<hson-template lib="b"/>' }, b: { document: '<section <hson-template lib="c"/>/>' }, c: { document: '<hson-template lib="a"/>' } });
    atomic(indirect, () => compose_livemap_document_internal(indirect, "a", "page"), /cycle: a -> b -> c -> a/);
  });
  check("reference and structural depth are bounded before ordinary admission", () => {
    const map = hsonLiveMap.fromLibraries({ a: { document: '<hson-template lib="b"/>' }, b: { document: '<hson-template lib="c"/>' }, c: { document: '<main/>' }, nested: { document: '<main <section <a/>/>/>' } });
    atomic(map, () => compose_livemap_document_internal(map, "a", "page", { maxDepth: 2 }), /depth limit/);
    atomic(map, () => compose_livemap_document_internal(map, "nested", "page", { maxDepth: 2 }), /depth limit/);
    assert.deepEqual(tokens(compose_livemap_document_internal(map, "a", "page", { maxDepth: 3 }).root()), ["main"]);
  });
  check("expanded output and zero-output recursive work have finite node budgets", () => {
    const map = fixture();
    atomic(map, () => compose_livemap_document_internal(map, "layout", "page", { maxNodes: 5 }), /node limit/);
    const zero = hsonLiveMap.fromLibraries({ a: { document: '<hson-template lib="b"/> <hson-template lib="b"/>' }, b: { document: '<hson-template lib="c"/> <hson-template lib="c"/>' }, c: { document: empty() } });
    atomic(zero, () => compose_livemap_document_internal(zero, "a", "page", { maxNodes: 4 }), /node limit/);
    assert.deepEqual(compose_livemap_document_internal(zero, "a", "page", { maxNodes: 7 }).root(), empty());
  });
  check("text and attribute payloads share the expanded character budget", () => {
    const map = fixture();
    atomic(map, () => compose_livemap_document_internal(map, "layout", "page", { maxCharacters: 20 }), /character limit/);
    const attrs = hsonLiveMap.fromLibraries({ layout: { document: `<main title="${"x".repeat(60)}"/>` } });
    atomic(attrs, () => compose_livemap_document_internal(attrs, "layout", "page", { maxCharacters: 50 }), /character limit/);
  });
  check("invalid private limits and executable options cannot enter source capture", () => {
    const map = fixture();
    for (const maxNodes of [0, -1, 1.5, NaN, Infinity, 100_001]) atomic(map, () => compose_livemap_document_internal(map, "layout", "page", { maxNodes }));
    let calls = 0;
    const options = { get maxNodes() { calls++; return 10; } };
    atomic(map, () => compose_livemap_document_internal(map, "layout", "page", options), /data fields/);
    assert.equal(calls, 0);
    assert.throws(() => document_composition_options({ maxNodes: null } as never));
    assert.throws(() => document_composition_options({ extra: 1 } as never));
  });
  check("each selected managed stylesheet is explicitly unsupported; unrelated CSS is untouched", () => {
    for (const name of ["layout", "components"]) {
      const map = fixture();
      doc(map, name).css.stylesheet("a {color:red}");
      atomic(map, () => compose_livemap_document_internal(map, "layout", "page"), /managed stylesheet.*not supported/);
    }
    for (const css of ['@layer empty{}', '@keyframes spin{from{opacity:0}to{opacity:1}}', '@property --tone{syntax:"<color>";inherits:true;initial-value:red}']) {
      const map = fixture(); map.lib("components").css.stylesheet(css);
      atomic(map, () => compose_livemap_document_internal(map, "layout", "page"), /managed stylesheet.*not supported/);
    }
    const map = fixture(); map.addLibraries({ unrelated: { document: '<aside/>' } });
    doc(map, "unrelated").css.stylesheet("aside{color:red}");
    const css = doc(map, "unrelated").css.snapshot();
    assert.equal(compose_livemap_document_internal(map, "layout", "page").css.snapshot(), "");
    assert.equal(doc(map, "unrelated").css.snapshot(), css);
  });
  check("authored style nodes and inline styles survive structural copying", () => {
    const map = hsonLiveMap.fromLibraries({ layout: { document: '<main <hson-template lib="component"/>/>' }, component: { document: '<style "a {color:red}"/> <a style="color:blue" "Link"/>' } });
    const page = compose_livemap_document_internal(map, "layout", "page");
    assert.deepEqual(tokens(page.root()), ["main", "style", "a {color:red}", "a", "Link"]);
    assert.deepEqual(page.document.attrs.get(target(0, 0, 1), "style"), map.lib("component").document.attrs.get(target(1), "style"));
    assert.match(page.render(), /color.*blue/);
  });
  check("complete result Schema failure and duplicate names publish nothing", () => {
    const map = fixture();
    const schema = Hson.schema`<type "document" tag "main" content "empty">`;
    atomic(map, () => compose_livemap_document_internal(map, "layout", "page", { schema }), /schema/i);
    const dataSchema = Hson.schema`<type "data" content <count "number">>`;
    atomic(map, () => compose_livemap_document_internal(map, "layout", "page", { schema: dataSchema }), /document|family/i);
    atomic(map, () => compose_livemap_document_internal(map, "layout", "components"), /already|duplicate/i);
    atomic(map, () => compose_livemap_document_internal(map, "layout", ""), /name.*empty/i);
    assert.throws(() => map.lib("page"));
  });
  check("the admitted result retains ordinary Schema editing governance", () => {
    const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template lib="component"/>' }, component: { document: '<main/>' } });
    const schema = Hson.schema`<type "document" tag "main" attrs <props <title <optional "string">>> content "empty">`;
    const page = compose_livemap_document_internal(map, "layout", "page", { schema });
    assert.equal(page.schema.get(), schema);
    page.document.attrs.set(target(0), "title", "Allowed");
    atomic(map, () => page.at([]).asElement()!.insert(0, { $_tag: "span", $_content: [] }), /schema/i);
    assert.equal(page.document.attrs.get(target(0), "title"), "Allowed");
  });
  check("ordinary capture restoration and topology replay include the registered result", () => {
    const map = fixture();
    const replica = install_libraries_snapshot(map.capture()).map;
    const commits: LiveMapCommit[] = [];
    map.commits.observe(commit => commits.push(commit));
    const page = compose_livemap_document_internal(map, "layout", "page");
    replica.replay(commits[0]!);
    assert.deepEqual(doc(replica, "page").root(), page.root());
    assert.deepEqual(replica.capture(), map.capture());
    acquire_document_identity(page.document, target(0, 0, 0));
    page.css.stylesheet("a{color:green}");
    const captured = map.capture();
    const restored = install_libraries_snapshot(captured).map;
    assert.deepEqual(restored.capture(), captured);
    assert.deepEqual(doc(restored, "page").root(), page.root());
    assert.equal(doc(restored, "page").css.snapshot(), page.css.snapshot());
    assert.equal(internal_livemap_aggregate_authority(restored).identityEpoch().issued().size, 0);
    doc(restored, "page").document.attrs.set(target(0, 0, 0), "href", "/restored");
    assert.equal(restored.rev, map.rev + 1);
  });
  check("ordinary authority and batch fences reject construction without bypasses", () => {
    const map = fixture();
    atomic(map, () => map.batch(() => { compose_livemap_document_internal(map, "layout", "page"); }), /batch/i);
    const aggregate = internal_livemap_aggregate_authority(map), owner = {};
    aggregate.claimManagement(owner);
    try { atomic(map, () => compose_livemap_document_internal(map, "layout", "page"), /managed|authority/i); }
    finally { aggregate.releaseManagement(owner); }
  });
  check("selected roots are read once per operation even when referenced repeatedly", () => {
    const roots = new Map<string, HsonNode>([
      ["layout", doc(fixture(), "layout").root()], ["components", doc(fixture(), "components").root()],
    ]);
    const reads: string[] = [];
    const root = expand_document_composition("layout", name => {
      reads.push(name); const value = roots.get(name); if (!value) throw Error("Missing fixture"); return value;
    }, document_composition_options(undefined));
    assert.deepEqual(reads, ["layout", "components"]);
    assert.deepEqual(tokens(root.root), ["main", "a", "Home", "a", "Home"]);
  });
  check("QUAD selection retains top-level nested empty and complete multi-descendant subjects", () => {
    for (const entry of [
      { source: '<aside/> <button @:picked title="top" "Go"/> <footer/>', expected: '<button title="top" "Go"/>' },
      { source: '<main <aside/> <section <button @:picked title="nested" "Go"/> <i/>/> <footer/>/>', expected: '<button title="nested" "Go"/>' },
      { source: '<main <button @:picked title="empty"/> <aside/>/>', expected: '<button title="empty"/>' },
      { source: '<main <section @:picked title="all" "before" <b "Bold"/> <i/> "after"/> <aside/>/>', expected: '<section title="all" "before" <b "Bold"/> <i/> "after"/>' },
    ]) {
      const map = authored({ layout: { document: '<hson-template lib="components" quad="picked"/>' }, components: { document: entry.source } });
      const before = map.capture(), address = lookup(doc(map, "components"), "picked");
      const result = compose_livemap_document_internal(map, "layout", "page");
      assert.deepEqual(result.root(), JSON.parse(JSON.stringify(parse_authored_document_library(entry.expected).root)));
      assert.deepEqual(map.capture().libraries.slice(0, 2), before.libraries);
      assert.deepEqual(lookup(doc(map, "components"), "picked"), address);
    }
  });
  check("selected content expands nested whole and QUAD connectors without unrelated invalid siblings", () => {
    const map = authored({
      layout: { document: '<main <hson-template lib="components" quad="panel"/>/>' },
      components: { document: '<hson-template/> <section @:panel "before" <hson-template lib="text"/> <hson-template lib="components" quad="button"/> "after"/> <button @:button "Go"/> <hson-template lib="missing"/>' },
      text: { document: '"Text" <b/>' },
    });
    assert.deepEqual(tokens(compose_livemap_document_internal(map, "layout", "page").root()), ["main", "section", "before", "Text", "b", "button", "Go", "after"]);
    atomic(map, () => compose_livemap_document_internal(map, "components", "whole"), /requires.*lib/);
    const invalid = authored({ layout: { document: '<main <b/> <hson-template lib="components" quad="panel"/>/>' },
      components: { document: '<section @:panel <hson-template lib="missing"/>/>' } });
    atomic(invalid, () => compose_livemap_document_internal(invalid, "layout", "page"), /Unknown.*Library/);
  });
  check("repeated selections different subjects and Library-local identical names are finite", () => {
    const map = authored({
      layout: { document: '<main <hson-template lib="one" quad="same"/> <hson-template lib="one" quad="same"/> <hson-template lib="one" quad="other"/> <hson-template lib="two" quad="same"/>/>' },
      one: { document: '<section @:same <hson-template lib="one" quad="other"/>/> <button @:other "One"/>' },
      two: { document: '<aside @:same "Two"/>' },
    });
    assert.deepEqual(tokens(compose_livemap_document_internal(map, "layout", "page").root()), ["main", "section", "button", "One", "section", "button", "One", "button", "One", "aside", "Two"]);
    const self = authored({ page: { document: '<main <hson-template lib="page" quad="leaf"/>/> <button @:leaf/>' } });
    assert.deepEqual(tokens(compose_livemap_document_internal(self, "page", "result").root()), ["main", "button", "button"]);
  });
  check("addressed connector subjects expand and transfer neither source nor receiving connector declarations", () => {
    const map = authored({ layout: { document: '<main <hson-template @:slot lib="aliases" quad="alias"/>/>' },
      aliases: { document: '<hson-template @:alias lib="components" quad="button"/>' }, components: { document: '<button @:button "Go"/>' } });
    const before = map.capture();
    const result = compose_livemap_document_internal(map, "layout", "result");
    assert.deepEqual(tokens(result.root()), ["main", "button", "Go"]);
    for (const name of ["slot", "alias", "button"]) assert.equal(lookup(result, name), undefined);
    assert.deepEqual(map.capture().libraries.slice(0, 3), before.libraries);
    assert.equal(map.capture().libraries[3]?.quads, undefined);
    assert.ok(lookup(doc(map, "aliases"), "alias"));
    const zero = authored({ layout: { document: '<main <hson-template lib="aliases" quad="alias"/>/>' },
      aliases: { document: '<hson-template @:alias lib="empty"/>' }, empty: { document: empty() } });
    assert.deepEqual(compose_livemap_document_internal(zero, "layout", "result").root(), { $_tag: ROOT_TAG, $_content: [{ $_tag: "main", $_content: [] }] });
  });
  check("active selected cycles direct indirect and mixed with whole Libraries reject atomically", () => {
    const cases = [
      { layout: '<hson-template lib="a" quad="x"/>', a: '<section @:x <hson-template lib="a" quad="x"/>/>', b: '<aside/>' },
      { layout: '<hson-template lib="a" quad="x"/>', a: '<section @:x <hson-template lib="a" quad="y"/>/> <aside @:y <hson-template lib="a" quad="x"/>/>', b: '<aside/>' },
      { layout: '<hson-template lib="a" quad="x"/>', a: '<section @:x <hson-template lib="b" quad="x"/>/>', b: '<aside @:x <hson-template lib="a" quad="x"/>/>' },
      { layout: '<hson-template lib="a"/>', a: '<hson-template lib="b" quad="x"/>', b: '<aside @:x <hson-template lib="a"/>/>' },
      { layout: '<hson-template lib="a" quad="x"/>', a: '<hson-template @:x lib="b"/>', b: '<hson-template lib="a" quad="x"/>' },
      { layout: '<hson-template lib="a" quad="x"/>', a: '<hson-template @:x lib="a" quad="x"/>', b: '<aside/>' },
    ];
    for (const entry of cases) {
      const map = authored({ layout: { document: entry.layout }, a: { document: entry.a }, b: { document: entry.b } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "result"), /composition cycle/);
    }
  });
  check("selected traversal preserves structural reference node and character bounds", () => {
    const map = authored({ layout: { document: '<hson-template lib="parts" quad="alias"/>' },
      parts: { document: '<hson-template @:alias lib="parts" quad="panel"/> <section @:panel title="long-value" <button/>/>' } });
    atomic(map, () => compose_livemap_document_internal(map, "layout", "result", { maxDepth: 2 }), /depth limit/);
    atomic(map, () => compose_livemap_document_internal(map, "layout", "result", { maxNodes: 3 }), /node limit/);
    atomic(map, () => compose_livemap_document_internal(map, "layout", "result", { maxCharacters: 15 }), /character limit/);
    assert.deepEqual(tokens(compose_livemap_document_internal(map, "layout", "result").root()), ["section", "button"]);
    const zero = authored({ layout: { document: '<hson-template lib="parts" quad="zero"/> <hson-template lib="parts" quad="zero"/>' },
      parts: { document: '<hson-template @:zero lib="empty"/>' }, empty: { document: empty() } });
    atomic(zero, () => compose_livemap_document_internal(zero, "layout", "result", { maxNodes: 4 }), /node limit/);
    assert.deepEqual(compose_livemap_document_internal(zero, "layout", "result", { maxNodes: 5 }).root(), empty());
  });
  check("selection follows movement and valid lineage and never reuses a retired subject path", () => {
    const map = authored({ layout: { document: '<hson-template lib="parts" quad="button"/>' },
      parts: { document: '<main <button @:button "Before"/> <aside/>/>' } });
    const parts = doc(map, "parts"), before = lookup(parts, "button")!;
    parts.at([]).asElement()!.move(0, 1);
    assert.deepEqual(lookup(parts, "button")?.path, [0, 0, 1]);
    assert.deepEqual(tokens(compose_livemap_document_internal(map, "layout", "moved").root()), ["button", "Before"]);
    parts.document.content.replace(target(0, 0), 1, node(parse_authored_document_library('<a title="after" "After"/>').root.$_content[0]),
      [{ source: validate_document_path([]), destination: validate_document_path([]) }]);
    assert.equal(lookup(parts, "button")?.quid, before.quid);
    assert.deepEqual(compose_livemap_document_internal(map, "layout", "survivor").root(), JSON.parse(JSON.stringify(parse_authored_document_library('<a title="after" "After"/>').root)));
    parts.document.content.replace(target(0, 0), 1, { $_tag: "button", $_attrs: { id: "button" }, $_content: [] });
    acquire_document_identity(parts.document, target(0, 0, 1));
    assert.equal(lookup(parts, "button"), undefined);
    atomic(map, () => compose_livemap_document_internal(map, "layout", "retired"), /Unknown or retired.*QUAD/);
  });
  check("selected occurrences own fresh storage and identity without changing source bindings or overlays", () => {
    const map = authored({ layout: { document: '<main <hson-template @:slot lib="parts" quad="button"/> <hson-template lib="parts" quad="button"/>/>' },
      parts: { document: '<section <button @:button style="color:blue" <span @:label "Go"/>/> <aside/>/>' } });
    const aggregate = internal_livemap_aggregate_authority(map), ids = aggregate.libraries();
    const roots = ids.map(id => aggregate.root(id)), overlays = ids.map(id => aggregate.documentOverlay(id));
    const issued = enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), capture = map.capture();
    const source = lookup(doc(map, "parts"), "button")!, label = lookup(doc(map, "parts"), "label")!;
    const result = compose_livemap_document_internal(map, "layout", "result");
    ids.forEach((id, index) => { assert.equal(aggregate.root(id), roots[index]); assert.equal(aggregate.documentOverlay(id), overlays[index]); });
    assert.deepEqual(map.capture().libraries.slice(0, 2), capture.libraries);
    assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), issued);
    assert.equal(JSON.stringify(result.root()).includes('"quid"'), false);
    for (const name of ["slot", "button", "label"]) assert.equal(lookup(result, name), undefined);
    assert.deepEqual(lookup(doc(map, "parts"), "button"), source); assert.deepEqual(lookup(doc(map, "parts"), "label"), label);
    const receiving = aggregate.root(aggregate.libraries()[2]!);
    const children = node(node(receiving.$_content[0]).$_content[0]).$_content;
    const first = node(children[0]), second = node(children[1]);
    assert.notEqual(first, second); assert.notEqual(first.$_attrs?.style, second.$_attrs?.style);
    assert.notEqual(first.$_content, second.$_content); assert.notEqual(node(first.$_content[0]), node(second.$_content[0]));
    const one = acquire_document_identity(result.document, target(0, 0, 0));
    const two = acquire_document_identity(result.document, target(0, 0, 1));
    assert.ok(one.snap()?.$_meta?.quid); assert.ok(two.snap()?.$_meta?.quid);
    assert.notEqual(one.snap()?.$_meta?.quid, two.snap()?.$_meta?.quid);
    assert.notEqual(one.snap()?.$_meta?.quid, source.quid); assert.notEqual(two.snap()?.$_meta?.quid, source.quid);
    result.document.attrs.set(target(0, 0, 0), "title", "First");
    assert.equal(result.document.attrs.get(target(0, 0, 1), "title"), undefined);
    assert.equal(doc(map, "parts").document.attrs.get(target(...source.path), "title"), undefined);
    result.at([]).asElement()!.move(0, 1);
    assert.deepEqual(one.path(), [0, 0, 1]);
    result.document.content.remove(target(0, 0), 1);
    assert.equal(one.active, false); assert.equal(two.active, true);
    assert.deepEqual(lookup(doc(map, "parts"), "button"), source);
  });
  check("restored QUAD sources and receiving Libraries retain ordinary admission editing replay and capture", () => {
    const original = authored({ layout: { document: '<main <hson-template lib="parts" quad="button"/>/>' }, parts: { document: '<section <button @:button/>/> ' } });
    const map = install_libraries_snapshot(original.capture()).map;
    assert.notEqual(lookup(doc(map, "parts"), "button")?.quid, lookup(doc(original, "parts"), "button")?.quid);
    const replica = install_libraries_snapshot(map.capture()).map, commits: LiveMapCommit[] = [];
    map.commits.observe(commit => { if (commit.rev === 1) assert.equal(map.lib("result").mode, "document"); commits.push(commit); });
    const result = compose_livemap_document_internal(map, "layout", "result");
    assert.equal(result, map.lib("result")); assert.equal(commits.length, 1);
    assert.equal(Reflect.get(commits[0]!.operations[0]!.operation, "kind"), "library-add");
    replica.replay(commits[0]!); assert.deepEqual(replica.capture(), map.capture());
    const edit = result.document.attrs.set(target(0, 0, 0), "title", "Edited");
    assert.deepEqual(edit.operations.map(entry => entry.library), ["result"]); assert.equal(map.rev, 2);
    acquire_document_identity(result.document, target(0, 0, 0));
    const restored = install_libraries_snapshot(map.capture()).map;
    assert.deepEqual(restored.capture(), map.capture()); assert.deepEqual(doc(restored, "result").root(), result.root());
    assert.equal(lookup(doc(restored, "result"), "button"), undefined);
    doc(restored, "result").document.attrs.set(target(0, 0, 0), "title", "Next"); assert.equal(restored.rev, 3);
    assert.equal(Reflect.get(map, "template"), undefined);
  });
  check("QUAD controls reject malformed missing and typed values without lookup fallback", () => {
    for (const quad of ["", "2start", "a-b", "a.b", "a:b", "é", "a\n", "A".repeat(129)]) {
      const map = authored({ layout: { document: `<hson-template lib="parts" quad=${JSON.stringify(quad)}/>` }, parts: { document: '<button @:button/>' } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "result"), /valid nonempty QUAD/);
    }
    for (const document of ['<hson-template quad="button"/>', '<hson-template lib="" quad="button"/>', '<hson-template lib="parts" quad="button" "text"/>', '<hson-template lib="parts" quad="button" <b/>/>']) {
      const map = authored({ layout: { document }, parts: { document: '<button @:button/>' } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "result"), /requires.*lib|requires.*logical string/);
    }
    for (const value of [true, false, null, 4]) for (const control of ["lib", "quad"]) {
      const attrs = control === "lib" ? { lib: value } : { lib: "parts", quad: value };
      const map = hsonLiveMap.fromLibraries({ layout: { document: { $_tag: ROOT_TAG, $_content: [{ $_tag: "hson-template", $_attrs: attrs, $_content: [] }] } }, parts: { document: '<button/>' } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "result"), /nonempty lib|valid nonempty QUAD/);
    }
    for (const lib of ["parts", "missing", "data"]) {
      const map = authored({ layout: { document: `<hson-template lib="${lib}" quad="button"/>` }, parts: { document: '<button id="button"/>' }, data: { data: { button: "not a subject" } } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "result"), /QUAD|Unknown.*Library|not a document/);
    }
    const caseSensitive = authored({ layout: { document: '<hson-template lib="parts" quad="Button"/>' }, parts: { document: '<button @:button/>' } });
    atomic(caseSensitive, () => compose_livemap_document_internal(caseSensitive, "layout", "result"), /Unknown or retired.*QUAD/);
  });
  check("normalized control flags values lexical limits and duplicate rejection retain Hson semantics", () => {
    for (const controls of ['lib quad', 'lib="lib" quad="quad"', 'lib=lib quad=quad']) {
      const map = authored({ layout: { document: `<hson-template ${controls}/>` }, lib: { document: '<button @:quad/>' } });
      assert.deepEqual(tokens(compose_livemap_document_internal(map, "layout", "result").root()), ["button"]);
    }
    for (const name of ["$", "_", "__proto__", "constructor", "A".repeat(128)]) {
      const map = authored({ layout: { document: `<hson-template lib="parts" quad="${name}"/>` }, parts: { document: `<button @:${name}/>` } });
      assert.deepEqual(tokens(compose_livemap_document_internal(map, "layout", "result").root()), ["button"]);
    }
    for (const controls of ['lib="parts" lib="parts"', 'lib lib="parts"', 'lib="parts" quad="a" quad="b"', 'lib="parts" quad quad="quad"']) {
      assert.throws(() => authored({ layout: { document: `<hson-template ${controls}/>` } }), /duplicate Hson attribute/);
    }
    assert.deepEqual(tokens(Hson.document.toNode(Hson.document`<hson-template lib="parts" quad="button"/>`)), ["hson-template"]);
    assert.throws(() => Hson.document`<button @:button/>`);
  });
  check("selected Schema and authority failures admit no partial result", () => {
    const map = authored({ layout: { document: '<main <hson-template lib="parts" quad="button"/>/>' }, parts: { document: '<button @:button/>' } });
    const schema = Hson.schema`<type "document" tag "main" content "empty">`;
    atomic(map, () => compose_livemap_document_internal(map, "layout", "result", { schema }), /schema/i);
    atomic(map, () => map.batch(() => compose_livemap_document_internal(map, "layout", "result")), /batch/i);
    const aggregate = internal_livemap_aggregate_authority(map), manager = {};
    aggregate.claimManagement(manager);
    try { atomic(map, () => compose_livemap_document_internal(map, "layout", "result"), /controlled|authority/i); }
    finally { aggregate.releaseManagement(manager); }
  });
  check("selected managed CSS fails closed while selected authored style and inline styles remain structural", () => {
    const inputs = { layout: { document: '<main <hson-template lib="parts" quad="button"/>/>' },
      parts: { document: '<aside/> <button @:button <style "a{color:red}"/> <a style="color:blue" "Go"/>/>' }, unrelated: { document: '<aside/>' } };
    for (const name of ["layout", "parts"]) for (const css of ['aside{color:red}', '@layer empty{}', '@keyframes spin{from{opacity:0}to{opacity:1}}', '@property --tone{syntax:"<color>";inherits:true;initial-value:red}']) {
      const map = authored(inputs); doc(map, name).css.stylesheet(css);
      atomic(map, () => compose_livemap_document_internal(map, "layout", "result"), /managed stylesheet.*not supported/);
    }
    const map = authored(inputs); doc(map, "unrelated").css.stylesheet('aside{color:red}');
    const result = compose_livemap_document_internal(map, "layout", "result");
    assert.deepEqual(tokens(result.root()), ["main", "button", "style", "a{color:red}", "a", "Go"]);
    assert.equal(result.css.snapshot(), ""); assert.match(result.render(), /color.*blue/);
    assert.equal(doc(map, "unrelated").css.snapshot(), 'aside{color:red;}');
  });
  check("root customization replaces existing attributes and sole text while omissions preserve defaults", () => {
    for (const entry of [
      { args: '', expected: '<a href="/" title="Default" class="link" "Default label"/>' },
      { args: 'href="/documentation"', expected: '<a href="/documentation" title="Default" class="link" "Default label"/>' },
      { args: '"Read the docs"', expected: '<a href="/" title="Default" class="link" "Read the docs"/>' },
      { args: 'href="/documentation" "Read the docs"', expected: '<a href="/documentation" title="Default" class="link" "Read the docs"/>' },
      { args: 'href="/docs" title="Docs" class="primary" "Read"', expected: '<a href="/docs" title="Docs" class="primary" "Read"/>' },
      { args: 'href="" ""', expected: '<a href="" title="Default" class="link" ""/>' },
      { args: '" \t "', expected: '<a href="/" title="Default" class="link" " \t "/>' },
      { args: ' \t\n ', expected: '<a href="/" title="Default" class="link" "Default label"/>' },
    ]) {
      const map = authored({ layout: { document: `<hson-template lib="parts" quad="link" ${entry.args}/>` },
        parts: { document: '<a @:link href="/" title="Default" class="link" "Default label"/>' } });
      const before = map.capture(), address = lookup(doc(map, "parts"), "link");
      const result = compose_livemap_document_internal(map, "layout", "result");
      assert.deepEqual(result.root(), JSON.parse(JSON.stringify(parse_authored_document_library(entry.expected).root)));
      assert.deepEqual(map.capture().libraries.slice(0, 2), before.libraries);
      assert.deepEqual(lookup(doc(map, "parts"), "link"), address);
    }
    for (const args of ['', '""', '"Filled"']) {
      const map = authored({ layout: { document: `<hson-template lib="parts" quad="link" ${args}/>` }, parts: { document: '<a @:link ""/>' } });
      assert.deepEqual(tokens(compose_livemap_document_internal(map, "layout", "result").root()), ["a", args === '"Filled"' ? "Filled" : ""]);
    }
    const absent = authored({ layout: { document: '<hson-template lib="parts" quad="link"/>' }, parts: { document: '<a @:link/>' } });
    assert.deepEqual(tokens(compose_livemap_document_internal(absent, "layout", "result").root()), ["a"]);
    const controls = authored({ layout: { document: '<hson-template lib="parts" quad="link" title="Custom"/>' },
      parts: { document: '<a @:link lib="default-lib" quad="default-quad" title="Default"/>' } });
    const selected = node(compose_livemap_document_internal(controls, "layout", "result").root().$_content[0]);
    assert.deepEqual(selected.$_attrs, { lib: "default-lib", quad: "default-quad", title: "Custom" });
  });
  check("text replacement requires an exact existing immediate sole string and exact caller content", () => {
    for (const content of ['', '"one" "two"', '"before" <b/>', '<b "nested"/>', '<hson-template lib="text"/>']) {
      const map = authored({ layout: { document: '<hson-template lib="parts" quad="link" "Replace"/>' },
        parts: { document: `<a @:link ${content}/>` }, text: { document: '"Nested"' } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "result"), /existing sole immediate logical string/);
    }
    for (const content of ['"one" "two"', '<b/>', '"before" <b/>', '<hson-template lib="text"/>']) {
      const map = authored({ layout: { document: `<hson-template lib="parts" quad="link" ${content}/>` },
        parts: { document: '<a @:link "Default"/>' }, text: { document: '"Nested"' } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "result"), /exactly one immediate logical string/);
    }
    const emptyRequest = authored({ layout: { document: '<hson-template lib="parts" quad="link" ""/>' }, parts: { document: '<a @:link/>' } });
    atomic(emptyRequest, () => compose_livemap_document_internal(emptyRequest, "layout", "result"), /existing sole/);
  });
  check("ordinary string flags retain their admitted representation without boolean coercion", () => {
    for (const entry of [{ args: 'disabled', value: "disabled", flag: true },
      { args: 'disabled="false"', value: "false", flag: false }, { args: 'disabled=""', value: "", flag: false }]) {
      const map = authored({ layout: { document: `<hson-template lib="parts" quad="link" ${entry.args}/>` },
        parts: { document: '<a @:link disabled "Default"/>' } });
      const result = compose_livemap_document_internal(map, "layout", "result");
      assert.equal(result.document.attrs.get(target(0), "disabled"), entry.value);
      assert.equal(result.document.flags.has(target(0), "disabled"), entry.flag);
    }
  });
  check("overrides reject unknown names nonstring values structured style and case guesses atomically", () => {
    for (const attr of ['missing="new"', 'HREF="/new"', 'viewbox="new"', 'style="color:red"']) {
      const map = authored({ layout: { document: `<hson-template lib="parts" quad="link" ${attr}/>` },
        parts: { document: '<svg @:link href="/" viewBox="0 0 10 10" style="color:blue"/>' } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "result"), /existing string-valued|attributes with string values/);
    }
    for (const value of [true, false, null, 4]) {
      const layout = parse_authored_document_library('<hson-template lib="parts" quad="link" href="/new"/>').root;
      node(layout.$_content[0]).$_attrs!.href = value;
      const map = authored({ layout: { document: layout }, parts: { document: '<a @:link href="/"/>' } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "result"), /attributes with string values/);
      const targetMap = authored({ layout: { document: '<hson-template lib="parts" quad="link" href="/new"/>' }, parts: { document: '<a @:link href="/"/>' } });
      doc(targetMap, "parts").document.attrs.set(target(0), "href", value);
      atomic(targetMap, () => compose_livemap_document_internal(targetMap, "layout", "result"), /existing string-valued/);
    }
    const exact = authored({ layout: { document: '<hson-template lib="parts" quad="link" viewBox="0 0 20 20"/>' },
      parts: { document: '<svg @:link viewBox="0 0 10 10"/>' } });
    assert.equal(compose_livemap_document_internal(exact, "layout", "result").document.attrs.get(target(0), "viewBox"), "0 0 20 20");
  });
  check("protected metadata private transit and invalid names remain rejected at ordinary admission", () => {
    const map = authored({ parts: { document: '<a @:link href="/"/>' } });
    for (const name of ["hson:quid", "hson:index", "_hson_meta_attr_71756964", "_hson_attr_transit_68726566", "bad name"]) {
      const root: HsonNode = { $_tag: ROOT_TAG, $_content: [{ $_tag: "hson-template", $_attrs: { lib: "parts", quad: "link", [name]: "new" }, $_content: [] }] };
      atomic(map, () => map.addLibraries({ layout: { document: root } }), /attribute|metadata|reserved/i);
    }
  });
  check("whole Library and selected connector customizations reject while no-argument expansion remains", () => {
    for (const args of ['href="/new"', '"New"', '""']) {
      const whole = authored({ layout: { document: `<hson-template lib="parts" ${args}/>` }, parts: { document: '<a @:link href="/" "Default"/>' } });
      atomic(whole, () => compose_livemap_document_internal(whole, "layout", "result"), /requires explicit QUAD/);
      const selected = authored({ layout: { document: `<hson-template lib="parts" quad="alias" ${args}/>` },
        parts: { document: '<hson-template @:alias lib="leaf" quad="link"/>' }, leaf: { document: '<a @:link href="/" "Default"/>' } });
      atomic(selected, () => compose_livemap_document_internal(selected, "layout", "result"), /nonconnector selected element/);
    }
    const map = authored({ layout: { document: '<hson-template lib="parts"/> <hson-template lib="parts" quad="alias"/>' },
      parts: { document: '<hson-template @:alias lib="leaf" quad="link"/>' }, leaf: { document: '<a @:link href="/" "Default"/>' } });
    assert.deepEqual(tokens(compose_livemap_document_internal(map, "layout", "result").root()), ["a", "Default", "a", "Default"]);
  });
  check("recursive root attributes precede nested expansion without replacing descendants", () => {
    const map = authored({ layout: { document: '<hson-template lib="parts" quad="panel" title="Custom"/>' },
      parts: { document: '<section @:panel title="Default" <hson-template lib="parts" quad="link" href="/nested" "Nested"/>/> <a @:link href="/" "Default"/>' } });
    const result = compose_livemap_document_internal(map, "layout", "result");
    assert.deepEqual(tokens(result.root()), ["section", "a", "Nested"]);
    assert.equal(result.document.attrs.get(target(0), "title"), "Custom");
    assert.equal(result.document.attrs.get(target(0, 0, 0), "href"), "/nested");
    const invalid = authored({ layout: { document: '<hson-template lib="parts" quad="panel" "Custom"/>' },
      parts: { document: '<section @:panel title="Default" <hson-template lib="leaf"/>/>' }, leaf: { document: '"Default"' } });
    atomic(invalid, () => compose_livemap_document_internal(invalid, "layout", "result"), /existing sole/);
    for (const indirect of [false, true]) {
      const cyclic = authored({ layout: { document: '<hson-template lib="a" quad="panel" title="Custom"/>' },
        a: { document: `<section @:panel title="Default" <hson-template lib="${indirect ? "b" : "a"}" quad="panel" title="Again"/>/>` },
        b: { document: '<section @:panel title="Default" <hson-template lib="a" quad="panel"/>/>' } });
      atomic(cyclic, () => compose_livemap_document_internal(cyclic, "layout", "result"), /composition cycle/);
    }
  });
  check("customized repeated occurrences preserve source identity and independent sibling storage", () => {
    const map = authored({ layout: { document: '<main <hson-template lib="parts" quad="link" href="/one" "One"/> <hson-template lib="parts" quad="link" href="/two" "Two"/> <hson-template lib="parts" quad="link"/>/>' },
      parts: { document: '<a @:link href="/" style="color:blue" "Default"/>' } });
    const aggregate = internal_livemap_aggregate_authority(map), sourceId = aggregate.libraries()[1]!;
    const source = aggregate.root(sourceId), overlay = aggregate.documentOverlay(sourceId);
    const epoch = aggregate.identityEpoch(), ledger = epoch.issued();
    const issued = enumerate_livemap_issued_quids(ledger), before = map.capture(), address = lookup(doc(map, "parts"), "link")!;
    const commits: LiveMapCommit[] = [], stop = map.commits.observe(commit => {
      assert.deepEqual(tokens(doc(map, "result").root()), ["main", "a", "One", "a", "Two", "a", "Default"]);
      commits.push(commit);
    });
    const result = compose_livemap_document_internal(map, "layout", "result"); stop();
    assert.equal(commits.length, 1); assert.equal(map.rev, 1);
    assert.equal(Reflect.get(commits[0]!.operations[0]!.operation, "kind"), "library-add");
    assert.equal(aggregate.root(sourceId), source); assert.equal(aggregate.documentOverlay(sourceId), overlay);
    assert.equal(aggregate.identityEpoch(), epoch);
    assert.deepEqual(enumerate_livemap_issued_quids(epoch.issued()), issued);
    assert.deepEqual(map.capture().libraries.slice(0, 2), before.libraries);
    assert.deepEqual(lookup(doc(map, "parts"), "link"), address); assert.equal(lookup(result, "link"), undefined);
    assert.equal(aggregate.documentOverlay(aggregate.libraries()[2]!).size, 0);
    const children = node(node(aggregate.root(aggregate.libraries()[2]!).$_content[0]).$_content[0]).$_content;
    assert.notEqual(node(children[0]).$_attrs, node(children[1]).$_attrs);
    assert.notEqual(node(children[0]).$_attrs?.style, node(children[1]).$_attrs?.style);
    const first = acquire_document_identity(result.document, target(0, 0, 0)), second = acquire_document_identity(result.document, target(0, 0, 1));
    assert.notEqual(first.snap()?.$_meta?.quid, second.snap()?.$_meta?.quid); assert.notEqual(first.snap()?.$_meta?.quid, address.quid);
    result.document.attrs.set(target(0, 0, 0), "href", "/edited");
    result.document.content.replace(target(0, 0, 0, 0), 0, { $_tag: STR_TAG, $_content: ["Edited"] });
    assert.equal(result.document.attrs.get(target(0, 0, 1), "href"), "/two");
    assert.deepEqual(tokens(result.root()), ["main", "a", "Edited", "a", "Two", "a", "Default"]);
    assert.deepEqual(map.capture().libraries.slice(0, 2), before.libraries);
    const later = compose_livemap_document_internal(map, "layout", "later");
    assert.deepEqual(tokens(later.root()), ["main", "a", "One", "a", "Two", "a", "Default"]);
    const restored = install_libraries_snapshot(map.capture()).map;
    assert.deepEqual(restored.capture(), map.capture()); assert.deepEqual(doc(restored, "result").root(), result.root());
    assert.equal(lookup(doc(restored, "result"), "link"), undefined);
    doc(restored, "result").document.attrs.set(target(0, 0, 1), "href", "/restored");
  });
  check("customization follows moved and portably restored source addresses and ordinary creation replay", () => {
    const original = authored({ layout: { document: '<hson-template lib="parts" quad="link" href="/custom" "Custom"/>' },
      parts: { document: '<main <a @:link href="/" "Default"/> <aside/>/>' } });
    doc(original, "parts").at([]).asElement()!.move(0, 1);
    const map = install_libraries_snapshot(original.capture()).map;
    assert.deepEqual(lookup(doc(map, "parts"), "link")?.path, [0, 0, 1]);
    assert.notEqual(lookup(doc(map, "parts"), "link")?.quid, lookup(doc(original, "parts"), "link")?.quid);
    const replica = install_libraries_snapshot(map.capture()).map, commits: LiveMapCommit[] = [];
    const stop = map.commits.observe(commit => commits.push(commit));
    const result = compose_livemap_document_internal(map, "layout", "result"); stop();
    assert.deepEqual(tokens(result.root()), ["a", "Custom"]); assert.equal(result.document.attrs.get(target(0), "href"), "/custom");
    assert.equal(commits.length, 1); replica.replay(commits[0]!); assert.deepEqual(replica.capture(), map.capture());
  });
  check("effective replacement values use ordinary node depth and character budgets", () => {
    const map = authored({ layout: { document: '<hson-template lib="parts" quad="link" href="/" "x"/>' },
      parts: { document: `<a @:link href="${"d".repeat(1000)}" "${"d".repeat(1000)}"/>` } });
    atomic(map, () => compose_livemap_document_internal(map, "layout", "result", { maxNodes: 4 }), /node limit/);
    atomic(map, () => compose_livemap_document_internal(map, "layout", "result", { maxDepth: 4 }), /depth limit/);
    const result = compose_livemap_document_internal(map, "layout", "result", { maxNodes: 5, maxDepth: 5, maxCharacters: 80 });
    assert.deepEqual(tokens(result.root()), ["a", "x"]);
    for (const args of [`"${"x".repeat(1000)}"`, `href="${"x".repeat(1000)}"`]) {
      const large = authored({ layout: { document: `<hson-template lib="parts" quad="link" ${args}/>` }, parts: { document: '<a @:link href="/" "Default"/>' } });
      atomic(large, () => compose_livemap_document_internal(large, "layout", "result", { maxCharacters: 80 }), /character limit/);
    }
    const oversized = authored({ layout: { document: `<hson-template lib="parts" quad="link" "${"x".repeat(4_000_001)}"/>` }, parts: { document: '<a @:link "Default"/>' } });
    atomic(oversized, () => compose_livemap_document_internal(oversized, "layout", "result"), /character limit/);
  });
  check("customized results retain receiving Schema special-tag and final browser realization boundaries", () => {
    const map = authored({ layout: { document: '<hson-template lib="parts" quad="link" href="/docs" "Docs"/>' }, parts: { document: '<a @:link href="/" "Default"/>' } });
    const schema = Hson.schema`<type "document" tag "a" attrs <props <href <exact "/docs">>> content "string">`;
    const bad = Hson.schema`<type "document" tag "a" attrs <props <href <exact "/">>> content "string">`;
    atomic(map, () => compose_livemap_document_internal(map, "layout", "invalid", { schema: bad }), /schema/i);
    const result = compose_livemap_document_internal(map, "layout", "result", { schema }); assert.equal(result.schema.get(), schema);
    atomic(map, () => result.document.attrs.set(target(0), "href", "/other"), /schema/i);
    atomic(map, () => map.batch(() => compose_livemap_document_internal(map, "layout", "batched")), /batch/i);
    const aggregate = internal_livemap_aggregate_authority(map), manager = {};
    aggregate.claimManagement(manager);
    try { atomic(map, () => compose_livemap_document_internal(map, "layout", "managed"), /controlled|authority/i); }
    finally { aggregate.releaseManagement(manager); }
    const managedCss = authored({ layout: { document: '<hson-template lib="parts" quad="link" href="/docs" "Docs"/>' }, parts: { document: '<a @:link href="/" "Default"/>' } });
    doc(managedCss, "parts").css.stylesheet('a{color:red}');
    atomic(managedCss, () => compose_livemap_document_internal(managedCss, "layout", "result"), /managed stylesheet.*not supported/);
    for (const replacement of ['""', '"b{color:blue}"', '"a{} </style> body{}"']) {
      const style = authored({ layout: { document: `<hson-template lib="parts" quad="sheet" ${replacement}/>` }, parts: { document: '<style @:sheet "a{color:red}"/>' } });
      if (replacement === '""') atomic(style, () => compose_livemap_document_internal(style, "layout", "result"), /Document <style>/);
      else {
        const sheet = compose_livemap_document_internal(style, "layout", "result");
        if (replacement.includes("</style>")) assert.throws(() => sheet.render(), /browser|style|close/i);
        else assert.match(sheet.render(), /b\{color:blue\}/);
      }
    }
    const script = authored({ layout: { document: '<hson-template lib="parts" quad="script" src="/next.js"/>' }, parts: { document: '<script @:script src="/app.js"/>' } });
    assert.match(compose_livemap_document_internal(script, "layout", "result").render(), /next.js/);
  });
  check("a late invalid customization publishes no earlier successful occurrence", () => {
    for (const args of ['unknown="bad"', '"one" "two"']) {
      const map = authored({ layout: { document: `<main <hson-template lib="parts" quad="link" href="/good" "Good"/> <hson-template lib="parts" quad="link" ${args}/>/>` },
        parts: { document: '<a @:link href="/" "Default"/>' } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "result"), /string/);
      assert.throws(() => map.lib("result"));
    }
  });
  check("trusted HTML and Hson customization agree on equivalent admitted values and retain parser differences", () => {
    const compose = (document: string | HsonNode) => {
      const map = authored({ layout: { document }, parts: { document: '<a @:link href="/" title="Default" "Default"/>' } });
      return compose_livemap_document_internal(map, "layout", "result");
    };
    const hson = compose('<hson-template lib="parts" quad="link" href="/docs" title="Docs" "Read"/>');
    const html = compose(hsonTransform.fromTrustedHtml('<hson-template lib="parts" quad="link" href="/docs" title="Docs">Read</hson-template>').toNode());
    assert.deepEqual(html.root(), hson.root()); assert.equal(html.render(), hson.render());
    for (const body of ['', ' \t\n ']) {
      const ordinary = compose(hsonTransform.fromTrustedHtml(`<hson-template lib="parts" quad="link">${body}</hson-template>`).toNode());
      assert.deepEqual(tokens(ordinary.root()), ["a", "Default"]);
    }
    for (const value of ["", " \t "]) {
      const source = `<hson-template lib="parts" quad="link" ${JSON.stringify(value)}/>`;
      const transport = hsonTransform.fromHson(source).toHtml().serialize();
      assert.deepEqual(compose(hsonTransform.fromTrustedHtml(transport).toNode()).root(), compose(source).root());
    }
    assert.equal(compose('<hson-template lib="parts" quad="link" title=""/>').document.attrs.get(target(0), "title"), "");
    assert.equal(compose(hsonTransform.fromTrustedHtml('<hson-template lib="parts" quad="link" title=""/>').toNode()).document.attrs.get(target(0), "title"), "title");
    assert.equal(compose(hsonTransform.fromTrustedHtml('<hson-template lib="parts" quad="link" TITLE="New"/>').toNode()).document.attrs.get(target(0), "title"), "New");
    assert.throws(() => compose('<hson-template lib="parts" quad="link" TITLE="New"/>'), /existing string-valued/);
    assert.equal(compose('<hson-template lib="parts" quad="link" title="  spaced   value  "/>').document.attrs.get(target(0), "title"), "  spaced   value  ");
    assert.equal(compose(hsonTransform.fromTrustedHtml('<hson-template lib="parts" quad="link" title="  spaced   value  "/>').toNode()).document.attrs.get(target(0), "title"), "spaced value");
    assert.equal(compose(hsonTransform.fromTrustedHtml('<hson-template lib="parts" quad="link" href="/first" href="/last"/>').toNode()).document.attrs.get(target(0), "href"), "/last");
    assert.throws(() => compose('<hson-template lib="parts" quad="link" href="/first" href="/last"/>'), /duplicate Hson attribute/);
    const svg = authored({ layout: { document: hsonTransform.fromTrustedHtml('<hson-template lib="parts" quad="image" viewBox="0 0 20 20"/>').toNode() }, parts: { document: '<svg @:image viewBox="0 0 10 10"/>' } });
    atomic(svg, () => compose_livemap_document_internal(svg, "layout", "result"), /existing string-valued/);
    const svgScoped = authored({ layout: { document: hsonTransform.fromTrustedHtml('<svg><hson-template lib="parts" quad="image" viewBox="0 0 20 20"></hson-template></svg>').toNode() }, parts: { document: '<svg @:image viewBox="0 0 10 10"/>' } });
    assert.equal(compose_livemap_document_internal(svgScoped, "layout", "result").document.attrs.get(target(0, 0, 0), "viewBox"), "0 0 20 20");
  });
  check("ordinary HTML source admission and existing exact text transport govern sole-string eligibility", () => {
    for (const body of ['Default', '', ' \t\n ']) {
      const original = authored({ layout: { document: '<hson-template lib="parts" quad="link" href="/docs" "Read"/>' },
        parts: { document: '<a @:link href="/" "Default"/>' } });
      const htmlSource = hsonLiveMap.fromLibraries({ parts: { document: hsonTransform.fromTrustedHtml(`<a href="/">${body}</a>`).toNode() } });
      const snapshot = original.capture(), htmlRoot = htmlSource.capture().libraries[0]!.root;
      // Restore the existing portable declaration against ordinarily admitted source values.
      const map = install_libraries_snapshot({ ...snapshot, libraries: snapshot.libraries.map(entry => entry.name === "parts" ? { ...entry, root: htmlRoot } : entry) }).map;
      if (body === 'Default') {
        assert.deepEqual(compose_livemap_document_internal(map, "layout", "result").root(), compose_livemap_document_internal(original, "layout", "result").root());
      } else atomic(map, () => compose_livemap_document_internal(map, "layout", "result"), /existing sole/);
    }
    for (const value of ["", " \t "]) {
      const original = authored({ layout: { document: '<hson-template lib="parts" quad="link" "Read"/>' }, parts: { document: `<a @:link ${JSON.stringify(value)}/>` } });
      const transport = hsonTransform.fromHson(`<a ${JSON.stringify(value)}/>`).toHtml().serialize();
      const source = hsonLiveMap.fromLibraries({ parts: { document: hsonTransform.fromTrustedHtml(transport).toNode() } });
      const snapshot = original.capture(), htmlRoot = source.capture().libraries[0]!.root;
      const map = install_libraries_snapshot({ ...snapshot, libraries: snapshot.libraries.map(entry => entry.name === "parts" ? { ...entry, root: htmlRoot } : entry) }).map;
      assert.deepEqual(compose_livemap_document_internal(map, "layout", "result").root(), compose_livemap_document_internal(original, "layout", "result").root());
    }
  });
  check("call-time root configuration matches Cut 5 and distinguishes absent and empty text", () => {
    const map = authored({ plain: { document: '<a href="/" title="Default" "Default"/>' },
      layout: { document: '<hson-template lib="parts" quad="link" href="/docs" "Read"/>' },
      parts: { document: '<a @:link href="/" title="Default" "Default"/>' } });
    const configured = compose_livemap_document_internal(map, "plain", "configured", { configuration: { attrs: { href: "/docs" }, text: "Read" } });
    assert.deepEqual(configured.root(), compose_livemap_document_internal(map, "layout", "authored").root());
    assert.deepEqual(tokens(compose_livemap_document_internal(map, "plain", "absent", { configuration: {} }).root()), ["a", "Default"]);
    assert.deepEqual(tokens(compose_livemap_document_internal(map, "plain", "empty", { configuration: { text: "" } }).root()), ["a", ""]);
    assert.equal(configured.document.attrs.get(target(0), "title"), "Default");
  });
  const recursiveFixture = () => authored({
    layout: { document: '<main title="Page" <hson-template @:first lib="cards" quad="card"/> <hson-template @:second lib="cards" quad="card"/>/>' },
    cards: { document: '<section @:card title="Card" <h2 @:heading "Heading"/> <hson-template @:action lib="buttons" quad="primary" title="Authored" "Authored text"/>/> <aside @:outside "Outside"/>' },
    buttons: { document: '<button @:primary title="Primary" style="color:blue" "Default"/> <a @:secondary title="Secondary" href="/" "Link"/>' },
    other: { document: '<em @:secondary title="Other" "Other text"/>' },
  });
  check("native HsonData and JS configurations preserve roots receiving associations and absent or empty text", () => {
    for (const replacement of [{}, { text: "" }]) {
      const map = recursiveFixture(), sources = map.capture();
      const configuration = { as: "pageRoot", attrs: { title: "Configured page" }, at: {
        first: { as: "card", at: { heading: { as: "heading", text: "Heading" },
          action: { as: "action", use: { quad: "secondary" }, ...replacement } } },
      } };
      const before = structuredClone(configuration), native = Hson.data.from(configuration), nativeBefore = native;
      const js = compose_livemap_document_internal(map, "layout", "js", { configuration });
      const data = compose_livemap_document_internal(map, "layout", "data", { configuration: native });
      assert.deepEqual(js.root(), data.root());
      assert.deepEqual(map.capture().libraries.at(-2)!.quads, map.capture().libraries.at(-1)!.quads);
      assert.deepEqual(map.capture().libraries.at(-1)!.quads?.map(entry => entry.name), ["action", "card", "heading", "pageRoot"]);
      assert.equal(data.document.attrs.get(target(0), "title"), "Configured page");
      assert.ok(tokens(data.root()).includes("text" in replacement ? "" : "Authored text"));
      assert.deepEqual(configuration, before); assert.equal(native, nativeBefore);
      assert.deepEqual(map.capture().libraries.slice(0, sources.libraries.length), sources.libraries);
    }
  });
  check("invalid native HsonData and document markup fail data-only ingress atomically", () => {
    const map = recursiveFixture();
    for (const configuration of ["", "<", '<as "received"', '<as "one" as "two">',
      '<main/>', '<main title="Page"/>', '<as title="Invalid" "received"/>',
      '<main <button/>/>', '<button @000009001/>', '<button @:received/>']) {
      atomic(map, () => Reflect.apply(compose_livemap_document_internal, undefined,
        [map, "layout", "bad", { configuration }]), /data-mode Hson/);
      assert.throws(() => map.lib("bad"));
    }
  });
  check("valid HsonData nonrecord roots fail existing configuration record validation atomically", () => {
    const map = recursiveFixture();
    for (const value of [null, true, 42, "", "text", [], [{ as: "received" }]]) {
      const configuration = Hson.data.from(value), before = configuration;
      atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration }), /plain data records/);
      assert.equal(configuration, before);
    }
  });
  check("native HsonData and JS configurations share normalization and late validation failures", () => {
    const map = recursiveFixture();
    const cases: readonly (readonly [Readonly<Record<string, unknown>>, RegExp])[] = [
      [{ as: 3 }, /explicit authored QUAD string/], [{ text: null }, /text requires a string/],
      [{ attrs: { title: false } }, /public string values/], [{ unknown: {} }, /Unknown composition configuration field/],
      [{ at: { "first.path": {} } }, /authored QUAD names/],
      [{ at: { first: { use: { quad: "" } } } }, /use requires a QUAD/],
      [{ at: { first: { as: "same" }, second: { as: "same" } } }, /portable QUAD/],
      [{ at: { first: { as: "outer", at: { card: { as: "inner" } } } } }, /portable QUAD/],
      [{ at: { first: { as: "first" }, second: { at: { action: { attrs: { missing: "Late" } } } } } }, /existing string-valued/],
    ];
    for (const [configuration, pattern] of cases) {
      const before = structuredClone(configuration), native = Hson.data.from(configuration);
      for (const input of [configuration, native]) {
        atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration: input }), pattern);
      }
      assert.deepEqual(configuration, before);
    }
  });
  check("receiving Library restores alone without any source Libraries or original configuration", () => {
    const map = recursiveFixture();
    const page = compose_livemap_document_internal(map, "layout", "page", { configuration: Hson.data.from({
      as: "pageRoot", attrs: { title: "Final" }, at: { first: { as: "card", at: { action: { as: "button", text: "Final" } } } },
    }) });
    const capture = map.cut({ documents: ["page"], data: [] }).libs;
    assert.deepEqual(capture.libraries.map(entry => entry.name), ["page"]);
    const restored = install_libraries_snapshot(capture).map, final = doc(restored, "page");
    assert.deepEqual(final.root(), page.root());
    assert.deepEqual(restored.capture().libraries[0]!.quads, capture.libraries[0]!.quads);
    for (const source of ["layout", "cards", "buttons", "other"]) assert.throws(() => restored.lib(source));
    for (const name of ["pageRoot", "card", "button"]) {
      assert.deepEqual(lookup(final, name)?.path, lookup(page, name)?.path);
      assert.notEqual(lookup(final, name)?.quid, lookup(page, name)?.quid);
      assert.ok(final.document.byQuid(lookup(final, name)!.quid));
    }
    final.document.attrs.set(target(...lookup(final, "button")!.path), "title", "Independent");
    assert.equal(page.document.attrs.get(target(...lookup(page, "button")!.path), "title"), "Authored");
  });
  check("successful inner receiving composition survives outer failure during reentrant allocation", () => {
    const map = recursiveFixture(), aggregate = internal_livemap_aggregate_authority(map);
    const ids = aggregate.libraries(), roots = ids.map(id => aggregate.root(id));
    const issued = enumerate_livemap_issued_quids(aggregate.identityEpoch().issued());
    let inner: LiveMapDocumentLibrary | undefined, after: ReturnType<LiveMap["capture"]> | undefined;
    let attempted = false;
    const commits: LiveMapCommit[] = [], stop = map.commits.observe(commit => commits.push(commit));
    set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, () => {
      if (!attempted) {
        attempted = true;
        inner = compose_livemap_document_internal(map, "layout", "inner", { configuration: Hson.data.from({ as: "innerRoot" }) });
        after = map.capture();
      }
      return mint_hson_node_quid();
    });
    try {
      assert.throws(() => compose_livemap_document_internal(map, "layout", "outer", {
        configuration: Hson.data.from({ as: "outerRoot" }),
      }), /Library binding is unavailable/);
    } finally { set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, undefined); stop(); }
    assert.ok(attempted); assert.ok(inner); assert.ok(after);
    assert.equal(map.lib("inner"), inner); assert.throws(() => map.lib("outer"));
    assert.deepEqual(map.capture(), after); assert.equal(map.rev, 1); assert.equal(commits.length, 1);
    assert.equal(commits[0]!.operations[0]!.library, "inner");
    const address = lookup(inner, "innerRoot")!;
    assert.equal(lookup(inner, "outerRoot"), undefined);
    assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), [...issued, address.quid].sort());
    ids.forEach((id, index) => assert.equal(aggregate.root(id), roots[index]));
    assert.deepEqual(map.capture().libraries.slice(0, ids.length), after.libraries.slice(0, ids.length));
  });
  check("one explicit receiving QUAD uses ordinary sparse admission and is available before publication", () => {
    const map = recursiveFixture(), aggregate = internal_livemap_aggregate_authority(map);
    const source = lookup(doc(map, "buttons"), "primary")!;
    const issued = aggregate.identityEpoch().issued().size, commits: LiveMapCommit[] = [];
    const stop = map.commits.observe(commit => {
      const page = doc(map, "page"), address = lookup(page, "previousButton")!;
      assert.deepEqual(address.path, [0, 0, 0, 0, 1]);
      assert.equal(page.document.byQuid(address.quid)?.$_tag, "button");
      assert.ok(aggregate.identityEpoch().issued().has(address.quid));
      commits.push(commit);
    });
    const page = compose_livemap_document_internal(map, "layout", "page", { configuration: {
      at: { first: { at: { action: { as: "previousButton", text: "Previous" } } } },
    } }); stop();
    const address = lookup(page, "previousButton")!;
    assert.notEqual(address.quid, source.quid);
    assert.equal(aggregate.documentOverlay(aggregate.libraries().at(-1)!).size, 1);
    assert.equal(aggregate.identityEpoch().issued().size, issued + 1);
    assert.equal(commits.length, 1); assert.equal(commits[0]!.operations.length, 1);
    assert.equal(Reflect.get(commits[0]!.operations[0]!.operation, "kind"), "library-add");
    assert.equal(map.rev, 1);
    assert.equal(lookup(page, "primary"), undefined); assert.equal(lookup(page, "action"), undefined);
    assert.equal(JSON.stringify(page.root()).includes("quid"), false);
    assert.equal(Reflect.get(page, "quad"), undefined); assert.equal(Reflect.get(page.document, "byQuad"), undefined);
  });
  check("named repeated source QUADs and anonymous copies preserve all source identity and graph storage", () => {
    const map = recursiveFixture(), aggregate = internal_livemap_aggregate_authority(map);
    const ids = aggregate.libraries(), roots = ids.map(id => aggregate.root(id)), overlays = ids.map(id => aggregate.documentOverlay(id));
    const before = map.capture(), issued = enumerate_livemap_issued_quids(aggregate.identityEpoch().issued());
    const configuration = { at: {
      first: { as: "previousCard", at: { action: { as: "previousButton", text: "Previous" } } },
      second: { as: "nextCard", at: { action: { as: "nextButton", text: "Next" } } },
    } };
    const page = compose_livemap_document_internal(map, "layout", "page", { configuration });
    const names = ["previousCard", "previousButton", "nextCard", "nextButton"];
    const quids = names.map(name => lookup(page, name)!.quid);
    assert.equal(new Set(quids).size, 4); quids.forEach(quid => assert.ok(!issued.includes(quid)));
    assert.deepEqual(lookup(page, "nextButton")?.path, [0, 0, 1, 0, 1]);
    ids.forEach((id, index) => { assert.equal(aggregate.root(id), roots[index]); assert.equal(aggregate.documentOverlay(id), overlays[index]); });
    assert.deepEqual(map.capture().libraries.slice(0, ids.length), before.libraries);
    assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), [...issued, ...quids].sort());
    const anonymous = compose_livemap_document_internal(map, "layout", "anonymous");
    assert.equal(map.capture().libraries.at(-1)!.quads, undefined);
    assert.equal(aggregate.documentOverlay(aggregate.libraries().at(-1)!).size, 0);
    assert.equal(lookup(anonymous, "first"), undefined);
    const derived = compose_livemap_document_internal(map, "page", "derived");
    assert.deepEqual(derived.root(), page.root()); assert.equal(lookup(derived, "previousButton"), undefined);
    configuration.at.first.at.action.text = "Later";
    configuration.at.first.at.action.as = "laterName";
    doc(map, "buttons").document.attrs.set(target(0), "title", "Changed source");
    assert.equal(page.document.attrs.get(target(0, 0, 0, 0, 1), "title"), "Authored");
    assert.ok(tokens(page.root()).includes("Previous")); assert.ok(lookup(page, "previousButton"));
    assert.equal(lookup(page, "laterName"), undefined);
  });
  check("independently prepared receiving configurations equal complete page configuration", () => {
    const map = recursiveFixture();
    const action = { as: "previousButton", attrs: { title: "Previous" }, text: "Previous" };
    const first = { as: "previousCard", at: { heading: { as: "heading", text: "Prepared" }, action } };
    const configuration = { as: "pageRoot", at: { first } };
    const prepared = JSON.stringify(configuration);
    const page = compose_livemap_document_internal(map, "layout", "page", { configuration });
    const equivalent = compose_livemap_document_internal(map, "layout", "equivalent", { configuration: JSON.parse(prepared) });
    assert.deepEqual(page.root(), equivalent.root());
    assert.deepEqual(map.capture().libraries.at(-2)!.quads, map.capture().libraries.at(-1)!.quads);
    for (const name of ["pageRoot", "previousCard", "heading", "previousButton"]) {
      assert.notEqual(lookup(page, name)!.quid, lookup(equivalent, name)!.quid);
    }
    assert.equal(JSON.stringify(configuration), prepared); assert.equal(map.rev, 2);
  });
  check("receiving paths follow expanded output offsets and configured use rather than source coordinates", () => {
    const map = authored({
      layout: { document: '<main <hson-template lib="empty"/> <hson-template lib="many"/> <hson-template @:slot lib="parts" quad="alias"/> <footer @:tail/>/>' },
      empty: { document: empty() }, many: { document: '<i/> <b/>' },
      parts: { document: '<hson-template @:alias lib="parts" quad="button"/> <button @:button/> <article @:alternative <span @:label "Default"/>/>' },
    });
    const expanded = compose_livemap_document_internal(map, "layout", "expanded", { configuration: {
      as: "root", at: { slot: { as: "button" }, tail: { as: "tail" } },
    } });
    assert.deepEqual(lookup(expanded, "button")?.path, [0, 0, 2]);
    assert.deepEqual(lookup(expanded, "tail")?.path, [0, 0, 3]);
    assert.equal(expanded.document.byQuid(lookup(expanded, "button")!.quid)?.$_tag, "button");
    const selected = compose_livemap_document_internal(map, "layout", "selected", { configuration: {
      at: { slot: { as: "chosen", use: { quad: "alternative" }, at: { label: { as: "caption", text: "Chosen" } } } },
    } });
    assert.deepEqual(lookup(selected, "chosen")?.path, [0, 0, 2]);
    assert.deepEqual(lookup(selected, "caption")?.path, [0, 0, 2, 0, 0]);
    assert.equal(selected.document.byQuid(lookup(selected, "chosen")!.quid)?.$_tag, "article");
    const cross = recursiveFixture();
    const other = compose_livemap_document_internal(cross, "layout", "otherResult", { configuration: {
      at: { first: { at: { action: { as: "chosen", use: { lib: "other", quad: "secondary" } } } } },
    } });
    assert.equal(other.document.byQuid(lookup(other, "chosen")!.quid)?.$_tag, "em");
  });
  check("duplicate receiving names and alias routes to one resulting subject reject atomically", () => {
    const map = recursiveFixture();
    for (const configuration of [
      { at: { first: { as: "duplicate" }, second: { as: "duplicate" } } },
      { at: { first: { as: "outer", at: { card: { as: "inner" } } } } },
      { at: { first: { as: "same", at: { card: { as: "same" } } } } },
    ]) atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration }), /portable QUAD/);
    const alias = authored({ layout: { document: '<hson-template @:slot lib="parts" quad="alias"/>' },
      parts: { document: '<hson-template @:alias lib="parts" quad="button"/> <button @:button/>' } });
    for (const configuration of [
      { as: "root", at: { slot: { as: "slot" } } },
      { at: { slot: { as: "outer", at: { alias: { as: "inner" } } } } },
      { at: { slot: { as: "outer", at: { alias: { at: { button: { as: "inner" } } } } } } },
    ]) atomic(alias, () => compose_livemap_document_internal(alias, "layout", "bad", { configuration }), /portable QUAD/);
  });
  check("receiving cardinality is checked after complete recursive expansion", () => {
    for (const document of [empty(), '"Text"', '<a/> <b/>', '"Text" <a/>']) {
      const map = authored({ layout: { document: '<main <hson-template @:slot lib="aliases" quad="alias"/>/>' },
        aliases: { document: '<hson-template @:alias lib="parts"/>' }, parts: { document } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration: { at: { slot: { as: "received" } } } }), /exactly one ordinary resulting/);
      atomic(map, () => compose_livemap_document_internal(map, "parts", "bad", { configuration: { as: "received" } }), /exactly one ordinary resulting/);
    }
    const map = authored({ layout: { document: '<main <hson-template @:slot lib="aliases" quad="alias"/>/>' },
      aliases: { document: '<hson-template @:alias lib="parts"/>' }, parts: { document: '<button/>' } });
    const result = compose_livemap_document_internal(map, "layout", "result", { configuration: { at: { slot: { as: "received" } } } });
    assert.deepEqual(lookup(result, "received")?.path, [0, 0, 0]);
    const top = compose_livemap_document_internal(map, "aliases", "top", { configuration: { as: "received" } });
    assert.deepEqual(lookup(top, "received")?.path, [0]);
  });
  check("receiving names require explicit own string data and existing QUAD spelling rules", () => {
    const map = recursiveFixture();
    for (const as of [undefined, null, true, 1, {}, [], new String("name"), "", "2start", "a-b", "a.b", "a:b", "é", "a\n", "A".repeat(129)]) {
      atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration: { at: { first: { as } } } }), /explicit authored QUAD string/);
    }
    let reads = 0;
    const accessor = Object.defineProperty({}, "as", { enumerable: true, get() { reads++; return "name"; } });
    atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration: accessor }), /own enumerable data/);
    assert.equal(reads, 0);
    for (const as of ["$", "_", "__proto__", "constructor", "toString", "A".repeat(128)]) {
      const result = compose_livemap_document_internal(map, "layout", `valid${map.rev}`, { configuration: { as } });
      assert.deepEqual(lookup(result, as)?.path, [0]);
    }
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "as");
    try {
      Object.defineProperty(Object.prototype, "as", { configurable: true, get() { reads++; return "inherited"; } });
      const anonymous = compose_livemap_document_internal(map, "layout", "anonymous", { configuration: {} });
      assert.equal(lookup(anonymous, "inherited"), undefined); assert.equal(reads, 0);
    } finally {
      if (descriptor) Object.defineProperty(Object.prototype, "as", descriptor); else Reflect.deleteProperty(Object.prototype, "as");
    }
  });
  check("late invalid receiving configuration and Schema failure publish no candidate or identity", () => {
    const map = recursiveFixture();
    atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration: { at: {
      first: { as: "first", at: { action: { as: "firstButton" } } },
      second: { at: { action: { as: "secondButton", attrs: { missing: "Late" } } } },
    } } }), /existing string-valued/);
    const schema = Hson.schema`<type "document" tag "aside" content "empty">`;
    atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { schema, configuration: { as: "root" } }), /schema/i);
    atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration: { at: {
      first: { at: { action: { as: "duplicate" } } }, second: { at: { action: { as: "duplicate" } } },
    } } }), /portable QUAD/);
  });
  check("receiving identity allocation is staged and collision exhaustion installs nothing", () => {
    const map = recursiveFixture(), aggregate = internal_livemap_aggregate_authority(map);
    const owner = aggregate.identityEpoch().owner, occupied = lookup(doc(map, "buttons"), "primary")!.quid;
    const configuration = { at: { first: { as: "first" }, second: { as: "second" } } };
    for (const candidate of [occupied, mint_hson_node_quid()]) {
      let attempts = 0;
      set_livemap_quid_candidate_source_for_tests(owner, () => { attempts++; return candidate; });
      try {
        atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration }), /No available document QUID/);
        assert.ok(attempts > 1);
        assert.throws(() => map.lib("bad"));
      } finally { set_livemap_quid_candidate_source_for_tests(owner, undefined); }
    }
    const result = compose_livemap_document_internal(map, "layout", "result", { configuration });
    assert.ok(lookup(result, "first")); assert.ok(lookup(result, "second"));
  });
  check("invalid receiving associations fail before the receiving allocator runs", () => {
    const map = recursiveFixture(), aggregate = internal_livemap_aggregate_authority(map);
    let attempts = 0;
    set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, () => { attempts++; return mint_hson_node_quid(); });
    try {
      for (const configuration of [
        { as: undefined },
        { at: { first: { as: "duplicate" }, second: { as: "duplicate" } } },
        { at: { first: { as: "outer", at: { card: { as: "inner" } } } } },
        { at: { first: { as: "first" }, second: { at: { action: { attrs: { missing: "Late" } } } } } },
      ]) atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration }));
      const schema = Hson.schema`<type "document" tag "aside" content "empty">`;
      atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { schema, configuration: { as: "page" } }), /schema/i);
      assert.equal(attempts, 0);
    } finally { set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, undefined); }
  });
  check("complete receiving capture restore and topology replay reconstruct fresh ordinary QUAD identities", () => {
    const map = recursiveFixture(), initial = map.capture(), replica = install_libraries_snapshot(initial).map;
    const commits: LiveMapCommit[] = [], stop = map.commits.observe(commit => commits.push(commit));
    const page = compose_livemap_document_internal(map, "layout", "page", { configuration: { as: "page", at: {
      first: { as: "previousCard", at: { action: { as: "previousButton" } } },
      second: { at: { action: { as: "nextButton" } } },
    } } }); stop();
    const snapshot = map.capture(), names = ["nextButton", "page", "previousButton", "previousCard"];
    assert.deepEqual(snapshot.libraries.at(-1)!.quads?.map(entry => entry.name), names);
    assert.equal(JSON.stringify(snapshot).includes("quid"), false);
    replica.replay(commits[0]!); assert.deepEqual(replica.capture(), snapshot);
    const restored = install_libraries_snapshot(snapshot).map;
    assert.deepEqual(restored.capture(), snapshot); assert.deepEqual(doc(restored, "page").root(), page.root());
    for (const candidate of [doc(replica, "page"), doc(restored, "page")]) for (const name of names) {
      const address = lookup(candidate, name)!, original = lookup(page, name)!;
      assert.deepEqual(address.path, original.path); assert.notEqual(address.quid, original.quid);
      assert.equal(candidate.document.byQuid(original.quid), undefined);
      assert.ok(candidate.document.byQuid(address.quid));
    }
    assert.equal(internal_livemap_aggregate_authority(restored).documentOverlay(internal_livemap_aggregate_authority(restored).libraries().at(-1)!).size, 4);
  });
  check("receiving movement lineage replacement and removal follow ordinary QUAD lifecycle", () => {
    const map = recursiveFixture();
    const page = compose_livemap_document_internal(map, "layout", "page", { configuration: { at: {
      first: { at: { action: { as: "previousButton" } } }, second: { at: { action: { as: "nextButton" } } },
    } } });
    const previous = lookup(page, "previousButton")!, next = lookup(page, "nextButton")!;
    page.document.content.move(target(0, 0), 0, 1);
    assert.deepEqual(lookup(page, "previousButton")?.path, [0, 0, 1, 0, 1]);
    assert.equal(lookup(page, "previousButton")?.quid, previous.quid);
    page.document.content.replace(target(0, 0, 1, 0), 1, { $_tag: "button", $_content: [] },
      [{ source: validate_document_path([]), destination: validate_document_path([]) }]);
    assert.equal(lookup(page, "previousButton")?.quid, previous.quid);
    page.document.content.replace(target(0, 0, 1, 0), 1, { $_tag: "button", $_content: [] });
    assert.equal(lookup(page, "previousButton"), undefined); assert.equal(page.document.byQuid(previous.quid), undefined);
    const stop = map.commits.observe(() => assert.equal(lookup(page, "nextButton"), undefined));
    page.document.content.remove(target(0, 0, 0, 0), 1); stop();
    assert.equal(page.document.byQuid(next.quid), undefined);
    page.document.content.insert(target(0, 0, 0, 0), 1, { $_tag: "button", $_content: [] });
    acquire_document_identity(page.document, target(0, 0, 0, 0, 1));
    assert.equal(lookup(page, "nextButton"), undefined);
    assert.ok(internal_livemap_aggregate_authority(map).identityEpoch().issued().has(next.quid));
    assert.equal(map.capture().libraries.at(-1)!.quads, undefined);
  });
  check("recursive occurrence configuration supports reusable subrecords and one-shot equivalence", () => {
    const map = recursiveFixture();
    const action = { attrs: { title: "Call time" }, text: "Run" };
    const shared = { at: { heading: { text: "Shared heading" }, action } };
    const configuration = { attrs: { title: "Configured page" }, at: { first: shared, second: shared } };
    const before = JSON.stringify(configuration);
    const composed = compose_livemap_document_internal(map, "layout", "composed", { configuration });
    const oneShot = compose_livemap_document_internal(map, "layout", "oneShot", { configuration: JSON.parse(before) });
    assert.deepEqual(composed.root(), oneShot.root());
    assert.equal(JSON.stringify(configuration), before);
    assert.deepEqual(tokens(composed.root()), ["main", "section", "h2", "Shared heading", "button", "Run", "section", "h2", "Shared heading", "button", "Run"]);
    assert.equal(composed.document.attrs.get(target(0), "title"), "Configured page");
    assert.equal(composed.document.attrs.get(target(0, 0, 0, 0, 1), "title"), "Call time");
    action.text = "Later";
    assert.ok(!tokens(composed.root()).includes("Later"));
  });
  check("different configurations of repeated components and nested choices stay occurrence-local", () => {
    const map = recursiveFixture();
    const result = compose_livemap_document_internal(map, "layout", "result", { configuration: { at: {
      first: { attrs: { title: "First" }, at: { heading: { text: "One" }, action: { use: { quad: "secondary" }, text: "" } } },
      second: { at: { action: { use: { lib: "other", quad: "secondary" }, attrs: { title: "Chosen" } } } },
    } } });
    assert.deepEqual(tokens(result.root()), ["main", "section", "h2", "One", "a", "", "section", "h2", "Heading", "em", "Authored text"]);
    assert.equal(result.document.attrs.get(target(0, 0, 0, 0, 1), "title"), "Authored");
    assert.equal(result.document.attrs.get(target(0, 0, 1, 0, 1), "title"), "Chosen");
    assert.equal(result.document.attrs.get(target(0, 0, 1), "title"), "Card");
  });
  check("multi-level ordinary and connector scopes address actual descendants", () => {
    const map = authored({ layout: { document: '<hson-template @:slot lib="outer" quad="panel"/>' },
      outer: { document: '<section @:panel <div @:body title="Body" <hson-template @:slot lib="inner" quad="panel"/>/>/>' },
      inner: { document: '<article @:panel <span @:label "Default"/>/>' } });
    const result = compose_livemap_document_internal(map, "layout", "result", { configuration: { at: {
      slot: { at: { body: { attrs: { title: "Changed" }, at: { slot: { at: { label: { text: "Deep" } } } } } } },
    } } });
    assert.deepEqual(tokens(result.root()), ["section", "div", "article", "span", "Deep"]);
    assert.equal(result.document.attrs.get(target(0, 0, 0), "title"), "Changed");
  });
  check("configured connector chains reach the eventual ordinary root", () => {
    const map = authored({ layout: { document: '<hson-template @:slot lib="parts" quad="alias"/>' },
      parts: { document: '<hson-template @:alias lib="parts" quad="button"/> <button @:button title="Default" "Default"/>' } });
    assert.deepEqual(tokens(compose_livemap_document_internal(map, "layout", "result", { configuration: {
      at: { slot: { attrs: { title: "Changed" }, text: "Final" } },
    } }).root()), ["button", "Final"]);
  });
  check("configuration QUAD scope rejects unknown outside retired inaccessible and ambiguous targets", () => {
    const map = recursiveFixture();
    for (const configuration of [
      { at: { missing: {} } }, { at: { first: { at: { outside: {} } } } },
      { at: { first: { at: { primary: {} } } } },
      { at: { first: { at: { heading: { at: { action: {} } } } } } },
      { at: { first: { at: { card: { at: { heading: {} } }, heading: {} } } } },
      { at: { first: { at: { card: { at: { card: {} } } } } } },
    ]) atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration }), /QUAD|subtree|Ambiguous/);
    // This target exists in source storage, but connector expansion replaces its authored body.
    const hidden = authored({ layout: { document: '<hson-template @:slot lib="parts" quad="button" <i @:hidden/>/>' }, parts: { document: '<button @:button/>' } });
    atomic(hidden, () => compose_livemap_document_internal(hidden, "layout", "bad", { configuration: { at: { hidden: {} } } }));
    doc(map, "cards").document.content.replace(target(0, 0), 0, { $_tag: "h2", $_content: [] });
    atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration: { at: { first: { at: { heading: { text: "Retired" } } } } } }), /Unknown or retired/);
  });
  check("configuration follows moved overlay subjects and exact authored names", () => {
    const map = recursiveFixture();
    doc(map, "cards").document.content.move(target(0, 0), 0, 1);
    assert.deepEqual(lookup(doc(map, "cards"), "heading")?.path, [0, 0, 1]);
    const result = compose_livemap_document_internal(map, "layout", "result", { configuration: { at: { first: { at: { heading: { text: "Moved" } } } } } });
    assert.deepEqual(tokens(result.root()), ["main", "section", "button", "Authored text", "h2", "Moved", "section", "button", "Authored text", "h2", "Heading"]);
    atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration: { at: { First: {} } } }), /Unknown or retired/);
  });
  check("configuration validates attrs and text against the ultimately selected ordinary target", () => {
    const map = recursiveFixture();
    for (const configuration of [
      { attrs: { missing: "new" } }, { attrs: { Title: "wrong case" } }, { text: "mixed" },
      { at: { first: { at: { action: { attrs: { style: "color:red" } } } } } },
      { at: { first: { at: { action: { use: { lib: "other", quad: "secondary" }, attrs: { href: "/new" } } } } } },
    ]) atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration }), /existing string-valued|existing sole/);
    for (const document of ['<div/>', '<div <span "Child"/>/>', '<div "one" <b/> "two"/>', '<a/> <b/>']) {
      const roots = authored({ layout: { document } });
      atomic(roots, () => compose_livemap_document_internal(roots, "layout", "bad", { configuration: { text: "" } }), /sole|one ordinary/);
    }
    const valid = authored({ layout: { document: '<svg viewBox="0 0 1 1"/>' } });
    assert.equal(compose_livemap_document_internal(valid, "layout", "result", { configuration: { attrs: { viewBox: "0 0 2 2" } } }).document.attrs.get(target(0), "viewBox"), "0 0 2 2");
  });
  check("configuration input is exact own JSON data without getters executable values or cycles", () => {
    const map = recursiveFixture();
    let reads = 0;
    const accessor = Object.defineProperty({}, "text", { enumerable: true, get() { reads++; return "Bad"; } });
    const cyclic: { at?: unknown } = {}; cyclic.at = { first: cyclic };
    const malformed: unknown[] = [undefined, null, [], "text", () => ({}), { text: undefined }, { text: null }, { text: 1 },
      { attrs: undefined }, { attrs: [] }, { attrs: { title: false } }, { attrs: { title() {} } }, { attrs: { quid: "fake" } },
      { at: undefined }, { at: { first: undefined } }, { at: { "first.path": {} } }, { unknown: {} },
      Object.create({ text: "Inherited" }), accessor, { attrs: accessor }, { use: accessor }, { at: accessor },
      Object.defineProperty({}, "text", { value: "Hidden" }), { [Symbol("text")]: "Bad" }, cyclic,
      { at: { first: { use: { lib: "buttons" } } } }, { at: { first: { use: { quad: "" } } } },
      { at: { first: { use: { quad: "primary", lib: undefined } } } },
      { at: { first: { use: { lib: "buttons", quad: "primary", other: "conflict" } } } },
    ];
    for (const configuration of malformed) atomic(map, () => Reflect.apply(compose_livemap_document_internal, undefined,
      [map, "layout", "bad", { configuration }]));
    assert.equal(reads, 0);
    const proto = Object.getOwnPropertyDescriptor(Object.prototype, "text");
    try {
      Object.defineProperty(Object.prototype, "text", { configurable: true, get() { reads++; return "Inherited"; } });
      const normalized = document_composition_options({ configuration: {} });
      assert.ok(normalized.configuration);
    } finally { if (proto) Object.defineProperty(Object.prototype, "text", proto); else Reflect.deleteProperty(Object.prototype, "text"); }
    assert.equal(reads, 0);
    const nullRecord = Object.create(null); Object.defineProperty(nullRecord, "text", { value: "Allowed", enumerable: true });
    const simple = authored({ layout: { document: '<p "Default"/>' } });
    assert.deepEqual(tokens(compose_livemap_document_internal(simple, "layout", "result", { configuration: nullRecord }).root()), ["p", "Allowed"]);
  });
  check("structural references reject missing Libraries wrong families unknown QUADs and ordinary replacements", () => {
    const map = recursiveFixture(); map.addLibraries({ data: { data: {} } });
    for (const use of [{ lib: "missing", quad: "primary" }, { lib: "data", quad: "primary" }, { quad: "missing" }]) {
      atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration: { at: { first: { at: { action: { use } } } } } }), /Library|QUAD/);
    }
    for (const configuration of [{ use: { quad: "first" } }, { at: { first: { at: { heading: { use: { quad: "action" } } } } } }]) {
      atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration }), /requires a connector/);
    }
  });
  check("late nested failure publishes no result identity topology or positions", () => {
    const map = recursiveFixture();
    atomic(map, () => compose_livemap_document_internal(map, "layout", "result", { configuration: { at: {
      first: { at: { action: { text: "Valid first occurrence" } } },
      second: { at: { action: { attrs: { missing: "Late failure" } } } },
    } } }), /existing string-valued/);
  });
  check("configured results publish once preserve every source and restore as independent ordinary documents", () => {
    const map = recursiveFixture(), aggregate = internal_livemap_aggregate_authority(map);
    const ids = aggregate.libraries(), roots = ids.map(id => aggregate.root(id)), overlays = ids.map(id => aggregate.documentOverlay(id));
    const before = map.capture(), ledger = enumerate_livemap_issued_quids(aggregate.identityEpoch().issued());
    const addresses = [lookup(doc(map, "layout"), "first"), lookup(doc(map, "cards"), "card"), lookup(doc(map, "buttons"), "primary")];
    const shared = { at: { action: { text: "Same" } } }, configuration = { at: { first: shared, second: shared } };
    const commits: LiveMapCommit[] = [], stop = map.commits.observe(commit => commits.push(commit));
    const result = compose_livemap_document_internal(map, "layout", "result", { configuration }); stop();
    assert.equal(commits.length, 1); assert.equal(commits[0]!.operations.length, 1);
    assert.equal(Reflect.get(commits[0]!.operations[0]!.operation, "kind"), "library-add");
    assert.equal(aggregate.libraries().length, ids.length + 1);
    ids.forEach((id, index) => { assert.equal(aggregate.root(id), roots[index]); assert.equal(aggregate.documentOverlay(id), overlays[index]); });
    assert.deepEqual(map.capture().libraries.slice(0, ids.length), before.libraries);
    assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), ledger);
    assert.deepEqual([lookup(doc(map, "layout"), "first"), lookup(doc(map, "cards"), "card"), lookup(doc(map, "buttons"), "primary")], addresses);
    assert.equal(lookup(result, "first"), undefined); assert.equal(lookup(result, "card"), undefined);
    const first = acquire_document_identity(result.document, target(0, 0, 0, 0, 1));
    const second = acquire_document_identity(result.document, target(0, 0, 1, 0, 1));
    assert.notEqual(first.snap()?.$_meta?.quid, second.snap()?.$_meta?.quid);
    assert.notEqual(first.snap()?.$_meta?.quid, addresses[2]?.quid);
    result.document.attrs.set(target(0, 0, 0, 0, 1), "title", "Edited");
    assert.equal(result.document.attrs.get(target(0, 0, 1, 0, 1), "title"), "Authored");
    assert.deepEqual(map.capture().libraries.slice(0, ids.length), before.libraries);
    const snapshot = map.capture(), restored = install_libraries_snapshot(snapshot).map;
    assert.deepEqual(restored.capture(), snapshot); assert.deepEqual(doc(restored, "result").root(), result.root());
    const fresh = acquire_document_identity(doc(restored, "result").document, target(0, 0, 0, 0, 1));
    assert.notEqual(fresh.snap()?.$_meta?.quid, first.snap()?.$_meta?.quid);
    assert.equal(lookup(doc(restored, "result"), "first"), undefined);
    shared.at.action.text = "Changed configuration";
    doc(map, "buttons").document.attrs.set(target(0), "title", "Changed source");
    assert.equal(result.document.attrs.get(target(0, 0, 1, 0, 1), "title"), "Authored");
    assert.ok(!tokens(result.root()).includes("Changed configuration"));
  });
  check("equivalent JS HsonData Transform and governed data projections configure the same result", () => {
    const configuration = { at: { first: { at: { action: { attrs: { title: "Data" }, text: "" } } } } };
    const dataText = hsonTransform.fromJson(configuration).toHson().serialize();
    const projected = hsonTransform.fromHson(dataText).toJson().value();
    assert.deepEqual(projected, configuration);
    const map = recursiveFixture(); map.addLibraries({ config: { data: projected } });
    const data = map.lib("config"); if (data.mode === "document") throw Error("Expected data");
    const direct = compose_livemap_document_internal(map, "layout", "direct", { configuration });
    for (const [name, value] of [["transform", projected], ["governed", data.snap()], ["nodeProjection", hsonTransform.fromNode(hsonTransform.fromHson(dataText).toNode()).toJson().value()]] as const) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw Error("Expected a projected configuration record");
      assert.deepEqual(compose_livemap_document_internal(map, "layout", name, { configuration: value }).root(), direct.root());
    }
  });
  check("configuration choices retain active cycles output limits and normalization bounds", () => {
    const map = recursiveFixture();
    const cyclic = authored({ layout: { document: '<hson-template @:slot lib="parts" quad="safe"/>' },
      parts: { document: '<p @:safe/> <hson-template @:loop lib="parts" quad="loop"/>' } });
    atomic(cyclic, () => compose_livemap_document_internal(cyclic, "layout", "bad", { configuration: { at: { slot: { use: { quad: "loop" } } } } }), /cycle/);
    const configuration = { at: { first: { at: { action: { text: "x".repeat(100) } } } } };
    for (const options of [{ maxNodes: 4 }, { maxDepth: 4 }, { maxCharacters: 100 }]) {
      atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { ...options, configuration }), /limit exceeded/);
    }
    atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration: { text: "x".repeat(4_000_001) } }), /resource limit/);
    let deep: unknown = {}; for (let index = 0; index < 130; index++) deep = { at: { first: deep } };
    atomic(map, () => Reflect.apply(compose_livemap_document_internal, undefined,
      [map, "layout", "bad", { configuration: deep }]), /depth limit/);
  });
  check("configured results retain final Schema qualification and selected stylesheet rejection", () => {
    const map = authored({ layout: { document: '<a href="/" "Default"/>' } });
    const schema = Hson.schema`<type "document" tag "a" attrs <props <href <exact "/docs">>> content "string">`;
    atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration: {}, schema }), /schema/i);
    const result = compose_livemap_document_internal(map, "layout", "result", { configuration: { attrs: { href: "/docs" } }, schema });
    assert.equal(result.schema.get(), schema);
    const style = authored({ layout: { document: '<style "a { color: red; }"/>' } });
    atomic(style, () => compose_livemap_document_internal(style, "layout", "bad", { configuration: { text: "" } }), /Document <style>/);
    const css = recursiveFixture(); doc(css, "other").css.stylesheet("em { color: red; }");
    atomic(css, () => compose_livemap_document_internal(css, "layout", "bad", { configuration: { at: { first: { at: { action: { use: { lib: "other", quad: "secondary" } } } } } } }), /managed stylesheet/);
  });
  check("selected alternatives receive nested configuration in their own subtree", () => {
    const map = authored({ layout: { document: '<hson-template @:slot lib="parts" quad="one"/>' },
      parts: { document: '<section @:one <p @:old "Old"/>/> <article @:two title="Two" <p @:label "Two"/>/>' },
      other: { document: '<aside @:two title="Other" <p @:label "Other"/>/>' } });
    for (const [name, use, tag] of [["same", { quad: "two" }, "article"], ["different", { lib: "other", quad: "two" }, "aside"]] as const) {
      const configuration = { at: { slot: { use, attrs: { title: "Selected" }, at: { label: { text: "Nested" } } } } };
      const result = compose_livemap_document_internal(map, "layout", name, { configuration });
      assert.deepEqual(tokens(result.root()), [tag, "p", "Nested"]);
      assert.equal(result.document.attrs.get(target(0), "title"), "Selected");
    }
    atomic(map, () => compose_livemap_document_internal(map, "layout", "bad", { configuration: { at: { slot: { use: { quad: "two" }, at: { old: {} } } } } }), /outside the selected subtree/);
  });
  check("QUAD spellings that coincide with JavaScript properties still resolve authored registry subjects", () => {
    const map = authored({ layout: { document: '<main <p @:constructor "First"/> <p @:__proto__ "Second"/>/>' } });
    const configuration: Readonly<Record<string, unknown>> = JSON.parse('{"at":{"constructor":{"text":"One"},"__proto__":{"text":"Two"}}}');
    assert.deepEqual(tokens(compose_livemap_document_internal(map, "layout", "result", { configuration }).root()), ["main", "p", "One", "p", "Two"]);
  });
  check("input reflection reentrancy is inside the composition capture fence", () => {
    for (const change of ["identity", "authority"]) {
      const map = recursiveFixture(), aggregate = internal_livemap_aggregate_authority(map);
      const before = map.capture(); let attempted = false, publications = 0;
      const stop = map.commits.observe(() => publications++);
      const configuration = new Proxy({ as: "received" }, { ownKeys(input) {
        if (!attempted) {
          attempted = true;
          if (change === "identity") acquire_document_identity(doc(map, "layout").document, target(0));
          else aggregate.setInitialHostedAuthority({ ...aggregate.hostedPosition().authority });
        }
        return Reflect.ownKeys(input);
      } });
      try { assert.throws(() => compose_livemap_document_internal(map, "layout", "result", { configuration }), /changed during capture/); }
      finally { stop(); }
      assert.ok(attempted); assert.equal(publications, 0); assert.equal(map.rev, 0);
      assert.deepEqual(map.capture(), before); assert.throws(() => map.lib("result"));
    }
  });
  check("whole selected and customized composition reject incomplete identity preflight and realization atomically", () => {
    for (const selection of ["whole", "selected", "customized", "configured", "receiving"] as const) for (const phase of ["preflight", "realize"]) {
      const map = authored({ layout: { document: `<main <hson-template @:slot lib="parts"${selection_controls(selection)}/> <aside/>/>` }, parts: { document: '<button @:button title="Default" "Default"/>' } });
      const aggregate = internal_livemap_aggregate_authority(map), id = aggregate.libraries()[0]!;
      let attempted = false;
      const compose = () => { attempted = true; compose_livemap_document_internal(map, "layout", "result", selection_options(selection)); };
      atomic(map, () => aggregate.acquireLocalDocumentIdentity(id, validate_document_path([0, 0, 1]), mint_hson_node_quid(), {
        preflight() { if (phase === "preflight") compose(); return { apply() {}, rollback() {}, release() {} }; },
        realize() { if (phase === "realize") compose(); }, rollbackRealization() {},
      }), /incomplete identity transaction/);
      assert.equal(attempted, true); assert.throws(() => map.lib("result"));
      assert.ok(lookup(doc(map, "parts"), "button"));
    }
  });
  for (const operation of ["ordinary addition", "whole", "selected", "customized", "configured", "receiving"] as const) {
    check(`exclusive management acquired during ${operation} preparation prevents admission`, () => {
      const map = authored({ layout: { document: `<main <hson-template @:slot lib="parts"${selection_controls(operation === "ordinary addition" ? "whole" : operation)}/>/>` },
        parts: { document: '<section @:panel <button @:button title="Default" "Default"/>/>' } });
      const aggregate = internal_livemap_aggregate_authority(map), manager = {};
      const addresses = [lookup(doc(map, "parts"), "panel"), lookup(doc(map, "parts"), "button")];
      const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
      let claimed = false;
      aggregate.assertPublicMutationAllowed();
      try {
        atomic(map, () => {
          Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value(this: unknown) {
            if (!claimed && typeof this === "object" && this !== null && Object.hasOwn(this, "format")
              && Reflect.get(this, "format") === "hson-exact-value") {
              aggregate.assertPublicMutationAllowed();
              assert.equal(map.rev, 0); assert.throws(() => map.lib("result"));
              aggregate.claimManagement(manager); claimed = true;
            }
            return this;
          } });
          try {
            if (operation === "ordinary addition") map.addLibraries({ result: { document: '<footer/>' }, extra: { data: { value: 1 } } });
            else compose_livemap_document_internal(map, "layout", "result", selection_options(operation));
          } finally {
            if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, "toJSON");
            else Object.defineProperty(Object.prototype, "toJSON", descriptor);
          }
        }, /exclusive Locus authority/);
        assert.equal(claimed, true, "management is acquired inside late topology serialization");
        assert.throws(() => aggregate.assertPublicMutationAllowed(), /exclusive Locus authority/);
        assert.throws(() => aggregate.claimManagement({}), /another exclusive authority/);
        assert.throws(() => map.lib("result")); assert.throws(() => map.lib("extra"));
        assert.deepEqual([lookup(doc(map, "parts"), "panel"), lookup(doc(map, "parts"), "button")], addresses);
        atomic(map, () => map.addLibraries({ later: { document: '<aside/>' } }), /exclusive Locus authority/);
      } finally { aggregate.releaseManagement(manager); }
      assert.equal(map.addLibraries({ result: { document: '<footer/>' } }).rev, 1);
      assert.deepEqual(tokens(doc(map, "result").root()), ["footer"]);
    });
  }
  check("authorized manager-controlled Library admission and prepared transition fences remain valid", () => {
    const map = fixture(), aggregate = internal_livemap_aggregate_authority(map), manager = {};
    const commits: LiveMapCommit[] = [], stop = map.commits.observe(commit => commits.push(commit));
    aggregate.claimManagement(manager);
    try {
      const discarded = prepare_hosted_livemap_library_add_internal(map, manager, { discarded: { document: '<aside/>' } });
      aggregate.discard(discarded.transition);
      atomic(map, () => aggregate.accept(discarded.transition, "isolate", discarded.afterInstall), /discarded/);
      const stale = prepare_hosted_livemap_library_add_internal(map, manager, { stale: { document: '<aside/>' } });
      const accepted = prepare_hosted_livemap_library_add_internal(map, manager, { governed: { document: '<footer/>' } });
      atomic(map, () => internal_livemap_aggregate_authority(fixture()).accept(accepted.transition), /another authority/);
      aggregate.accept(accepted.transition, "isolate", accepted.afterInstall);
      assert.equal(map.rev, 1); assert.deepEqual(tokens(doc(map, "governed").root()), ["footer"]);
      assert.equal(commits.length, 1); assert.equal(Reflect.get(commits[0]!.operations[0]!.operation, "kind"), "library-add");
      atomic(map, () => aggregate.accept(accepted.transition, "isolate", accepted.afterInstall), /already accepted/);
      atomic(map, () => aggregate.accept(stale.transition, "isolate", stale.afterInstall), /stale/);
      assert.throws(() => map.lib("stale")); assert.throws(() => map.lib("discarded"));
      atomic(map, () => map.addLibraries({ denied: { document: '<aside/>' } }), /exclusive Locus authority/);
    } finally { stop(); aggregate.releaseManagement(manager); }
  });
  check("identity and equal-valued authority reentrancy during final admission invalidate source captures", () => {
    for (const selection of ["whole", "selected", "customized", "configured", "receiving"] as const) for (const change of ["identity", "authority"]) {
      const map = authored({ layout: { document: `<main <hson-template @:slot lib="parts"${selection_controls(selection)}/> <aside/>/>` }, parts: { document: '<button @:button title="Default" "Default"/>' } });
      const aggregate = internal_livemap_aggregate_authority(map), registry = aggregate.hostedRegistry();
      const before = map.capture(), address = lookup(doc(map, "parts"), "button"), issued = aggregate.identityEpoch().issued().size;
      const position = aggregate.hostedPosition();
      const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
      let attempted = false, publications = 0, positions = 0;
      const stop = map.commits.observe(() => publications++), stopPosition = aggregate.observeAuthorityPosition(() => positions++);
      Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value(this: unknown) {
        if (!attempted && typeof this === "object" && this !== null && Object.hasOwn(this, "format")
          && Reflect.get(this, "format") === "hson-exact-value") {
          attempted = true;
          if (change === "identity") acquire_document_identity(doc(map, "layout").document, target(0, 0, 1));
          else aggregate.setInitialHostedAuthority({ ...position.authority });
        }
        return this;
      } });
      try { assert.throws(() => compose_livemap_document_internal(map, "layout", "result", selection_options(selection)), /changed during capture/); }
      finally {
        if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, "toJSON");
        else Object.defineProperty(Object.prototype, "toJSON", descriptor);
        stop(); stopPosition();
      }
      assert.equal(attempted, true); assert.equal(publications, 0); assert.equal(positions, change === "identity" ? 0 : 1);
      assert.equal(map.rev, 0); assert.equal(aggregate.hostedRegistry(), registry); assert.deepEqual(map.capture(), before);
      assert.deepEqual(lookup(doc(map, "parts"), "button"), address); assert.throws(() => map.lib("result"));
      // Independently completed changes remain; the rejected composition publishes nothing.
      assert.equal(aggregate.identityEpoch().issued().size, issued + (change === "identity" ? 1 : 0));
      assert.deepEqual(aggregate.hostedPosition(), position);
      if (change === "authority") assert.notEqual(aggregate.hostedPosition().authority, position.authority);
    }
  });
  check("reentrant changes while copying sources invalidate captures without overwriting completed changes", () => {
    for (const selection of ["whole", "selected", "customized", "configured", "receiving"] as const) for (const change of ["identity", "topology", "authority"]) {
      const map = authored({ layout: { document: `<main <hson-template @:slot lib="parts"${selection_controls(selection)}/> <aside/>/>` },
        parts: { document: '<button @:button title="capture" "Default"/>' } });
      const aggregate = internal_livemap_aggregate_authority(map), id = aggregate.libraries()[1]!;
      const attrs = node(aggregate.root(id).$_content[0]).$_attrs;
      const descriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptors")!;
      const original = Object.getOwnPropertyDescriptors;
      const commits: LiveMapCommit[] = [], stop = map.commits.observe(commit => commits.push(commit));
      let attempted = false, after: ReturnType<LiveMap["capture"]> | undefined;
      let registry = aggregate.hostedRegistry(), ledger = aggregate.identityEpoch().issued();
      let roots = aggregate.libraries().map(library => aggregate.root(library));
      let overlays = aggregate.libraries().map(library => aggregate.documentOverlay(library));
      Object.defineProperty(Object, "getOwnPropertyDescriptors", { ...descriptor, value(input: object) {
        if (!attempted && input === attrs) {
          attempted = true;
          if (change === "identity") acquire_document_identity(doc(map, "layout").document, target(0, 0, 1));
          else if (change === "topology") map.addLibraries({ intervening: { document: '<footer/>' } });
          else aggregate.setInitialHostedAuthority({ ...aggregate.hostedPosition().authority });
          after = map.capture(); registry = aggregate.hostedRegistry(); ledger = aggregate.identityEpoch().issued();
          roots = aggregate.libraries().map(library => aggregate.root(library));
          overlays = aggregate.libraries().map(library => aggregate.documentOverlay(library));
        }
        return original(input);
      } });
      try { assert.throws(() => compose_livemap_document_internal(map, "layout", "result", selection_options(selection)), /changed during capture/); }
      finally { Object.defineProperty(Object, "getOwnPropertyDescriptors", descriptor); stop(); }
      assert.equal(attempted, true); assert.deepEqual(map.capture(), after);
      assert.equal(aggregate.hostedRegistry(), registry); assert.equal(aggregate.identityEpoch().issued(), ledger);
      aggregate.libraries().forEach((library, index) => {
        assert.equal(aggregate.root(library), roots[index]); assert.equal(aggregate.documentOverlay(library), overlays[index]);
      });
      assert.throws(() => map.lib("result"));
      assert.equal(commits.length, change === "topology" ? 1 : 0);
      if (change === "topology") assert.equal(Reflect.get(commits[0]!.operations[0]!.operation, "kind"), "library-add");
    }
  });
}
