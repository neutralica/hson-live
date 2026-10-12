import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../../src/index.ts";
import { install_libraries_snapshot, validate_document_path, type LiveMapCommit } from "../../src/api/livemap/index.ts";
import { compose_livemap_document_internal } from "../../src/api/livemap/livemap.libraries.ts";
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

const empty = (): HsonNode => ({ $_tag: ROOT_TAG, $_content: [] });
const node = (value: unknown): HsonNode => { if (!is_Node(value)) throw Error("Expected a node"); return value; };
const target = (...path: number[]): LiveMapDocumentRequestTarget => ({ kind: "path", path });
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
  const issued = enumerate_livemap_issued_quids(epoch.issued());
  const roots = aggregate.libraries().map(identity => aggregate.root(identity));
  const overlays = aggregate.libraries().filter((_identity, index) => aggregate.hostedRegistry().libraries[index]?.mode === "document")
    .map(identity => aggregate.documentOverlay(identity));
  const commits: LiveMapCommit[] = [];
  const subscription = map.commits.observe(commit => commits.push(commit));
  try { if (pattern) assert.throws(run, pattern); else assert.throws(run); }
  finally { subscription(); }
  assert.deepEqual(map.capture(), before);
  assert.deepEqual(enumerate_livemap_issued_quids(epoch.issued()), issued);
  assert.equal(aggregate.identityEpoch(), epoch);
  assert.deepEqual(aggregate.libraries().map(identity => aggregate.root(identity)), roots);
  const afterOverlays = aggregate.libraries().filter((_identity, index) => aggregate.hostedRegistry().libraries[index]?.mode === "document")
    .map(identity => aggregate.documentOverlay(identity));
  afterOverlays.forEach((overlay, index) => assert.equal(overlay, overlays[index]));
  assert.equal(commits.length, 0);
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
  check("unsupported connector arguments and attributes reject instead of disappearing", () => {
    for (const attr of ['quad="link"', 'href="/about"', 'label="About"', 'id="marker"', 'style="color:red"']) {
      const map = hsonLiveMap.fromLibraries({ layout: { document: `<hson-template lib="component" ${attr}/>` }, component: { document: '<a/>' } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "page"), /Unsupported.*attribute/);
    }
  });
  check("connectors require a nonempty string lib and empty content", () => {
    for (const document of ['<hson-template/>', '<hson-template lib=""/>', '<hson-template lib="component" "description"/>', '<hson-template lib="component" <span/>/>']) {
      const map = hsonLiveMap.fromLibraries({ layout: { document }, component: { document: '<a/>' } });
      atomic(map, () => compose_livemap_document_internal(map, "layout", "page"), /requires.*lib|content is not supported/);
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
    assert.deepEqual(tokens(root), ["main", "a", "Home", "a", "Home"]);
  });
}
