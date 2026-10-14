import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { install_libraries_snapshot, validate_document_path, type LiveMapCommit } from "../../src/api/livemap/index.ts";
import { compose_livemap_document_internal as compose, make_livemap_from_authored_libraries_internal as authored,
  prepare_hosted_livemap_library_add_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { part_collection_definition_internal as collection, type DocumentPart } from "../../src/api/livemap/livemap.parts.ts";
import { lookup_document_quad_internal as lookup, parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { expand_document_composition, document_composition_options } from "../../src/api/livemap/livemap.document.composition.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { ROOT_TAG, ELEM_TAG, STR_TAG } from "../../src/core/constants.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type { LiveMap, LiveMapDocumentLibrary, LiveMapDocumentRequestTarget } from "../../src/types/livemap.types.ts";
import { acquire_document_identity } from "../helpers/livemap-identity-internal.mts";
import { mint_hson_node_quid } from "../../src/core/hson-node-quid.ts";
import { set_livemap_quid_candidate_source_for_tests } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { overwrite_hson_node } from "../../src/api/livemap/livemap.editor.ts";
import { admit_exact_runtime_livemap_libraries } from "../../src/internal/exact-runtime-node-admission.ts";
import { parse_hson_exact_runtime } from "../../src/internal/exact-runtime-hson-codec.ts";
import { encode_hosted_root } from "../../src/api/livemap/livemap.hosted.ts";

const part = (document: string, css?: string): DocumentPart => ({ kind: "document", document, ...(css === undefined ? {} : { css }) });
const sourceRoot = (source: string): HsonNode => source === "" ? { $_tag: ROOT_TAG, $_content: [] } : parse_authored_document_library(source).root;
const node = (value: unknown): HsonNode => { if (!is_Node(value)) throw Error("Expected a node"); return value; };
const target = (...path: number[]): LiveMapDocumentRequestTarget => ({ kind: "path", path });
const doc = (map: LiveMap, name: string): LiveMapDocumentLibrary => {
  const library = map.lib(name); if (library.mode !== "document") throw Error("Expected document Library"); return library;
};
const data = (map: LiveMap, name = "parts") => {
  const library = map.lib(name); if (library.mode === "document") throw Error("Expected data Library"); return library;
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
  layout: { document: '<main <hson-template lib="parts" at="link"/> <hson-template lib="parts" at="link"/>/>' },
  parts: collection({ link: part('<a href="/home" style="color:blue" "Home"/>'), unused: part('<i/>') }),
});
const recursive = () => authored({
  layout: { document: '<main @:page <hson-template @:first lib="parts" at="panel"/> <hson-template @:second lib="parts" at="panel"/> <footer @:tail/>/>' },
  parts: collection({
    panel: part('<section @:panel title="Panel" <h2 @:heading "Default"/> <div @:body <hson-template @:action at="primary"/>/>/>'),
    primary: part('<button @:button title="Primary" "Go"/>'),
    secondary: part('<a @:button href="/" title="Secondary" "Alternate"/>'),
  }),
  other: collection({ secondary: part('<aside @:button title="Other" "Other"/>') }),
});
function atomic(map: LiveMap, run: () => unknown, pattern?: RegExp): void {
  const before = map.capture(), aggregate = owner(map), epoch = aggregate.identityEpoch();
  const registry = aggregate.hostedRegistry(), ledger = epoch.issued(), revision = map.rev;
  const ids = aggregate.libraries(), roots = ids.map(id => aggregate.root(id));
  const overlays = ids.map(id => aggregate.hostedRegistry().libraries.find(entry => entry.name ===
    before.registry.libraries[ids.indexOf(id)]?.name)?.mode === "document"
    ? aggregate.documentOverlay(id) : aggregate.projectedOverlay(id));
  let commits = 0, positions = 0;
  const stop = map.commits.observe(() => commits++), stopPosition = aggregate.observeAuthorityPosition(() => positions++);
  try { if (pattern) assert.throws(run, pattern); else assert.throws(run); }
  finally { stop(); stopPosition(); }
  assert.deepEqual(map.capture(), before); assert.equal(aggregate.identityEpoch(), epoch);
  assert.equal(aggregate.hostedRegistry(), registry); assert.equal(epoch.issued(), ledger); assert.equal(map.rev, revision);
  assert.deepEqual(aggregate.libraries(), ids);
  ids.forEach((id, index) => {
    assert.equal(aggregate.root(id), roots[index]);
    assert.equal(before.registry.libraries[index]?.mode === "document" ? aggregate.documentOverlay(id) : aggregate.projectedOverlay(id), overlays[index]);
  });
  assert.equal(commits, 0); assert.equal(positions, 0);
}
const configured = { at: {
  first: { attrs: { title: "First" }, at: { heading: { as: "caption", text: "One" }, action: { text: "Next" } } },
  second: { at: { heading: { text: "Two" }, action: { use: { at: "secondary" }, text: "Previous" } } },
} };

export function document_composition_cases(check: (name: string, run: () => void) => void): void {
  check("one collection supplies multiple members and one ordinary result addition publishes once", () => {
    const map = fixture(), aggregate = owner(map), before = map.capture(), commits: LiveMapCommit[] = [];
    const ledger = aggregate.identityEpoch().issued();
    map.commits.observe(commit => { assert.equal(doc(map, "page"), map.lib("page")); commits.push(commit); });
    const page = compose(map, "layout", "page");
    assert.deepEqual(tokens(page.root()), ["main", "a", "Home", "a", "Home"]);
    assert.equal(page.css.snapshot(), ""); assert.equal(commits.length, 1);
    assert.equal(commits[0]!.operations.length, 1);
    const op = commits[0]!.operations[0]!.operation;
    if (!("kind" in op) || op.kind !== "library-add") throw Error("Expected Library addition");
    assert.deepEqual(op.libraries.map(entry => entry.name), ["page"]);
    assert.deepEqual(map.capture().registry.libraries.map(entry => entry.name), ["layout", "parts", "page"]);
    assert.deepEqual(map.capture().libraries.slice(0, 2), before.libraries);
    assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), enumerate_livemap_issued_quids(ledger));
    assert.equal(aggregate.projectedOverlay(aggregate.libraries()[1]!).size, 0);
    assert.throws(() => map.lib("link")); assert.equal(Reflect.get(map, "template"), undefined);
  });
  check("exact collection and member coordinates support slash Unicode empty and non-QUAD keys", () => {
    const map = hsonLiveMap.fromLibraries({
      layout: { document: '<main <hson-template lib="collection/葉" at="button/β"/> <hson-template lib="collection/葉" at="1 key"/> <hson-template lib="collection/葉" at=""/>/>' },
      "collection/葉": collection({ "button/β": part('<button/>'), "1 key": part('<i/>'), "": part('<b/>') }),
    });
    const page = compose(map, "layout", "page");
    assert.deepEqual(tokens(page.root()), ["main", "button", "i", "b"]);
    assert.equal(owner(map).identityEpoch().issued().size, 0); assert.equal(lookup(page, "button"), undefined);
  });
  check("root selection needs no root landmark and includes all descendants", () => {
    const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template lib="parts" at="key"/>' },
      parts: collection({ key: part('<section <i @:label/> <b/>/>') }) });
    const page = compose(map, "layout", "page");
    assert.deepEqual(tokens(page.root()), ["section", "i", "b"]);
    assert.equal(lookup(page, "key"), undefined); assert.equal(lookup(page, "label"), undefined);
  });
  check("repeated configured Part occurrences own independent graphs and source values remain unchanged", () => {
    const map = recursive(), before = map.capture(), ids = owner(map).libraries(), roots = ids.map(id => owner(map).root(id));
    const page = compose(map, "layout", "page", { configuration: configured });
    assert.deepEqual(tokens(page.root()), ["main", "section", "h2", "One", "div", "button", "Next", "section", "h2", "Two", "div", "a", "Previous", "footer"]);
    assert.equal(lookup(page, "heading"), undefined); assert.equal(lookup(page, "action"), undefined);
    assert.equal(lookup(page, "caption")?.path.join("."), "0.0.0.0.0");
    assert.deepEqual(map.capture().libraries.slice(0, before.libraries.length), before.libraries);
    ids.forEach((id, index) => assert.equal(owner(map).root(id), roots[index]));
    const output = owner(map).root(owner(map).libraries().at(-1)!);
    const children = node(node(output.$_content[0]).$_content[0]).$_content;
    const first = node(children[0]), second = node(children[1]);
    assert.notEqual(first, second); assert.notEqual(first.$_attrs, second.$_attrs); assert.notEqual(first.$_content, second.$_content);
    page.document.attrs.set(target(0, 0, 0), "title", "Edited");
    assert.equal(page.document.attrs.get(target(0, 0, 1), "title"), "Panel");
    data(map).at(["panel", "document"]).set('<article "Changed source"/>');
    assert.equal(page.document.attrs.get(target(0, 0, 0), "title"), "Edited");
    assert.deepEqual(tokens(compose(map, "layout", "later").root()), ["main", "article", "Changed source", "article", "Changed source", "footer"]);
  });
  check("Part-local root descendant and connector QUADs remain local without explicit promotion", () => {
    const map = recursive(), page = compose(map, "layout", "page");
    for (const name of ["panel", "heading", "body", "action", "button"]) assert.equal(lookup(page, name), undefined);
    for (const name of ["page", "first", "second", "tail"]) assert.ok(lookup(page, name));
    assert.equal(owner(map).projectedOverlay(owner(map).libraries()[1]!).size, 0);
    assert.equal(owner(map).documentOverlay(owner(map).libraries().at(-1)!).size, 4);
  });
  check("shell connector names address replacements and ordinary shell paths survive output offsets", () => {
    const map = authored({ layout: { document: '<i @:before/> <main @:page <hson-template @:next lib="parts" at="panel"/> <hson-template @:previous lib="parts" at="button"/> <footer @:tail/>/> <b @:after/>' },
      parts: collection({ panel: part('<section <hson-template at="button"/> <hson-template at="button"/>/>'), button: part('<button @:label/>') }) });
    const page = compose(map, "layout", "page");
    for (const [name, path] of [["before", [0]], ["page", [1]], ["next", [1, 0, 0]], ["previous", [1, 0, 1]], ["tail", [1, 0, 2]], ["after", [2]]] as const) {
      assert.deepEqual(lookup(page, name)?.path, path);
    }
    assert.equal(lookup(page, "label"), undefined);
    assert.equal(page.document.byQuid(lookup(page, "next")!.quid)?.$_tag, "section");
  });
  check("shell names and explicit as agree only on the same final association", () => {
    const map = recursive();
    const page = compose(map, "layout", "same", { configuration: { as: "page", at: { first: { as: "first" } } } });
    assert.deepEqual(lookup(page, "first")?.path, [0, 0, 0]);
    for (const configuration of [{ as: "renamed" }, { at: { first: { as: "renamed" } } },
      { at: { first: { as: "page" } } }, { at: { first: { at: { heading: { as: "tail" } } } } }]) {
      atomic(map, () => compose(map, "layout", "bad", { configuration }), /one name per subject/);
    }
  });
  check("shell addresses do not depend on source runtime QUIDs and final identities are fresh", () => {
    const map = recursive(), shell = doc(map, "layout"), old = lookup(shell, "first")!.quid;
    const sourceIdentity = acquire_document_identity(shell.document, target(0));
    const before = map.capture(), page = compose(map, "layout", "page");
    assert.notEqual(lookup(page, "first")!.quid, old); assert.equal(page.document.byQuid(old), undefined);
    assert.deepEqual(map.capture().libraries.slice(0, before.libraries.length), before.libraries);
    assert.equal(sourceIdentity.active, true);
    const named = lookup(page, "first")!.quid, sibling = lookup(page, "second")!.quid;
    page.at([]).asElement()!.move(0, 1);
    assert.deepEqual(lookup(page, "first")?.path, [0, 0, 1]);
    page.document.content.remove(target(0, 0), 1);
    assert.equal(lookup(page, "first"), undefined); assert.equal(page.document.byQuid(named), undefined);
    assert.equal(lookup(page, "second")!.quid, sibling);
  });
  check("whole-document shell forests empty text and native template content remain supported", () => {
    for (const source of ['"" <i/> "text" <b/>', '<template <p/>/>', '', '"left" "right"']) {
      const map = hsonLiveMap.fromLibraries({ layout: { document: sourceRoot(source) } });
      assert.deepEqual(compose(map, "layout", "page").root(), map.lib("layout").root());
    }
    const map = hsonLiveMap.fromLibraries({ layout: { document: '"before" <hson-template lib="parts" at="one"/> "after"' },
      parts: collection({ one: part('<p ""/>') }) });
    assert.deepEqual(tokens(compose(map, "layout", "page").root()), ["before", "p", "", "after"]);
  });
  check("same and cross collection nested connectors use exact current collection context", () => {
    const map = hsonLiveMap.fromLibraries({ layout: { document: '<main <hson-template lib="a/b" at="outer"/> <hson-template lib="a" at="b/outer"/>/>' },
      "a/b": collection({ outer: part('<section <hson-template at="inner"/> <hson-template lib="別/庫" at="leaf/葉"/> <hson-template lib="a" at="b/outer"/>/>'), inner: part('<i/>') }),
      a: collection({ "b/outer": part('<aside/>') }), "別/庫": collection({ "leaf/葉": part('<b/>') }) });
    assert.deepEqual(tokens(compose(map, "layout", "page").root()), ["main", "section", "i", "b", "aside", "aside"]);
  });
  check("source material is read once per exact pair inside one operation and sibling reuse is legal", () => {
    const shell = parse_authored_document_library('<main <hson-template lib="c" at="p"/> <hson-template lib="c" at="p"/>/>');
    const selected = parse_authored_document_library('<p/>'); let reads = 0;
    const result = expand_document_composition("shell", () => ({ root: shell.root }), document_composition_options(undefined),
      (lib, member) => { assert.equal(lib, "c"); assert.equal(member, "p"); reads++; return { root: selected.root }; });
    assert.equal(reads, 1); assert.deepEqual(tokens(result.root), ["main", "p", "p"]);
  });
  check("direct indirect cross collection and configured active Part cycles reject", () => {
    for (const [a, b] of [
      ['<section <hson-template at="a"/>/>', '<aside/>'],
      ['<section <hson-template at="b"/>/>', '<aside <hson-template at="a"/>/>'],
      ['<section <hson-template lib="other" at="b"/>/>', '<aside <hson-template lib="parts" at="a"/>/>'],
    ]) {
      const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template lib="parts" at="a"/>' },
        parts: collection({ a: part(a), b: part(b) }), other: collection({ b: part(b) }) });
      atomic(map, () => compose(map, "layout", "bad"), /composition cycle/);
    }
    const map = authored({ layout: { document: '<hson-template @:slot lib="parts" at="safe"/>' },
      parts: collection({ safe: part('<p/>'), loop: part('<section <hson-template at="loop"/>/>') }) });
    atomic(map, () => compose(map, "layout", "bad", { configuration: { at: { slot: { use: { at: "loop" } } } } }), /cycle/);
  });
  check("graph reference node character and recursive configuration budgets remain finite", () => {
    const map = recursive();
    for (const options of [{ maxDepth: 2 }, { maxNodes: 3 }, { maxCharacters: 15 }]) atomic(map, () => compose(map, "layout", "bad", options), /limit exceeded/);
    atomic(map, () => compose(map, "layout", "bad", { configuration: { text: "x".repeat(4_000_001) } }), /resource limit/);
    for (const key of ["maxDepth", "maxNodes", "maxCharacters"]) for (const value of [0, -1, 1.5, NaN, Infinity, 4_000_001]) {
      atomic(map, () => Reflect.apply(compose, undefined, [map, "layout", "bad", { [key]: value }]));
    }
    const excessive: Record<string, unknown> = {}, first = excessive; let current = first;
    for (let index = 0; index < 130; index++) { const child = {}; current.at = { target: child }; current = child; }
    atomic(map, () => compose(map, "layout", "bad", { configuration: excessive }), /depth limit/);
  });
  check("missing ordinary data document and similar-looking unmarked sources reject without fallback", () => {
    for (const controls of ['lib="missing" at="button"', 'lib="layout" at="button"', 'lib="ordinary" at="button"', 'lib="parts" at="missing"']) {
      const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template ' + controls + '/>' },
        ordinary: { data: { button: { kind: "document", document: '<button/>' } } }, parts: collection({ button: part('<button/>') }) });
      atomic(map, () => compose(map, "layout", "bad"), /Part|collection/);
    }
    const map = fixture(); atomic(map, () => compose(map, "missing", "bad"), /Unknown/);
    atomic(map, () => compose(map, "parts", "bad"), /not a document/);
  });
  check("shell connectors require authored lib and exact at; legacy quad and whole Library routes reject", () => {
    for (const controls of ['', 'at="one"', 'lib="parts"', 'lib="" at="one"', 'lib="parts" quad="one"', 'lib="parts" at="one" quad="one"']) {
      const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template ' + controls + '/>' }, parts: collection({ one: part('<p/>') }) });
      atomic(map, () => compose(map, "layout", "bad"));
    }
    const map = hsonLiveMap.fromLibraries({ layout: { document: '<main <hson-template lib="parts" at="outer"/>/>' },
      parts: collection({ outer: part('<section <hson-template lib="" at="inner"/>/>'), inner: part('<i/>') }) });
    atomic(map, () => compose(map, "layout", "bad"), /collection lib/);
  });
  check("canonical lower-case Hson controls retain exact spelling and duplicate parser rejection", () => {
    const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template LIB="parts" AT="one"/>' }, parts: collection({ one: part('<p/>') }) });
    atomic(map, () => compose(map, "layout", "bad"), /collection lib/);
    assert.throws(() => hsonLiveMap.fromLibraries({ layout: { document: '<hson-template lib="parts" lib="other" at="one"/>' } }));
    const exact = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template lib="parts" at="One"/>' }, parts: collection({ one: part('<p/>') }) });
    atomic(exact, () => compose(exact, "layout", "bad"), /Unknown Part member/);
  });
  check("selected managed CSS fails for rules registrations keyframes and ordering-only state", () => {
    for (const css of ['p{color:red}', '@property --tone{syntax:"<color>";inherits:false;initial-value:red}', '@keyframes k{from{opacity:0}to{opacity:1}}', '@layer first{}@layer second{}']) {
      const map = authored({ layout: { document: '<hson-template @:slot lib="parts" at="plain"/>' },
        parts: collection({ plain: part('<p/>'), styled: part('<i/>', css), nested: part('<section <hson-template at="styled"/>/>') }) });
      assert.deepEqual(tokens(compose(map, "layout", "plain").root()), ["p"]);
      for (const at of ["styled", "nested"]) atomic(map, () => compose(map, "layout", "bad", { configuration: { at: { slot: { use: { at } } } } }), /managed stylesheet/);
    }
  });
  check("absent and empty Part CSS compose; unvisited valid styled members do not contaminate selection", () => {
    const map = fixture(), source = data(map).snap();
    data(map).at(["unused"]).set(part('<i/>', '@layer order{}'));
    assert.deepEqual(tokens(compose(map, "layout", "page").root()), ["main", "a", "Home", "a", "Home"]);
    data(map).at(["link"]).asObject()!.setKey("css", "");
    assert.deepEqual(tokens(compose(map, "layout", "emptyCss").root()), ["main", "a", "Home", "a", "Home"]);
    assert.ok(source); assert.equal(doc(map, "page").css.snapshot(), "");
    doc(map, "layout").css.stylesheet('main{color:red}');
    atomic(map, () => compose(map, "layout", "bad"), /managed stylesheet/);
  });
  check("configured alternatives fence only the selected Part including nested local choices", () => {
    const map = authored({ layout: { document: '<hson-template @:slot lib="parts" at="styled"/>' },
      parts: collection({ styled: part('<p/>', '@layer order{}'), plain: part('<i/>'), outer: part('<section <hson-template @:choice at="styled"/>/>') }) });
    const page = compose(map, "layout", "page", { configuration: { at: { slot: { use: { at: "plain" } } } } });
    assert.deepEqual(tokens(page.root()), ["i"]); assert.ok(lookup(page, "slot"));
    const nested = compose(map, "layout", "nested", { configuration: { at: { slot: { use: { at: "outer" }, at: { choice: { use: { at: "plain" } } } } } } });
    assert.deepEqual(tokens(nested.root()), ["section", "i"]); assert.equal(lookup(nested, "choice"), undefined);
    atomic(map, () => compose(map, "layout", "bad", { configuration: { at: { slot: { use: { at: "outer" } } } } }), /managed stylesheet/);
  });
  check("inline style storage remains independent and authored style nodes retain admission policy", () => {
    const map = fixture(), page = compose(map, "layout", "page"), root = owner(map).root(owner(map).libraries().at(-1)!);
    const children = node(node(root.$_content[0]).$_content[0]).$_content;
    assert.notEqual(node(children[0]).$_attrs?.style, node(children[1]).$_attrs?.style);
    assert.match(page.render(), /color.*blue/);
    const structural = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template lib="parts" at="style"/>' },
      parts: collection({ style: part('<section <style "p{color:red}"/>/>') }) });
    assert.deepEqual(tokens(compose(structural, "layout", "page").root()), ["section", "style", "p{color:red}"]);
  });
  check("root customization replaces existing string attributes and sole text including explicit empty", () => {
    for (const [args, title, text] of [['', "Default", "Default label"], ['title="Changed"', "Changed", "Default label"],
      ['""', "Default", ""], ['title="" "Read"', "", "Read"], ['" \\t "', "Default", " \t "]] as const) {
      const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template lib="parts" at="link" ' + args + '/>' },
        parts: collection({ link: part('<a href="/" title="Default" class="link" "Default label"/>') }) });
      const before = data(map).snap(), page = compose(map, "layout", "page");
      assert.equal(page.document.attrs.get(target(0), "title"), title); assert.deepEqual(tokens(page.root()), ["a", text]);
      assert.deepEqual(data(map).snap(), before);
    }
    for (const source of ['<p/>', '<p <b/>/>', '<p "one" "two"/>']) {
      const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template lib="parts" at="p" ""/>' }, parts: collection({ p: part(source) }) });
      atomic(map, () => compose(map, "layout", "bad"), /sole immediate/);
    }
  });
  check("customization rejects unknown attributes nonstrings structured styles and wrong immediate content", () => {
    for (const args of ['missing="x"', 'style="color:red"', '<b/>', '"one" "two"']) {
      const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template lib="parts" at="p" ' + args + '/>' },
        parts: collection({ p: part('<p title="Default" "Text"/>') }) });
      atomic(map, () => compose(map, "layout", "bad"));
    }
    const map = recursive();
    for (const configuration of [{ at: { first: { attrs: { missing: "x" } } } }, { at: { first: { text: "" } } },
      { at: { first: { at: { action: { use: { at: "secondary" }, attrs: { missing: "x" } } } } } }]) atomic(map, () => compose(map, "layout", "bad", { configuration }));
  });
  check("customization applies to the configured final Part root and recursive at stays occurrence-local", () => {
    const map = recursive();
    const page = compose(map, "layout", "page", { configuration: { at: {
      first: { at: { body: { at: { action: { use: { at: "secondary" }, attrs: { title: "Chosen" }, text: "" } } } } },
      second: { at: { action: { use: { lib: "other", at: "secondary" }, text: "Cross" } } },
    } } });
    assert.deepEqual(tokens(page.root()), ["main", "section", "h2", "Default", "div", "a", "", "section", "h2", "Default", "div", "aside", "Cross", "footer"]);
    assert.equal(page.document.attrs.get(target(0, 0, 0, 0, 1, 0, 0), "title"), "Chosen");
  });
  check("prepared reusable subconfigurations equal a complete page configuration", () => {
    const map = recursive(), button = { as: "promoted", text: "Prepared" }, panel = { at: { action: button, heading: { text: "Heading" } } };
    const configuration = { at: { first: panel, second: { at: { action: { text: "Other" } } } } }, before = JSON.stringify(configuration);
    const a = compose(map, "layout", "a", { configuration }), b = compose(map, "layout", "b", { configuration: JSON.parse(before) });
    assert.deepEqual(a.root(), b.root()); assert.equal(JSON.stringify(configuration), before);
    assert.deepEqual(lookup(a, "promoted")?.path, [0, 0, 0, 0, 1, 0, 0]);
    assert.equal(lookup(a, "action"), undefined);
    const shared = { at: { heading: { text: "Shared" } } };
    assert.deepEqual(tokens(compose(map, "layout", "shared", { configuration: { at: { first: shared, second: shared } } }).root()),
      ["main", "section", "h2", "Shared", "div", "button", "Go", "section", "h2", "Shared", "div", "button", "Go", "footer"]);
  });
  check("native HsonData JS Transform and governed-data configurations remain equivalent", () => {
    const map = recursive(), serialized = JSON.stringify(configured), canonical = Hson.data.from(configured);
    const variants = [configured, canonical, Hson.data.from(JSON.parse(serialized)),
      Hson.data.from(hsonTransform.fromJson(configured).toJson().value())];
    map.addLibraries({ config: { data: configured } });
    variants.push(Hson.data.from(data(map, "config").snap()));
    const expected = compose(map, "layout", "expected", { configuration: configured });
    variants.forEach((configuration, index) => assert.deepEqual(compose(map, "layout", "variant" + index, { configuration }).root(), expected.root()));
  });
  check("native configuration admits data only and preserves absent versus explicit empty text", () => {
    for (const value of ['<p/>', '<obj <text "x"/> <text "y"/>/>', 'garbage']) {
      const map = fixture(); atomic(map, () => Reflect.apply(compose, undefined, [map, "layout", "bad", { configuration: value }]));
    }
    for (const value of [Hson.data.from(null), Hson.data.from([]), Hson.data.from("text")]) {
      const map = fixture(); atomic(map, () => compose(map, "layout", "bad", { configuration: value }), /plain data records/);
    }
    const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template lib="parts" at="p"/>' }, parts: collection({ p: part('<p ""/>') }) });
    assert.deepEqual(tokens(compose(map, "layout", "empty", { configuration: Hson.data.from({ text: "" }) }).root()), ["p", ""]);
  });
  check("configuration exactness rejects old use.quad unknown fields accessors executable values and cycles", () => {
    const map = recursive(), cyclic: Record<string, unknown> = {}; cyclic.at = { first: cyclic };
    const accessor = {}; Object.defineProperty(accessor, "as", { enumerable: true, get() { throw Error("Getter must not run"); } });
    const hidden = {}; Object.defineProperty(hidden, "text", { value: "" });
    const malformed: unknown[] = [undefined, null, [], () => {}, cyclic, accessor, hidden, { q: "renamed" }, { text: undefined },
      { at: { first: { use: { quad: "panel" } } } }, { at: { first: { use: { at: "panel", quad: "panel" } } } },
      { at: { first: { use: "parts/panel" } } }, { at: { first: { use: { lib: "parts" } } } },
      { at: { first: { use: { at: "panel", lib: undefined } } } }, { at: { first: { use: { at: 1 } } } },
      { at: { first: { attrs: { title: false } } } }, { at: { first: { as: false } } }, { at: { first: { at: { "invalid name": {} } } } }];
    for (const configuration of malformed) atomic(map, () => Reflect.apply(compose, undefined, [map, "layout", "bad", { configuration }]));
    const nullRecord = Object.assign(Object.create(null), { at: { first: { attrs: { title: "Allowed" } } } });
    assert.equal(compose(map, "layout", "valid", { configuration: nullRecord }).document.attrs.get(target(0, 0, 0), "title"), "Allowed");
  });
  check("configuration cannot pluck source QUADs or use structural selection on ordinary descendants", () => {
    const map = recursive();
    for (const configuration of [{ use: { at: "panel" } }, { at: { first: { at: { heading: { use: { at: "primary" } } } } } }]) {
      atomic(map, () => compose(map, "layout", "bad", { configuration }), /requires a connector/);
    }
    for (const configuration of [{ at: { heading: {} } }, { at: { first: { at: { tail: {} } } } },
      { at: { first: { use: { at: "primary" }, at: { heading: {} } } } }, { at: { first: { at: { body: { at: { heading: {} } } } } } }]) {
      atomic(map, () => compose(map, "layout", "bad", { configuration }), /QUAD|subtree/);
    }
    atomic(map, () => compose(map, "layout", "bad", { configuration: { at: { first: { at: { panel: { at: { panel: {} } } } } } } }), /Ambiguous/);
  });
  check("late unknown members and invalid configured roots publish no early occurrence", () => {
    const map = recursive();
    for (const configuration of [{ at: { second: { use: { at: "missing" } } } },
      { at: { second: { use: { lib: "unknown", at: "primary" } } } }, { at: { second: { attrs: { missing: "bad" } } } },
      { at: { second: { at: { heading: { as: "caption" } } }, first: { at: { heading: { as: "caption" } } } } }]) {
      atomic(map, () => compose(map, "layout", "bad", { configuration }));
    }
  });
  check("composition revalidates the complete collection and rejects malformed unselected stored members", () => {
    const map = fixture(), aggregate = owner(map), raw = aggregate.root(aggregate.libraries()[1]!), original = data(map).root();
    const malformed = hsonTransform.fromJson({ link: part('<p/>'), late: { kind: "document", document: '<p' } }).toNode();
    const before = aggregate.hostedPosition(), ledger = aggregate.identityEpoch().issued(); let commits = 0, positions = 0;
    const stop = map.commits.observe(() => commits++), stopPosition = aggregate.observeAuthorityPosition(() => positions++);
    overwrite_hson_node(raw, malformed);
    try {
      assert.throws(() => compose(map, "layout", "bad")); assert.throws(() => map.lib("bad"));
      assert.deepEqual(encode_hosted_root(raw), encode_hosted_root(malformed)); assert.deepEqual(aggregate.hostedPosition(), before);
      assert.equal(aggregate.identityEpoch().issued(), ledger); assert.equal(commits, 0); assert.equal(positions, 0);
    } finally { overwrite_hson_node(raw, original); stop(); stopPosition(); }
    assert.deepEqual(tokens(compose(map, "layout", "valid").root()), ["main", "a", "Home", "a", "Home"]);
  });
  check("receiving names use authored grammar and duplicate or double subject names fail before allocation", () => {
    const map = recursive(), aggregate = owner(map); let calls = 0;
    set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, () => { calls++; throw Error("Allocator must not run"); });
    try {
      for (const configuration of [{ at: { first: { as: "different" } } }, { at: { first: { at: { heading: { as: "same" } } }, second: { at: { heading: { as: "same" } } } } },
        { at: { first: { as: "bad name" } } }, { at: { first: { as: "" } } }]) atomic(map, () => compose(map, "layout", "bad", { configuration }));
      assert.equal(calls, 0);
    } finally { set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, undefined); }
    const legal = hsonLiveMap.fromLibraries({ layout: { document: '<p/>' } });
    for (const name of ["constructor", "__proto__", "Pascal_Name"]) assert.equal(lookup(compose(legal, "layout", "page" + legal.rev, { configuration: { as: name } }), name)?.path.join("."), "0");
  });
  check("receiving cardinality requires one ordinary subject after expansion without guessing", () => {
    for (const document of ['', '"text"', '<i/> <b/>', '"before" <i/>']) {
      const map = hsonLiveMap.fromLibraries({ layout: { document: sourceRoot(document) } });
      atomic(map, () => compose(map, "layout", "bad", { configuration: { as: "received" } }), /exactly one ordinary resulting/);
      assert.throws(() => collection({ invalid: part(document) }));
      const shell = parse_authored_document_library('<hson-template @:slot lib="parts" at="invalid"/>');
      assert.throws(() => expand_document_composition("shell", () => ({ root: shell.root, quads: shell.declarations }),
        document_composition_options(undefined), () => ({ root: sourceRoot(document) })), /exactly one ordinary/);
    }
  });
  check("receiving identity allocation exhaustion is atomic and no source identity is issued", () => {
    const map = recursive(), aggregate = owner(map), existing = lookup(doc(map, "layout"), "page")!.quid;
    set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, () => existing);
    try { atomic(map, () => compose(map, "layout", "bad"), /No available document QUID/); }
    finally { set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, undefined); }
    assert.equal(aggregate.projectedOverlay(aggregate.libraries()[1]!).size, 0);
    const page = compose(map, "layout", "valid");
    assert.notEqual(lookup(page, "page")!.quid, existing);
  });
  check("complete candidate Schema checks precede final admission and retained Schema governs edits", () => {
    const map = hsonLiveMap.fromLibraries({ layout: { document: '<hson-template lib="parts" at="one"/>' }, parts: collection({ one: part('<a href="/" "Text"/>') }) });
    const schema = Hson.schema`<type "document" tag "a" attrs <props <href "string">> content "string">`;
    const page = compose(map, "layout", "page", { schema });
    assert.equal(page.schema.get(), schema); page.document.attrs.set(target(0), "href", "/edited");
    atomic(map, () => page.document.content.replace(target(), 0, { $_tag: "p", $_content: [] }), /schema/i);
    const wrong = Hson.schema`<type "document" tag "p" content "empty">`;
    atomic(map, () => compose(map, "layout", "bad", { schema: wrong, configuration: { as: "receiving" } }), /schema/i);
    atomic(map, () => compose(map, "layout", "page"), /duplicated/);
  });
  check("final capture and fresh restore work with all definition Libraries excluded", () => {
    const map = recursive(), page = compose(map, "layout", "page", { configuration: configured });
    const cut = map.cut({ documents: ["page"], data: [] }).libs, old = lookup(page, "caption")!.quid;
    const restored = install_libraries_snapshot(cut).map, final = doc(restored, "page");
    assert.deepEqual(final.root(), page.root()); assert.deepEqual(lookup(final, "caption")?.path, lookup(page, "caption")?.path);
    assert.notEqual(lookup(final, "caption")!.quid, old); assert.equal(final.document.byQuid(old), undefined);
    for (const source of ["layout", "parts", "other"]) assert.throws(() => restored.lib(source));
    assert.match(final.render(), /Previous/); final.document.attrs.set(target(0, 0, 0), "title", "Independent");
    const base = install_libraries_snapshot(fixture().capture()).map;
    const commits: LiveMapCommit[] = []; const original = fixture(); original.commits.observe(commit => commits.push(commit)); compose(original, "layout", "page");
    base.replay(commits[0]!); assert.deepEqual(doc(base, "page").root(), doc(original, "page").root());
  });
  check("composed pages remain eligible as whole shells and preserve their authored receiving QUADs", () => {
    const map = recursive(), page = compose(map, "layout", "page", { configuration: configured });
    const derived = compose(map, "page", "derived");
    assert.deepEqual(derived.root(), page.root()); assert.deepEqual(lookup(derived, "caption")?.path, lookup(page, "caption")?.path);
    assert.notEqual(lookup(derived, "caption")!.quid, lookup(page, "caption")!.quid);
  });
  check("ordinary descendant configuration follows current shell landmarks and rejects retired addresses", () => {
    const map = authored({ layout: { document: '<main <p @:heading "Before"/> <aside/>/>' } });
    const shell = doc(map, "layout"); shell.at([]).asElement()!.move(0, 1);
    const page = compose(map, "layout", "page", { configuration: { at: { heading: { text: "Moved" } } } });
    assert.deepEqual(lookup(page, "heading")?.path, [0, 0, 1]); assert.deepEqual(tokens(page.root()), ["main", "aside", "p", "Moved"]);
    shell.document.content.replace(target(0, 0), 1, { $_tag: "p", $_content: [] });
    atomic(map, () => compose(map, "layout", "bad", { configuration: { at: { heading: {} } } }), /Unknown composition QUAD/);
  });
  check("JSON-property QUAD spellings resolve by exact detached landmark paths", () => {
    const map = authored({ layout: { document: '<main <p @:constructor "First"/> <p @:__proto__ "Second"/>/>' } });
    const configuration: Readonly<Record<string, unknown>> = JSON.parse('{"at":{"constructor":{"text":"One"},"__proto__":{"text":"Two"}}}');
    const page = compose(map, "layout", "page", { configuration });
    assert.deepEqual(tokens(page.root()), ["main", "p", "One", "p", "Two"]); assert.ok(lookup(page, "__proto__"));
  });
  check("owner-proven shell identities are stripped throughout detached output without Part source authority", () => {
    const q1 = "000009001", q2 = "000009002";
    const map = admit_exact_runtime_livemap_libraries({ layout: { document: parse_hson_exact_runtime('<main @' + q1 + ' <p @' + q2 + ' "Text"/>/>', { allowTopLevelDocumentText: true }) } });
    const before = map.capture(), page = compose(map, "layout", "page");
    assert.equal(JSON.stringify(page.root()).includes("quid"), false); assert.equal(page.document.byQuid(q1), undefined); assert.equal(page.document.byQuid(q2), undefined);
    assert.deepEqual(map.capture().libraries[0], before.libraries[0]);
    assert.equal(owner(map).documentOverlay(owner(map).libraries()[1]!).size, 0);
  });
  check("equivalent exact Hson and admitted HTML shells retain sole-text override behavior", () => {
    const html = hsonTransform.fromTrustedHtml('<p title="Default">Text</p>').toNode();
    const map = hsonLiveMap.fromLibraries({ html: { document: html }, hson: { document: '<p title="Default" "Text"/>' } });
    assert.deepEqual(compose(map, "html", "one", { configuration: { attrs: { title: "" }, text: "" } }).root(),
      compose(map, "hson", "two", { configuration: { attrs: { title: "" }, text: "" } }).root());
    const svg = hsonLiveMap.fromLibraries({ layout: { document: '<svg viewBox="0 0 1 1"/>' } });
    assert.equal(compose(svg, "layout", "page", { configuration: { attrs: { viewBox: "0 0 2 2" } } }).document.attrs.get(target(0), "viewBox"), "0 0 2 2");
  });
  check("ordinary batch and exclusive management fences reject private composition", () => {
    const map = recursive(), aggregate = owner(map), manager = {};
    atomic(map, () => map.batch(() => { compose(map, "layout", "bad"); }), /batch|staged/i);
    aggregate.claimManagement(manager);
    try { atomic(map, () => compose(map, "layout", "bad"), /exclusive Locus authority/); }
    finally { aggregate.releaseManagement(manager); }
  });
  check("authorized ordinary admission still uses existing prepared-transition owner fences", () => {
    const map = fixture(), aggregate = owner(map), manager = {};
    aggregate.claimManagement(manager);
    try {
      const discarded = prepare_hosted_livemap_library_add_internal(map, manager, { discarded: { document: '<aside/>' } });
      aggregate.discard(discarded.transition);
      atomic(map, () => aggregate.accept(discarded.transition, "isolate", discarded.afterInstall), /discarded/);
      const stale = prepare_hosted_livemap_library_add_internal(map, manager, { stale: { document: '<i/>' } });
      const accepted = prepare_hosted_livemap_library_add_internal(map, manager, { governed: { document: '<footer/>' } });
      aggregate.accept(accepted.transition, "isolate", accepted.afterInstall);
      assert.equal(map.rev, 1); assert.deepEqual(tokens(doc(map, "governed").root()), ["footer"]);
      atomic(map, () => aggregate.accept(accepted.transition, "isolate", accepted.afterInstall), /already accepted/);
      atomic(map, () => aggregate.accept(stale.transition, "isolate", stale.afterInstall), /stale/);
      assert.throws(() => map.lib("stale")); assert.throws(() => map.lib("discarded"));
    } finally { aggregate.releaseManagement(manager); }
  });
  check("reflection reentrancy during configuration invalidates source capture and retains completed inner changes", () => {
    for (const change of ["identity", "authority", "data", "composition"]) {
      const map = fixture(), aggregate = owner(map), before = map.rev; let entered = false;
      const configuration = new Proxy({}, { ownKeys(input) {
        if (!entered) {
          entered = true;
          if (change === "identity") acquire_document_identity(doc(map, "layout").document, target(0));
          else if (change === "authority") aggregate.setInitialHostedAuthority({ ...aggregate.hostedPosition().authority });
          else if (change === "data") data(map).at(["link", "document"]).set('<a "Changed"/>');
          else compose(map, "layout", "inner");
        }
        return Reflect.ownKeys(input);
      } });
      assert.throws(() => compose(map, "layout", "outer", { configuration }), /changed during capture/);
      assert.equal(entered, true); assert.throws(() => map.lib("outer"));
      assert.equal(map.rev, before + (change === "data" || change === "composition" ? 1 : 0));
      if (change === "data") assert.equal(data(map).snap(["link", "document"]), '<a "Changed"/>');
      if (change === "composition") assert.deepEqual(tokens(doc(map, "inner").root()), ["main", "a", "Home", "a", "Home"]);
    }
  });
  check("incomplete identity preflight and realization cannot observe or compose Parts", () => {
    for (const phase of ["preflight", "realize"]) {
      const map = fixture(), aggregate = owner(map), id = aggregate.libraries()[0]!; let entered = false;
      const attempt = () => { entered = true; compose(map, "layout", "bad"); };
      atomic(map, () => aggregate.acquireLocalDocumentIdentity(id, validate_document_path([0]), mint_hson_node_quid(), {
        preflight() { if (phase === "preflight") attempt(); return { apply() {}, rollback() {}, release() {} }; },
        realize() { if (phase === "realize") attempt(); }, rollbackRealization() {},
      }), /incomplete identity transaction/);
      assert.equal(entered, true); assert.throws(() => map.lib("bad"));
    }
  });
  check("source-phase exact Part reads fence reentrant edits without overwriting their accepted state", () => {
    for (const change of ["data", "identity", "authority", "topology"]) {
      const map = fixture(), aggregate = owner(map), descriptor = Object.getOwnPropertyDescriptor(Reflect, "getOwnPropertyDescriptor")!;
      const original = Reflect.getOwnPropertyDescriptor; let entered = false, after: ReturnType<LiveMap["capture"]> | undefined;
      // The ordinary data collection graph is inspected by the same Part validator.
      const raw = aggregate.root(aggregate.libraries()[1]!);
      Object.defineProperty(Reflect, "getOwnPropertyDescriptor", { ...descriptor, value(input: object, key: PropertyKey) {
        if (!entered && input === raw && key === "$_tag") {
          entered = true;
          if (change === "data") data(map).at(["link", "document"]).set('<a "Inner"/>');
          else if (change === "identity") acquire_document_identity(doc(map, "layout").document, target(0));
          else if (change === "authority") aggregate.setInitialHostedAuthority({ ...aggregate.hostedPosition().authority });
          else map.addLibraries({ inner: { document: '<aside/>' } });
          after = map.capture();
        }
        return original(input, key);
      } });
      try { assert.throws(() => compose(map, "layout", "bad"), /changed during capture/); }
      finally { Object.defineProperty(Reflect, "getOwnPropertyDescriptor", descriptor); }
      assert.equal(entered, true); assert.deepEqual(map.capture(), after); assert.throws(() => map.lib("bad"));
    }
  });
  check("exclusive management acquired during late ordinary topology preparation prevents composition acceptance", () => {
    const map = recursive(), aggregate = owner(map), manager = {};
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON"); let entered = false;
    try {
      atomic(map, () => {
        Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value(this: unknown) {
          if (!entered && typeof this === "object" && this !== null && Reflect.get(this, "format") === "hson-exact-value") {
            entered = true; aggregate.claimManagement(manager);
          }
          return this;
        } });
        try { compose(map, "layout", "bad"); }
        finally { if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, "toJSON"); else Object.defineProperty(Object.prototype, "toJSON", descriptor); }
      }, /exclusive Locus authority/);
      assert.equal(entered, true); assert.throws(() => map.lib("bad"));
    } finally { aggregate.releaseManagement(manager); }
  });
  check("detached candidate admission permits independently completed source edits before owner preparation", () => {
    const map = fixture(), descriptor = Object.getOwnPropertyDescriptor(Object, "freeze")!;
    const freeze = Object.freeze; let entered = false;
    Object.defineProperty(Object, "freeze", { ...descriptor, value<T>(value: T): Readonly<T> {
      if (!entered && typeof value === "object" && value !== null && Reflect.get(value, "name") === "page" && Object.hasOwn(value, "hsonSchema")) {
        entered = true; data(map).at(["link", "document"]).set('<a "After detachment"/>');
      }
      return freeze(value);
    } });
    let page: LiveMapDocumentLibrary;
    try { page = compose(map, "layout", "page"); }
    finally { Object.defineProperty(Object, "freeze", descriptor); }
    assert.equal(entered, true); assert.match(page.render(), /Home/); assert.doesNotMatch(page.render(), /After detachment/);
    assert.equal(data(map).snap(["link", "document"]), '<a "After detachment"/>'); assert.equal(map.rev, 2);
  });
  check("late topology reentrancy retains ordinary authority staleness and the completed inner transition", () => {
    const map = fixture(), descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    let entered = false;
    Object.defineProperty(Object.prototype, "toJSON", { configurable: true, value(this: unknown) {
      if (!entered && typeof this === "object" && this !== null && Reflect.get(this, "kind") === "library-add") {
        entered = true; data(map).at(["link", "document"]).set('<a "After detachment"/>');
      }
      return this;
    } });
    try { assert.throws(() => compose(map, "layout", "page"), /Prepared.*revisions|stale/); }
    finally { if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, "toJSON"); else Object.defineProperty(Object.prototype, "toJSON", descriptor); }
    assert.equal(entered, true); assert.throws(() => map.lib("page")); assert.equal(map.rev, 1);
    assert.equal(data(map).snap(["link", "document"]), '<a "After detachment"/>');
  });
  check("a completed inner receiving composition survives outer candidate identity-allocation rejection", () => {
    const map = fixture(), aggregate = owner(map); let entered = false, after: ReturnType<LiveMap["capture"]> | undefined;
    set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, () => {
      if (!entered) { entered = true; compose(map, "layout", "inner", { configuration: { as: "innerRoot" } }); after = map.capture(); }
      return mint_hson_node_quid();
    });
    try { assert.throws(() => compose(map, "layout", "outer", { configuration: { as: "outerRoot" } })); }
    finally { set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, undefined); }
    assert.equal(entered, true); assert.ok(lookup(doc(map, "inner"), "innerRoot")); assert.throws(() => map.lib("outer"));
    assert.deepEqual(map.capture(), after); assert.equal(map.rev, 1);
  });
}
