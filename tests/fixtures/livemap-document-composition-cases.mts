import assert from "node:assert/strict";
import { realize_document } from "../../src/internal/document-cut.ts";
import { Hson, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { read_livemap_part_internal as readPart, compose_livemap_document_internal as compose,
  prepare_hosted_livemap_library_add_internal as hostedAdd } from "../../src/api/livemap/livemap.libraries.ts";
import { part_collection_definition_internal as collection } from "../../src/api/livemap/livemap.parts.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { lookup_document_quad_internal as lookup, parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { expand_document_composition, document_composition_options, type DocumentCompositionOptions } from "../../src/api/livemap/livemap.document.composition.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { ROOT_TAG, ELEM_TAG, STR_TAG, VAL_TAG } from "../../src/core/constants.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import { mint_hson_node_quid } from "../../src/core/hson-node-quid.ts";
import { overwrite_hson_node } from "../../src/api/livemap/livemap.editor.ts";
import { parse_hson_exact_runtime } from "../../src/internal/exact-runtime-hson-codec.ts";
import { livemap_document_identity_effects_for, type LiveMapDocumentIdentityEffect } from "../../src/api/livemap/livemap.document.identity.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type { LiveMap, LiveMapDocumentLibrary, LiveMapGraphOp } from "../../src/types/livemap.types.ts";
import { styled_composition_cases } from "./livemap-styled-composition-cases.mts";
import { document_css_state_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { document_css_subject_identities } from "../../src/internal/css/css-identity-translation.ts";
import { encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";

export const part = (document: string, css?: string) => ({ kind: "document", document, ...(css === undefined ? {} : { css }) });
export const doc = (map: LiveMap, name = "page"): LiveMapDocumentLibrary => {
  const selected = map.lib(name); if (selected.mode !== "document") throw Error("document"); return selected;
};
export const element = (source: string): HsonNode => {
  const first = hsonTransform.fromHson(source).toNode().$_content[0]; if (!is_Node(first)) throw Error("element"); return first;
};
export function atomic(map: LiveMap, run: () => unknown, reason?: RegExp) {
  const before = map.capture(), aggregate = owner(map), ledger = aggregate.identityEpoch().issued();
  const registry = aggregate.hostedRegistry(), epoch = aggregate.identityEpoch(), position = aggregate.hostedPosition();
  const ids = aggregate.libraries(), roots = ids.map(id => aggregate.root(id));
  const overlays = ids.map((id,index) => registry.libraries[index]?.mode === "document" ? aggregate.documentOverlay(id) : aggregate.projectedOverlay(id));
  let events = 0, positions = 0;
  const off = map.commits.observe(() => events++), stop = aggregate.observeAuthorityPosition(() => positions++);
  try { if (reason) assert.throws(run, reason); else assert.throws(run); } finally { off(); stop(); }
  assert.deepEqual(map.capture(), before); assert.equal(aggregate.identityEpoch().issued(), ledger);
  assert.equal(aggregate.hostedRegistry(), registry); assert.equal(aggregate.identityEpoch(), epoch); assert.deepEqual(aggregate.hostedPosition(), position);
  ids.forEach((id,index) => {
    assert.equal(aggregate.root(id), roots[index]);
    assert.equal(registry.libraries[index]?.mode === "document" ? aggregate.documentOverlay(id) : aggregate.projectedOverlay(id), overlays[index]);
  });
  assert.equal(events, 0); assert.equal(positions, 0);
}
function leaves(root: HsonNode): readonly unknown[] {
  return root.$_tag === STR_TAG || root.$_tag === VAL_TAG ? root.$_content : root.$_content.flatMap(child => is_Node(child) ? leaves(child) : [child]);
}
export function document_composition_cases(check: (name: string, run: () => void) => void) {
  for (const batch of [false, true]) check(`${batch ? "batch" : "direct"} equal Part replacement retires addressed identity and preserves unaddressed no-ops`, () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ plain: part('<button/>'), styled: part('<button/>', 'button{color:red}') }),
      page: { document: '<button @:keep/>' } });
    const page = doc(map), aggregate = owner(map), id = aggregate.libraries()[1]!, old = page.q("keep")!;
    const oldQuid = lookup(page, "keep")!.quid, graph = page.root();
    const replace = (member: string) => {
      const replacement = element(`<hson-part lib="parts" at="${member}"/>`), target = { kind: "path" as const, path: validate_document_path([]) };
      return batch ? map.batch(draft => draft.lib("page").graph({ domain: "graph", op: "replace-content", target, index: 0, replacement }))
        : page.document.content.replace(target, 0, replacement);
    };
    assert.equal(replace("plain").changed, true); assert.equal(old.active, false); assert.equal(page.q("keep"), undefined);
    assert.equal(aggregate.documentOverlay(id).pathForQuid(oldQuid), undefined); assert.deepEqual(page.root(), graph);
    assert.equal(replace("plain").changed, false); assert.equal(map.rev, 1);
    assert.equal(replace("styled").changed, true); assert.equal(map.rev, 2); assert.match(page.css.snapshot(), /color:red/);
    const styledQuid = aggregate.documentOverlay(id).quidAtPath(validate_document_path([0]))!;
    assert.ok(styledQuid); assert.notEqual(styledQuid, oldQuid); assert.deepEqual(page.root(), graph);
    assert.equal(replace("plain").changed, true); assert.equal(map.rev, 3); assert.equal(page.css.snapshot(), "");
    assert.equal(aggregate.documentOverlay(id).pathForQuid(styledQuid), undefined); assert.deepEqual(page.root(), graph);
    assert.ok(aggregate.identityEpoch().issued().has(oldQuid)); assert.ok(aggregate.identityEpoch().issued().has(styledQuid));
  });
  check("Part replacement retires its old QUAD while retaining independent ancestor CSS", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ styled: part('<button/>', 'button{color:red}') }),
      page: { document: '<main @:ancestor <button @:keep/>/>' } });
    const page = doc(map), ancestor = page.q("ancestor")!, old = page.q("keep")!, quid = lookup(page, "ancestor")!.quid;
    page.css.sel(`[hson\\:quid="${quid}"]`).setProp("border-top", "5px solid red");
    page.document.content.replace({ kind: "path", path: [0, 0] }, 0, element('<hson-part lib="parts" at="styled"/>'));
    assert.equal(old.active, false); assert.equal(ancestor.active, true); assert.match(page.css.snapshot(), /color:red/);
    assert.match(page.css.snapshot(), /border-top:5px solid red/);
    ancestor.at([0]).delete();
    assert.doesNotMatch(page.css.snapshot(), /color:red/); assert.match(page.css.snapshot(), /border-top:5px solid red/);
    atomic(map, () => ancestor.delete());
  });



  for (const batch of [false,true]) check(`${batch ? "batch graph" : "direct"} graph-equivalent Part effects fail atomically and retain reentrant inner work`, () => {
    const fixture=(extraCss='')=>hsonLiveMap.fromLibraries({parts:collection({x:part('<button/>',`button{color:red}${extraCss}`)}),state:{data:{n:0}},page:{document:'<button/>'}});
    const replace=(map:LiveMap)=>{
      const replacement=element('<hson-part lib="parts" at="x"/>');
      return batch?map.batch(draft=>{const selected=draft.lib("page");if(selected.mode!=="document")throw Error("document");return selected.graph({domain:"graph",op:"replace-content",target:{kind:"path",path:validate_document_path([])},index:0,replacement});})
        :doc(map).document.content.replace({kind:"path",path:[]},0,replacement);
    };
    const exhausted=fixture();allocator(owner(exhausted).identityEpoch().owner,()=>"invalid");
    try{atomic(exhausted,()=>replace(exhausted),/No available destination QUID for Part CSS subject/);}finally{allocator(owner(exhausted).identityEpoch().owner,undefined);}
    const conflict=fixture('@keyframes clash{from{opacity:0}}');doc(conflict).css.stylesheet('@keyframes clash{from{opacity:1}}');let calls=0;
    allocator(owner(conflict).identityEpoch().owner,()=>{calls++;return "123456789";});
    try{atomic(conflict,()=>replace(conflict),/Duplicate @keyframes/);}finally{allocator(owner(conflict).identityEpoch().owner,undefined);}assert.equal(calls,0);
    const managed=fixture(),manager={};owner(managed).claimManagement(manager);
    try{atomic(managed,()=>replace(managed),batch?/batch is unavailable while this map is managed/:/exclusive Locus authority/);}finally{owner(managed).releaseManagement(manager);}
    const reentrant=fixture(),beforeGraph=doc(reentrant).root();let entered=false,after:ReturnType<LiveMap["capture"]>|undefined,commits=0;
    const off=reentrant.commits.observe(()=>commits++);
    allocator(owner(reentrant).identityEpoch().owner,()=>{if(!entered){entered=true;reentrant.lib("state").at(["n"]).set(1);after=reentrant.capture();}return "123456789";});
    try{assert.throws(()=>replace(reentrant),/changed during capture/);}finally{allocator(owner(reentrant).identityEpoch().owner,undefined);off();}
    assert.equal(entered,true);assert.deepEqual(reentrant.capture(),after);assert.deepEqual(doc(reentrant).root(),beforeGraph);assert.equal(doc(reentrant).css.snapshot(),"");
    assert.equal(reentrant.rev,1);assert.equal(commits,1);assert.equal(owner(reentrant).identityEpoch().issued().size,0);
  });

  check("Part collections are inert; authored documents eagerly realize nested exact coordinates", () => {
    const key = 'n/a "& 雪', lib = 'p/art 雪';
    const map = hsonLiveMap.fromLibraries({
      [lib]: collection({ [key]: part('<nav @:local <hson-part at="leaf" value="%{value}"/>/>'), leaf: part('<button @:local "%{value}"/>'),
        missing: part('<p <hson-part lib="absent" at="x"/>/>') }),
      page: { document: `<main @:page <hson-part @:first lib=${JSON.stringify(lib)} at=${JSON.stringify(key)} value="one"/> <hson-part lib=${JSON.stringify(lib)} at=${JSON.stringify(key)} value="two"/>/>` },
    });
    const page = doc(map), first = page.q("first")!;
    assert.deepEqual(leaves(page.root()), ["one", "two"]); assert.equal(first.path().at(-1), 0);
    assert.doesNotMatch(JSON.stringify(page.root()), /hson-part/);
    assert.equal(page.q("local"), undefined); assert.ok(page.q("page")); assert.equal("source" in page, false);
    assert.equal("template" in map, false); assert.equal("compose" in map, false);
    const before = page.root(), ledger = owner(map).identityEpoch().issued();
    const parts = map.lib(lib);
    parts.at(["leaf", "document"]).set('<i "edited definition"/>');
    assert.deepEqual(page.root(), before); assert.equal(owner(map).identityEpoch().issued().size, ledger.size);
    const scoped = owner(map).scopedDocumentState(owner(map).libraries()[1]!);
    assert.deepEqual(leaves(scoped.root), ["one", "two"]);
    assert.equal(scoped.scopes.occurrences.length, 4);
    // Complete initial scopes cannot silently fall back to the flat public cut.
    assert.throws(() => map.cut({ documents: ["page"], data: [] }), /Echo\/checkpoint/);
  });
  check("native template remains an ordinary native template, separate from construction connectors", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main <template <p "Kept"/>/>/>' } });
    assert.match(doc(map).render(), /<template><p>Kept<\/p><\/template>/);
    assert.doesNotMatch(JSON.stringify(doc(map).root()), /hson-part/);
  });
  check("missing and unavailable Parts fail immediately and do not publish a delayed consumer", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<p/>') }) });
    for (const connector of ['<hson-part lib="missing" at="x"/>', '<hson-part lib="parts" at="missing"/>', '<hson-part at="x"/>', '<hson-part lib="parts"/>']) {
      atomic(map, () => map.addLibraries({ bad: { document: connector } })); assert.throws(() => map.lib("bad"));
    }
    map.addLibraries({ missing: collection({ x: part('<i/>') }) }); assert.throws(() => map.lib("bad"));
    // One topology candidate resolves definitions regardless of entry order.
    map.addLibraries({ page: { document: '<hson-part lib="later" at="x"/>' }, later: collection({ x: part('<aside/>') }) });
    const realized = doc(map).root().$_content[0]; assert.ok(is_Node(realized)); assert.equal(realized.$_tag, "aside");
  });
  check("parameters preserve whole scalar types, nested forwarding, partial strings and exact escaping", () => {
    for (const value of ['"<& 雪💚', "", 7, true, false, null]) {
      const connector: HsonNode = { $_tag: "hson-part", $_attrs: { lib: "parts", at: "outer", value }, $_content: [] };
      const map = hsonLiveMap.fromLibraries({ parts: collection({
        outer: part('<section title="%{value}" data-note="prefix:%{value}:end" <hson-part at="leaf" value="%{value}"/>/>'),
        leaf: part('<button title="%{value}" "%{value}"/>'),
      }), page: { document: { $_tag: ROOT_TAG, $_content: [connector] } } });
      const root = doc(map).root(), outer = root.$_content[0]; if (!is_Node(outer)) throw Error("outer");
      assert.equal(outer.$_attrs?.title, value); assert.equal(outer.$_attrs?.["data-note"], `prefix:${value}:end`);
      assert.deepEqual(leaves(root), [String(value)]);
      assert.throws(() => doc(map).render(), /Scoped document capture/);
      const html = realize_document(root, ""); assert.doesNotMatch(html, /<雪|<script|hson-part/);
      if (typeof value === "string" && value) { assert.match(html, /&lt;/); assert.match(html, /&amp;/); assert.match(html, /&quot;/); }
    }
  });
  check("parameters reject missing, unknown, malformed, structural and invalid placement inputs atomically", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<p title="%{required}" "%{required}"/>'),
      malformed: part('<p "%{bad.name}"/>'), script: part('<script "%{code}"/>'), handler: part('<p onclick="%{code}"/>') }) });
    for (const source of ['<hson-part lib="parts" at="x"/>', '<hson-part lib="parts" at="x" required="ok" extra="x"/>',
      '<hson-part lib="parts" at="malformed"/>',
      '<hson-part lib="parts" at="x" required="ok" "content"/>', '<hson-part lib="parts" at="script" code="bad"/>', '<hson-part lib="parts" at="handler" code="bad"/>']) atomic(map, () => map.addLibraries({ bad: { document: source } }));
    assert.throws(() => collection({ style: part('<p style="color:%{color}"/>') }));
    const opaque: HsonNode = { $_tag: "hson-part", $_attrs: { lib: "parts", at: "x", style: { color: "red" } }, $_content: [] };
    atomic(map, () => map.addLibraries({ bad: { document: { $_tag: ROOT_TAG, $_content: [opaque] } } }), /parameter/);
  });
  check("ordinary runtime insertion and replacement realize before the first publication", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<section <button "%{value}"/>/>') }), page: { document: '<main <i/>/>' } });
    let seen = 0; const off = map.commits.observe(() => { seen++; assert.doesNotMatch(JSON.stringify(doc(map).root()), /hson-part/); });
    try {
      doc(map).document.content.insert({ kind: "path", path: [0, 0] }, 1, element('<hson-part lib="parts" at="x" value="inserted"/>'));
      assert.deepEqual(leaves(doc(map).root()), ["inserted"]);
      doc(map).document.content.replace({ kind: "path", path: [0, 0] }, 1, element('<hson-part lib="parts" at="x" value="replaced"/>'));
      assert.deepEqual(leaves(doc(map).root()), ["replaced"]);
    } finally { off(); }
    assert.equal(seen, 2);
    atomic(map, () => doc(map).document.content.insert({ kind: "path", path: [0, 0] }, 0, element('<hson-part lib="parts" at="absent"/>')));
  });


  check("reentrant connector input capture rejects the outer edit and preserves accepted inner data work", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<p/>') }), state: { data: { n: 0 } }, page: { document: '<main <i/>/>' } });
    const before = doc(map).root(); let entered = false;
    const connector = new Proxy(element('<hson-part lib="parts" at="x"/>'), { ownKeys(target) {
      if (!entered) { entered = true; map.lib("state").at(["n"]).set(1); }
      return Reflect.ownKeys(target);
    } });
    assert.throws(() => doc(map).document.content.insert({ kind: "path", path: [0, 0] }, 1, connector), /changed/);
    assert.equal(entered, true); assert.equal(map.lib("state").at(["n"]).snap(), 1);
    assert.deepEqual(doc(map).root(), before); assert.equal(map.rev, 1);
  });
  check("batch construction reads coherent final Part definitions in either operation order", () => {
    for (const consumerFirst of [true, false]) {
      const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<p "old"/>') }), page: { document: '<main <i/>/>' } });
      map.batch(draft => {
        const consumer = () => draft.lib("page").content.insert({ kind: "path", path: validate_document_path([0, 0]) }, 1, element('<hson-part lib="parts" at="x"/>'));
        const definition = () => draft.lib("parts").at(["x", "document"]).set('<p "new"/>');
        if (consumerFirst) { consumer(); definition(); } else { definition(); consumer(); }
      });
      assert.deepEqual(leaves(doc(map).root()), ["new"]);
    }
  });
  check("cycles, malformed Part roots, schemas and bounded traversal fail atomically", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<p <hson-part at="y"/>/>'), y: part('<i <hson-part at="x"/>/>') }) });
    atomic(map, () => map.addLibraries({ bad: { document: '<hson-part lib="parts" at="x"/>' } }), /cycle/);
    assert.throws(() => collection({ bad: part('<p/> <q/>') }), /one ordinary/);
    const shell = parse_authored_document_library('<main <hson-part lib="parts" at="x"/>/>');
    assert.throws(() => expand_document_composition("shell", () => ({ root: shell.root }), document_composition_options({ maxDepth: 2 }),
      () => ({ root: parse_authored_document_library('<section <b/>/>').root })), /depth/);
    for (const limits of [{ maxNodes: 1 }, { maxCharacters: 1 }]) assert.throws(() => expand_document_composition("shell", () => ({ root: shell.root }), document_composition_options(limits),
      () => ({ root: parse_authored_document_library('<p/>').root })), /limit/);
    assert.throws(() => document_composition_options({ configuration: { as: "old" } }), /Unknown/);
    assert.equal(document_composition_options({ configuration: { q: "new" } }).configuration?.q, "new");
  });
  check("private structural q promotion remains explicit and the former control fails at every depth", () => {
    const parts = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<section @:body as="authored" <b @:label "Text"/>/>') }) });
    const shell = parse_authored_document_library('<main @:shell <hson-part @:slot lib="parts" at="x"/>/>');
    const result = expand_document_composition("shell", () => ({ root: shell.root, quads: shell.declarations }),
      document_composition_options({ configuration: { at: { slot: { at: { label: { q: "caption" } } } } } }), (lib, at) => readPart(parts, lib, at));
    assert.deepEqual(result.quads?.map(entry => entry.name), ["caption", "shell", "slot"]);
    assert.match(JSON.stringify(result.root), /"as":"authored"/);
    for (const configuration of [{ as: "old" }, { at: { slot: { as: "old" } } }, { at: { slot: { at: { label: { as: "old" } } } } }])
      assert.throws(() => document_composition_options({ configuration }), /Unknown/);
  });
  check("canonical restore is source-free and rejects residual construction instructions", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    const snapshot = structuredClone(map.capture());
    const forged = { ...snapshot, libraries: snapshot.libraries.map(entry => ({ ...entry, root: { ...entry.root, payload: entry.root.payload.replace('main', 'hson-part') } })) };
    assert.throws(() => install_libraries_snapshot(forged));
    assert.equal("source" in snapshot.libraries[0]!, false);
    assert.equal(ELEM_TAG, "_hson_elem");
  });
  styled_composition_cases(check);
  retained_composition_cases(check);
}

// The automatic-admission cut superseded inert-shell fixtures. Keep their
// distinct structural/configuration proofs at the existing private traversal,
// and their authority/Schema proofs at ordinary admission, without a source store.
function retained_composition_cases(check: (name: string, run: () => void) => void) {
  const source = (text: string) => {
    const parsed = text === "" ? { root: { $_tag: ROOT_TAG, $_content: [] }, declarations: [] } : parse_authored_document_library(text);
    return { root: parsed.root, quads: parsed.declarations };
  };
  const definitions = {
    panel: '<section @:panel title="Panel" <h2 @:heading "Default"/> <div @:body <hson-part @:action at="primary"/>/>/>',
    primary: '<button @:button title="Primary" "Go"/>', secondary: '<a @:button title="Secondary" "Alternate"/>',
  };
  const shell = '<main @:page <hson-part @:first lib="parts" at="panel"/> <hson-part @:second lib="parts" at="panel"/> <footer @:tail/>/>';
  const traverse = (text = shell, configuration?: DocumentCompositionOptions["configuration"]) => expand_document_composition("shell", () => source(text),
    document_composition_options(configuration === undefined ? undefined : { configuration }), (lib, at) => {
      const selected = lib === "other" && at === "secondary" ? '<aside @:button title="Other" "Other"/>' : lib === "parts" ? Reflect.get(definitions, at) : undefined;
      if (typeof selected !== "string") throw Error("Unknown Part"); return source(selected);
    });
  check("retained structural coverage: forest coordinates exact cross-collection context and one read per pair", () => {
    const selected = source('<button/>'); let reads = 0;
    const result = expand_document_composition("shell", () => source('"before" <i @:before/> <main @:page <hson-part @:one lib="a/b" at=""/> <hson-part @:two lib="a/b" at=""/> <footer @:tail/>/> <b @:after/> "after"'), document_composition_options(undefined),
      (lib, at) => { assert.equal(lib, "a/b"); assert.equal(at, ""); reads++; return selected; });
    assert.equal(reads, 1);
    assert.deepEqual(result.quads, [{name:"after",path:[3]}, {name:"before",path:[1]}, {name:"one",path:[2,0,0]}, {name:"page",path:[2]}, {name:"tail",path:[2,0,2]}, {name:"two",path:[2,0,1]}]);
    assert.deepEqual(leaves(result.root), ["before", "after"]);
    for (const text of ['', '"" <i/> "text" <b/>', '"left" "right"', '<template <p/>/>']) assert.deepEqual(traverse(text).root, structuredClone(source(text).root));
  });
  check("retained structural coverage: reusable JS HsonData Transform and governed configurations are equivalent", () => {
    const first = { attrs: {title:"First"}, at: { heading: {q:"caption",text:"One"}, body:{at:{action:{use:{at:"secondary"},text:""}}} } };
    const configuration = {at:{first,second:{at:{action:{use:{lib:"other",at:"secondary"},text:"Cross"}}}}};
    const map = hsonLiveMap.fromLibraries({config:{data:configuration}});
    const expected = traverse(shell, configuration), before = JSON.stringify(configuration);
    for (const input of [Hson.data.from(configuration), Hson.data.from(hsonTransform.fromJson(configuration).toJson().value()),
      Hson.data.from(map.lib("config").snap()), JSON.parse(before)]) assert.deepEqual(traverse(shell, input), expected);
    assert.equal(JSON.stringify(configuration), before); assert.deepEqual(leaves(expected.root), ["One", "", "Default", "Cross"]);
    assert.deepEqual(expected.quads?.find(entry => entry.name === "caption")?.path, [0,0,0,0,0]);
    const shared = {at:{heading:{text:"Shared"}}};
    assert.deepEqual(leaves(traverse(shell,{at:{first:shared,second:shared}}).root), ["Shared","Go","Shared","Go"]);
    const hostile = traverse('<main <p @:constructor "First"/> <p @:__proto__ "Second"/>/>', JSON.parse('{"at":{"constructor":{"text":"One"},"__proto__":{"text":"Two"}}}'));
    assert.deepEqual(leaves(hostile.root), ["One","Two"]);
    assert.equal(is_Node(expected.root.$_content[0]) && is_Node(expected.root.$_content[0].$_content[0]) && is_Node(expected.root.$_content[0].$_content[0].$_content[0])
      ? expected.root.$_content[0].$_content[0].$_content[0].$_attrs?.title : undefined,"First");
    assert.equal(traverse(shell,{q:"page",at:{first:{q:"first"}}}).quads?.length,4);
  });
  check("retained structural coverage: exact configuration descriptors recursive scope cardinality and resource limits", () => {
    const cyclic: Record<string,unknown> = {}; cyclic.at = {first:cyclic};
    const accessor = {}; Object.defineProperty(accessor,"q",{enumerable:true,get(){throw Error("getter ran");}});
    const hidden = {}; Object.defineProperty(hidden,"text",{value:""});
    for (const configuration of [null, [], cyclic, accessor, hidden, {text:undefined}, {as:"legacy"},
      {at:{first:{use:{quad:"panel"}}}}, {at:{first:{use:{at:"panel",quad:"panel"}}}}, {at:{first:{use:{lib:"parts"}}}},
      {at:{first:{use:{at:"panel",lib:undefined}}}}, {at:{first:{attrs:{title:false}}}}, {at:{first:{q:false}}},
      {at:{first:{at:{"invalid name":{}}}}}, {at:{first:{at:{heading:{use:{at:"primary"}}}}}},
      {at:{heading:{}}}, {at:{first:{at:{tail:{}}}}}, {at:{first:{at:{body:{at:{heading:{}}}}}}},
      {at:{first:{at:{panel:{at:{panel:{}}}}}}}, {at:{first:{q:"renamed"}}}, {at:{first:{q:"page"}}},
      {q:"bad name"}, {q:""},
      {at:{first:{at:{heading:{q:"duplicate"}}},second:{at:{heading:{q:"duplicate"}}}}}]) {
      assert.throws(() => Reflect.apply(traverse,undefined,[shell,configuration]));
    }
    assert.equal(leaves(traverse(shell,Object.assign(Object.create(null),{at:{first:{at:{heading:{text:"Allowed"}}}}})).root)[0],"Allowed");
    for (const value of ['<p/>', 'garbage', Hson.data.from(null), Hson.data.from([]), Hson.data.from("text")]) assert.throws(() => Reflect.apply(traverse,undefined,[shell,value]));
    for (const key of ["maxDepth","maxNodes","maxCharacters"]) for (const value of [0,-1,1.5,NaN,Infinity,4_000_001]) assert.throws(() => document_composition_options({[key]:value}));
    const excessive: Record<string,unknown> = {}; let current = excessive;
    for (let i=0;i<130;i++) {const child={};current.at={target:child};current=child;}
    assert.throws(() => document_composition_options({configuration:excessive}), /depth/);
    assert.throws(() => document_composition_options({configuration:{text:"x".repeat(4_000_001)}}), /limit/);
    for (const text of ['', '"text"', '<i/> <b/>', '"before" <i/>']) assert.throws(() => traverse(text,{q:"received"}), /exactly one/);
    for(const q of ["constructor","__proto__","Pascal_Name"])assert.deepEqual(traverse('<p/>',{q}).quads,[{name:q,path:[0]}]);
  });
  check("retained structural coverage: root string customization empty text exact HTML SVG and identity stripping", () => {
    for (const configuration of [{}, {attrs:{title:"Changed"}}, {text:""}, {attrs:{title:""},text:"Read"}]) {
      const result = traverse('<p title="Default" "Text"/>',configuration);
      assert.equal(result.root.$_content[0] && is_Node(result.root.$_content[0]) ? result.root.$_content[0].$_attrs?.title : undefined, configuration.attrs?.title ?? "Default");
      assert.deepEqual(leaves(result.root), [configuration.text ?? "Text"]);
    }
    for (const text of ['<p/>','<p <b/>/>','<p "one" "two"/>']) assert.throws(() => traverse(text,{text:""}), /sole immediate/);
    for (const configuration of [{attrs:{missing:"x"}}, {attrs:{style:"color:red"}}]) assert.throws(() => traverse('<p title="Default" "Text"/>',configuration));
    const html = {root:doc(hsonLiveMap.fromLibraries({page:{document:hsonTransform.fromTrustedHtml('<p title="Default">Text</p>').toNode()}})).root()};
    const result = expand_document_composition("html",()=>html,document_composition_options({configuration:{attrs:{title:""},text:""}}),()=>{throw Error("unused");});
    assert.deepEqual(result.root,traverse('<p title="Default" "Text"/>',{attrs:{title:""},text:""}).root);
    const svg = traverse('<svg viewBox="0 0 1 1"/>',{attrs:{viewBox:"0 0 2 2"}});
    assert.match(JSON.stringify(svg.root),/0 0 2 2/);
    const exact = parse_hson_exact_runtime('<main @000009001 <p @000009002 "Text"/>/>',{allowTopLevelDocumentText:true});
    const stripped = expand_document_composition("exact",()=>({root:exact}),document_composition_options(undefined),()=>{throw Error("unused");});
    assert.doesNotMatch(JSON.stringify(stripped.root),/quid|00000900/);
  });
  check("retained admission coverage: direct indirect and cross-collection cycles exact controls and ungoverned sources", () => {
    for (const [a,b] of [['<section <hson-part at="a"/>/>','<aside/>'], ['<section <hson-part at="b"/>/>','<aside <hson-part at="a"/>/>'],
      ['<section <hson-part lib="other" at="b"/>/>','<aside <hson-part lib="parts" at="a"/>/>']]) {
      const map=hsonLiveMap.fromLibraries({parts:collection({a:part(a),b:part(b)}),other:collection({b:part(b)})});
      atomic(map,()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="a"/>'}}),/cycle/);
    }
    const map=hsonLiveMap.fromLibraries({parts:collection({one:part('<p/>')}),ordinary:{data:{one:part('<p/>')}},other:{document:'<p/>'}});
    for(const controls of ['lib="ordinary" at="one"','lib="other" at="one"','LIB="parts" AT="one"','lib="parts" at="One"','lib="parts" quad="one"','lib="" at="one"']) atomic(map,()=>map.addLibraries({bad:{document:`<hson-part ${controls}/>`}}));
    assert.throws(()=>map.addLibraries({bad:{document:'<hson-part lib="parts" lib="other" at="one"/>'}}));
    const privateCycle=source('<section <hson-part @:loop at="safe"/>/>');
    assert.throws(()=>expand_document_composition("shell",()=>source('<hson-part @:slot lib="parts" at="outer"/>'),
      document_composition_options({configuration:{at:{slot:{at:{loop:{use:{at:"outer"}}}}}}}),(_lib,at)=>at==="outer"?privateCycle:source('<p/>')),/cycle/);
  });
  check("retained admission coverage: unselected collection corruption fails before publication and valid Schema remains governing", () => {
    const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<p/>')}),page:{document:'<main/>'}}),aggregate=owner(map);
    const raw=aggregate.root(aggregate.libraries()[0]!), original=map.lib("parts").root();
    const before=map.capture(),ledger=aggregate.identityEpoch().issued(),position=aggregate.hostedPosition();let published=0;
    const stop=map.commits.observe(()=>published++);
    overwrite_hson_node(raw,hsonTransform.fromJson({x:part('<p/>'),late:part('<p')}).toNode());
    try {assert.throws(()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}));}
    finally {overwrite_hson_node(raw,original);stop();}
    assert.deepEqual(map.capture(),before);assert.equal(aggregate.identityEpoch().issued(),ledger);assert.deepEqual(aggregate.hostedPosition(),position);assert.equal(published,0);
    const schema=Hson.schema`<type "document" tag "p" content "empty">`;
    map.addLibraries({valid:{document:'<hson-part lib="parts" at="x"/>',schema}});
    assert.equal(doc(map,"valid").schema.get(),schema);
    atomic(map,()=>doc(map,"valid").document.content.replace({kind:"path",path:[]},0,element('<i/>')));
    map.lib("parts").at(["x","document"]).set('<i/>');
    atomic(map,()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>',schema}}));
  });
  check("retained authority coverage: prepared discard stale reuse exclusive management and both incomplete identity phases", () => {
    const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<p/>')}),page:{document:'<main/>'}}),aggregate=owner(map),manager={};
    aggregate.claimManagement(manager);
    try {
      atomic(map,()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}),/exclusive/);
      const discarded=hostedAdd(map,manager,{discarded:{document:'<aside/>'}});aggregate.discard(discarded.transition);
      atomic(map,()=>aggregate.accept(discarded.transition,"isolate",discarded.afterInstall),/discarded/);
      const stale=hostedAdd(map,manager,{stale:{document:'<i/>'}}),accepted=hostedAdd(map,manager,{accepted:{document:'<footer/>'}});
      aggregate.accept(accepted.transition,"isolate",accepted.afterInstall);
      atomic(map,()=>aggregate.accept(accepted.transition,"isolate",accepted.afterInstall),/already accepted/);
      atomic(map,()=>aggregate.accept(stale.transition,"isolate",stale.afterInstall),/stale/);
    } finally {aggregate.releaseManagement(manager);}
    for(const phase of ["preflight","realize"]) {
      let entered=false;const attempt=()=>{entered=true;map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}});};
      atomic(map,()=>aggregate.acquireLocalDocumentIdentity(aggregate.libraries()[1]!,validate_document_path([0]),mint_hson_node_quid(),{
        preflight(){if(phase==="preflight")attempt();return{apply(){},rollback(){},release(){}};},realize(){if(phase==="realize")attempt();},rollbackRealization(){},
      }),/incomplete identity/);assert.equal(entered,true);
    }
    atomic(map,()=>map.batch(()=>{map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}});}),/batch|staged/i);
  });
  check("retained private traversal coverage: current shell landmarks survive moves and retired addresses reject", () => {
    const map=hsonLiveMap.fromLibraries({layout:{document:'<main <p @:heading "Before"/> <aside/>/>'}}),layout=doc(map,"layout");
    layout.document.content.move({kind:"path",path:[0,0]},0,1);
    const result=compose(map,"layout","page",{configuration:{at:{heading:{text:"Moved"}}}});
    assert.deepEqual(lookup(result,"heading")?.path,[0,0,1]);assert.deepEqual(leaves(result.root()),["Moved"]);
    assert.notEqual(lookup(result,"heading")!.quid,lookup(layout,"heading")!.quid);
    const derived=compose(map,"page","derived");assert.deepEqual(derived.root(),result.root());assert.notEqual(lookup(derived,"heading")!.quid,lookup(result,"heading")!.quid);
    layout.document.content.replace({kind:"path",path:[0,0]},1,element('<p/>'));
    atomic(map,()=>compose(map,"layout","bad",{configuration:{at:{heading:{}}}}),/Unknown composition QUAD/);
    layout.css.sel('main').setProp('color','red');atomic(map,()=>compose(map,"layout","bad"),/managed stylesheet/);
  });
  check("retained admission coverage: one complete addition independent inline storage and selected empty/ordering/global CSS", () => {
    for(const css of [undefined,'','@layer first{}@layer second{}','@property --tone{syntax:"*";inherits:false}','@keyframes once{from{opacity:0}}']) {
      const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<a style="color:blue" "Text"/>',css),unused:part('<p/>','p{--unvisited:yes}')})}),aggregate=owner(map);
      const before=map.capture(),root=aggregate.root(aggregate.libraries()[0]!);let commits=0;
      const off=map.commits.observe(()=>{commits++;assert.doesNotMatch(JSON.stringify(doc(map).root()),/hson-part/);});
      try{map.addLibraries({page:{document:'<main <hson-part lib="parts" at="x"/> <hson-part lib="parts" at="x"/>/>'}});}
      catch(error){
        // Global definitions intentionally conflict across occurrences.
        if(css?.startsWith('@property')||css?.startsWith('@keyframes')){assert.match(String(error),/Duplicate @/);assert.equal(commits,0);assert.deepEqual(map.capture(),before);continue;}
        throw error;
      }finally{off();}
      assert.equal(commits,1);assert.equal(map.rev,1);assert.equal(aggregate.root(aggregate.libraries()[0]!),root);
      assert.deepEqual(map.capture().libraries[0],before.libraries[0]);assert.doesNotMatch(doc(map).css.snapshot(),/unvisited/);
      const graph=aggregate.root(aggregate.libraries()[1]!);
      const main=graph.$_content[0];if(!is_Node(main)||!is_Node(main.$_content[0]))throw Error("main");
      const [a,b]=main.$_content[0].$_content;if(!is_Node(a)||!is_Node(b))throw Error("links");
      assert.notEqual(a,b);assert.notEqual(a.$_attrs,b.$_attrs);assert.notEqual(a.$_attrs?.style,b.$_attrs?.style);assert.notEqual(a.$_content,b.$_content);
      doc(map).document.attrs.set({kind:"path",path:[0,0,0]},'title','Edited');assert.equal(doc(map).document.attrs.get({kind:"path",path:[0,0,1]},'title'),undefined);
      if(!css)assert.match(doc(map).render(),/color.*blue/);
      else assert.match(doc(map).css.snapshot(),/@layer first/);
      assert.equal(aggregate.documentOverlay(aggregate.libraries()[1]!).size,css?2:0);
    }
    const structural=hsonLiveMap.fromLibraries({parts:collection({x:part('<section <style "p{color:red}"/>/>')}),page:{document:'<hson-part lib="parts" at="x"/>'}});
    assert.deepEqual(leaves(doc(structural).root()),['p{color:red}']);assert.equal(doc(structural).css.snapshot(),'');
  });
  check("retained authority coverage: configuration reflection and source reads fence every independently accepted inner change", () => {
    for(const phase of ["configuration","source"]) for(const change of ["data","identity","authority","topology"]) {
      const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<p/>')}),page:{document:'<main/>'}}),aggregate=owner(map);
      let entered=false,after:ReturnType<LiveMap["capture"]>|undefined;
      const inner=()=>{entered=true;
        if(change==="data")map.lib("parts").at(["x","document"]).set('<i/>');
        else if(change==="identity")aggregate.acquireLocalDocumentIdentity(aggregate.libraries()[1]!,validate_document_path([0]),mint_hson_node_quid());
        else if(change==="authority")aggregate.setInitialHostedAuthority({...aggregate.hostedPosition().authority});
        else map.addLibraries({inner:{document:'<aside/>'}});
        after=map.capture();
      };
      if(phase==="configuration") {
        const configuration=new Proxy({}, {ownKeys(target){if(!entered)inner();return Reflect.ownKeys(target);}});
        assert.throws(()=>compose(map,"page","bad",{configuration}),/changed during capture/);
      } else {
        const raw=aggregate.root(aggregate.libraries()[0]!),descriptor=Object.getOwnPropertyDescriptor(Reflect,"getOwnPropertyDescriptor")!,original=Reflect.getOwnPropertyDescriptor;
        Object.defineProperty(Reflect,"getOwnPropertyDescriptor",{...descriptor,value(input:object,key:PropertyKey){
          if(!entered&&input===raw&&key==="$_tag")inner();return original(input,key);
        }});
        try{assert.throws(()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}),/changed during capture/);}
        finally{Object.defineProperty(Reflect,"getOwnPropertyDescriptor",descriptor);}
      }
      assert.equal(entered,true);assert.deepEqual(map.capture(),after);assert.throws(()=>map.lib("bad"));
    }
  });
  check("retained authority coverage: detached private candidates keep coherent values and late management/staleness retains inner work", () => {
    const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<p/>')}),page:{document:'<main "Before"/>'}});
    const descriptor=Object.getOwnPropertyDescriptor(Object,"freeze")!,freeze=Object.freeze;let entered=false;
    Object.defineProperty(Object,"freeze",{...descriptor,value<T>(value:T):Readonly<T>{
      if(!entered&&typeof value==="object"&&value!==null&&Reflect.get(value,"name")==="derived"&&Object.hasOwn(value,"hsonSchema")){
        entered=true;map.lib("parts").at(["x","document"]).set('<i/>');
      }return freeze(value);
    }});
    try{assert.deepEqual(leaves(compose(map,"page","derived").root()),["Before"]);}
    finally{Object.defineProperty(Object,"freeze",descriptor);}
    assert.equal(entered,true);assert.equal(map.rev,2);
    for(const management of [true,false]) {
      const m=hsonLiveMap.fromLibraries({parts:collection({x:part('<p/>')})}),aggregate=owner(m),manager={};
      const descriptor=Object.getOwnPropertyDescriptor(Object.prototype,"toJSON");let entered=false;
      Object.defineProperty(Object.prototype,"toJSON",{configurable:true,value(this:unknown){
        if(!entered&&typeof this==="object"&&this!==null&&Reflect.get(this,"kind")==="library-add"){
          entered=true;if(management)aggregate.claimManagement(manager);else m.lib("parts").at(["x","document"]).set('<i/>');
        }return this;
      }});
      try{assert.throws(()=>m.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}),/exclusive|changed|stale|revisions/);}
      finally{if(descriptor===undefined)Reflect.deleteProperty(Object.prototype,"toJSON");else Object.defineProperty(Object.prototype,"toJSON",descriptor);if(management)aggregate.releaseManagement(manager);}
      assert.equal(entered,true);assert.throws(()=>m.lib("bad"));
      assert.equal(m.rev,management?0:1);if(!management)assert.equal(m.lib("parts").at(["x","document"]).snap(),'<i/>');
    }
  });
  check("retained authority coverage: a completed inner styled admission survives outer allocation rejection", () => {
    const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<p/>','p{color:red}')})}),aggregate=owner(map);
    let entered=false,after:ReturnType<LiveMap["capture"]>|undefined;
    allocator(aggregate.identityEpoch().owner,()=>{
      if(!entered){entered=true;map.addLibraries({inner:{document:'<hson-part lib="parts" at="x"/>'}});after=map.capture();}
      return mint_hson_node_quid();
    });
    try{assert.throws(()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}),/changed|stale/);}
    finally{allocator(aggregate.identityEpoch().owner,undefined);}
    assert.equal(entered,true);assert.deepEqual(map.capture(),after);assert.equal(map.rev,1);assert.equal(aggregate.identityEpoch().issued().size,1);
    assert.match(doc(map,"inner").css.snapshot(),/color:red/);assert.throws(()=>map.lib("bad"));
  });
}
