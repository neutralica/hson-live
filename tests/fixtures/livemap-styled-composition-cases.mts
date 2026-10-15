import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { part_collection_definition_internal as collection } from "../../src/api/livemap/livemap.parts.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { document_css_subject_identities } from "../../src/internal/css/css-identity-translation.ts";
import { make_portable_aggregate_commit, type HostedAggregateCommit } from "../../src/api/livemap/livemap.hosted.ts";
import { durable_aggregate_commit } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { parse_part_stylesheet } from "../../src/internal/css/part-stylesheet.ts";
import { parse_document_stylesheet } from "../../src/internal/css/parse-document-stylesheet.ts";
import { read_livemap_part_internal as readPart } from "../../src/api/livemap/livemap.libraries.ts";
import { parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { expand_document_composition, document_composition_options } from "../../src/api/livemap/livemap.document.composition.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type { LiveMap, LiveMapDocumentLibrary, LiveMapDocumentCommitTarget } from "../../src/types/livemap.types.ts";
const part = (document: string, css: string) => ({ kind: "document", document, css });
function page(map: LiveMap): LiveMapDocumentLibrary { const value = map.lib("page"); if (value.mode !== "document") throw Error("document"); return value; }
function identity(map: LiveMap) { return owner(map).libraries()[owner(map).hostedRegistry().libraries.findIndex(entry => entry.name === "page")]!; }
function atomic(map: LiveMap, run: () => unknown, reason?: RegExp) {
  const before = map.capture(), ledger = owner(map).identityEpoch().issued(); let events = 0;
  const off = map.commits.observe(() => events++);
  try { if (reason) assert.throws(run, reason); else assert.throws(run); } finally { off(); }
  assert.deepEqual(map.capture(), before); assert.equal(owner(map).identityEpoch().issued(), ledger); assert.equal(events, 0);
}
export function styled_fixture(count = 3) {
  const connectors = Array.from({ length: count }, (_, i) => `<hson-part ${i < 2 ? `@:slot${i}` : ""} lib="parts" at="button" id="instance${i}"/>`).join(" ");
  return hsonLiveMap.fromLibraries({ parts: collection({ button: part('<section @:root id="%{id}" <span @:label class="label" "Label"/> <i @:unused/> <hson-part at="child" label="%{id}"/>/>',
    'section{border:3px solid rgb(1,2,3);--tone:rgb(10,20,30)} span{color:var(--tone);@media screen{padding-left:7px}} @layer buttons{@supports(display:grid){section{button{color:rgb(60,70,80);&.active{padding-left:11px}}}}}'), child: part('<button id="%{label}-button" class="active" "Nested"/>', '') }),
    page: { document: `<html <head/> <body <main ${connectors}/> <aside id="unrelated" <span class="label" "Unrelated"/> <button class="active" id="outside-button" "Outside"/>/>/>/>` } });
}
/** Shared by Node/Worker admission and JavaScript-disabled real Chrome assertions. */
export function selector_fixture() {
  return hsonLiveMap.fromLibraries({ parts: collection({
    bare: part('<button id="%{id}" class="bare" "Bare"/>', 'button{color:rgb(10,20,30);padding-left:13px}:is(button,.other){border-top:2px solid rgb(1,2,3)}button::before{content:"ok"}button,#never{padding-right:22px}.bare{padding-right:24px}'),
    ancestor: part('<section id="%{id}" class="a" <button id="%{id}-child" class="b" "Child"/> <div class="local" <button id="%{id}-deep" class="deep" "Deep"/>/> <hson-part at="leaf" id="%{id}-nested"/>/>',
      'section{border-top:5px solid rgb(1,2,3)}section button{color:rgb(40,50,60)}button{margin-left:17px}' +
      '.a{button{padding-left:14px}.b{border-top:4px solid rgb(4,5,6)}button,&>.b{padding-right:15px}&>.b,button{margin-top:16px}' +
      '.local,.unused{button,.unused{word-spacing:6px}}}' +
      '@media screen{.a{@supports(display:grid){button{padding-bottom:18px}.b,&>.b{padding-top:19px}}}}' +
      '.a,#never{.b{margin-right:23px}}.a .b{margin-right:1px}' +
      '@scope (.local){div{border-top:7px solid rgb(7,8,9)}div button{letter-spacing:3px}}'),
    leaf: part('<button id="%{id}" "Nested"/>', ''),
    sibling: part('<section id="sibling" class="a" <button id="sibling-child" class="b" "Sibling"/>/>', 'section{border-top:8px solid rgb(8,9,10)}section button{color:rgb(70,80,90);padding-left:21px}'),
    explicit: part('<button id="explicit" "Explicit"/>', '&{color:rgb(70,80,90);padding-left:19px}'),
  }), page: { document: '<html <head/> <body <main <hson-part lib="parts" at="bare" id="bare0"/> <hson-part lib="parts" at="bare" id="bare1"/> <hson-part @:ancestor lib="parts" at="ancestor" id="ancestor"/> <hson-part lib="parts" at="sibling"/> <hson-part lib="parts" at="explicit"/>/> <section id="outside-section" class="a" <button id="outside" class="b" "Outside"/>/>/>/>' } });
}
/** Equivalent replacements and colon-bearing nesting share the Chrome/Worker fixture. */
export function second_repair_fixture() {
  const map=hsonLiveMap.fromLibraries({parts:collection({
    equivalent:part('<button id="%{id}"/>','button{color:rgb(10,20,30);padding-left:13px}'),
    colon:part('<section id="%{id}" class="colon" <button id="%{id}-button" class="b" "Child"/>/>',
      'section{button:is(.b){color:rgb(10,20,30);margin-right:23px}button:not(.x){padding-left:13px}button:first-child{border-top:5px solid rgb(1,2,3)}button::before{content:"hello"}' +
      'button:is(.b),&>.b{padding-right:17px}&>.b,button:is(.b){margin-left:19px}}section button{margin-right:1px}' +
      '@layer colon{@media screen{section{@supports(display:grid){button:is(.b){letter-spacing:3px}}}}}'),
    sibling:part('<section id="colon-sibling" class="colon" <button id="colon-sibling-button" class="b" "Sibling"/>/>','button{color:rgb(70,80,90);padding-left:21px}'),
  }),page:{document:'<html <head/> <body <main <button id="equivalent0"/> <button @:eq1 id="equivalent1"/> <button id="equivalent2"/> <button @:eq3 id="equivalent3"/> <hson-part lib="parts" at="colon" id="colon0"/> <hson-part lib="parts" at="colon" id="colon1"/> <hson-part lib="parts" at="sibling"/>/> <section class="colon" <button id="colon-outside" class="b" "Outside"/>/>/>/>'}});
  const p=page(map),before=p.root();
  for(let index=0;index<4;index++) {
    const replacement=hsonTransform.fromHson(`<hson-part lib="parts" at="equivalent" id="equivalent${index}"/>`).toNode().$_content[0];if(!is_Node(replacement))throw Error("connector");
    const lineage=index%2?[{source:path([]),destination:path([])}]:[];
    const target:LiveMapDocumentCommitTarget={kind:"path",path:path([0,0,1,0,0,0])};
    const result=index<2?p.document.content.replace(target,index,replacement,lineage)
      :map.batch(draft=>draft.lib("page").graph({domain:"graph",op:"replace-content",target,index,replacement,lineage}));
    assert.equal(result.changed,true);assert.equal(result.rev,index+1);assert.deepEqual(p.root(),before);
  }
  return map;
}
export function styled_composition_cases(check: (name: string, run: () => void) => void) {
  check("colon-bearing implicit nesting equals explicit nesting in either list order and preserves declaration serialization", () => {
    for(const selector of ['button:is(.b)','button:not(.x)','button:first-child','button::before','button:is(.b),&>.b','&>.b,button:is(.b)']) {
      const explicit=selector.split(',').map(item=>item.startsWith('&')?item:`& ${item}`).join(',');
      const declarations=selector.includes('::before')?'content:"hello"':'color:rgb(10,20,30)';
      assert.deepEqual(parse_part_stylesheet(`section{${selector}{${declarations}}}`),parse_part_stylesheet(`section{${explicit}{${declarations}}}`),selector);
    }
    for(const [implicit,explicit] of [
      ['section{button:is(.b,.c):not([data-note="x:y"]){content:"a:b;{}"}}','section{& button:is(.b,.c):not([data-note="x:y"]){content:"a:b;{}"}}'],
      ['section{button :is(.b){color:red}button /* keep the descendant */ :not(.x){padding:1px}}','section{& button :is(.b){color:red}& button :not(.x){padding:1px}}'],
      ['section{color:red;button:first-child{color:blue}background:green;button::before{content:"hello"}--tail:"x:y"}', 'section{color:red;& button:first-child{color:blue}background:green;& button::before{content:"hello"}--tail:"x:y"}'],
      ['@layer base{@media screen{section{@supports(display:grid){button:is(.b),&>.b{color:red}}}}}', '@layer base{@media screen{section{@supports(display:grid){& button:is(.b),&>.b{color:red}}}}}'],
      ['@container box (width>1px){section{button:not(.x){color:red}}}@starting-style{section{button:is(.b){opacity:0}}}@scope (.local){section{button:first-child{padding:1px}}}',
        '@container box (width>1px){section{& button:not(.x){color:red}}}@starting-style{section{& button:is(.b){opacity:0}}}@scope (.local){section{& button:first-child{padding:1px}}}'],
      [String.raw`section{button\:kind:is(.b){color:red}}`,String.raw`section{& button\:kind:is(.b){color:red}}`],
    ])assert.deepEqual(parse_part_stylesheet(implicit),parse_part_stylesheet(explicit),implicit);
    const declarations=String.raw`section{content:"hello:world;{}";background-image:url("data:image/svg+xml;a:b");--payload:{x:y};--nested:is(.b){color:red};--escaped:"\\\"x:y";color:var(--tone,red)}`;
    assert.deepEqual(parse_part_stylesheet(declarations),parse_document_stylesheet(declarations,[]));
    const invalid:readonly (readonly [string,RegExp])[]=[
      ['section{button:is(.b){color red}}',/Colon is expected/],
      ['section{button:is(.b{color:red}}',/Unmatched Part CSS delimiter/],
      ['section{button:future(.b){color:red}}',/Opaque Part CSS selectors cannot be scoped/],
      ['section{button:is(.b){@scope(.x){button{color:red}}}}',/Nested @scope inside a Part style rule is unsupported/],
      ['section{color:rgb(1,2,{bad})}',/expected|Unexpected input/],
    ];
    const rejected=hsonLiveMap.fromLibraries({});
    for(const [css,reason] of invalid){
      assert.throws(()=>parse_part_stylesheet(css),reason,css);
      atomic(rejected,()=>rejected.addLibraries({parts:collection({x:part('<section <button class="b"/>/>',css)}),page:{document:'<hson-part lib="parts" at="x"/>'}}),reason);
    }
  });
  check("equivalent replacement and colon-bearing nested selectors share source-free scoped ownership", () => {
    const map=second_repair_fixture(),aggregate=owner(map),record=encode_portable_document_stylesheet(aggregate.stylesheet(identity(map)));
    assert.equal(map.rev,4);assert.equal(aggregate.documentOverlay(identity(map)).size,7);
    assert.equal(document_css_subject_identities(record,"outbound").length,7);assert.ok(page(map).q("eq1")!.active);assert.ok(page(map).q("eq3")!.active);
    assert.ok(record.rules.some(rule=>rule.selector.includes('button:is(.b)')));assert.ok(record.rules.some(rule=>rule.selector.includes('button::before')));
    const next=install_libraries_snapshot(map.cut({data:[],documents:["page"]}).libs).map;
    assert.equal(owner(next).documentOverlay(identity(next)).size,7);assert.match(page(next).css.snapshot(),/content:"hello"/);
  });
  check("retained styled coverage: configured cross-collection selection preserves stylesheet preorder and connector/root identity equality", () => {
    const local=(name:string)=>`[hson\\:quad="${name}"]`;
    const map=hsonLiveMap.fromLibraries({parts:collection({
      outer:part('<section @:root <hson-part @:child at="inner"/> <hson-part at="inner"/>/>',`${local("child")}{--parent-selected:yes}section{--order:outer}`),
      inner:part('<button @:root/>',`${local("root")}{--order:inner}`),
    }),other:collection({cross:part('<aside @:root/>',`${local("root")}{--order:cross}`)})});
    const shell=parse_authored_document_library('<main <hson-part @:slot lib="parts" at="outer"/>/>');
    const result=expand_document_composition("shell",()=>({root:shell.root,quads:shell.declarations}),
      document_composition_options({configuration:{at:{slot:{at:{child:{use:{lib:"other",at:"cross"}}}}}}}),(lib,at)=>readPart(map,lib,at));
    assert.deepEqual(result.styles.flatMap(style=>style.css.rules.flatMap(rule=>rule.declarations.filter(([name])=>name==='--order').map(([,value])=>value))),['outer','cross','inner']);
    const parentChild=result.styles[0]!.subjects.find(subject=>subject.name==='child')!,selectedRoot=result.styles[1]!.subjects.find(subject=>subject.name==='root')!;
    assert.deepEqual(parentChild.path,selectedRoot.path);
    // The retained private traversal proves configured stylesheet selection.
    // Admit the same selected topology through ordinary automatic admission to
    // check actual receiving identity reuse without retaining an inert shell.
    map.lib("parts").at(["outer","document"]).set('<section @:root <hson-part @:child lib="other" at="cross"/> <hson-part at="inner"/>/>');
    map.addLibraries({page:{document:'<main <hson-part @:slot lib="parts" at="outer"/>/>'}});
    assert.deepEqual(page(map).root(),result.root);
    const aggregate=owner(map),id=identity(map),record=encode_portable_document_stylesheet(aggregate.stylesheet(id));
    const selectedQuid=aggregate.documentOverlay(id).quidAtPath(path(selectedRoot.path));assert.ok(selectedQuid);
    const parentRule=record.rules.find(rule=>rule.declarations.some(([name])=>name==='--parent-selected'))!,childRule=record.rules.find(rule=>rule.declarations.some(([,value])=>value==='cross'))!;
    assert.equal(parentRule.selector,childRule.selector);assert.ok(parentRule.selector.includes(selectedQuid));
    assert.equal(childRule.scopes[0],`@scope ([hson\\:quid="${selectedQuid}"])`);
    assert.equal(page(map).document.byQuid(selectedQuid)?.$_tag,'aside');assert.equal(aggregate.documentOverlay(id).size,3);
    assert.deepEqual(record.rules.flatMap(rule=>rule.declarations.filter(([name])=>name==='--order').map(([,value])=>value)),['outer','cross','inner']);
  });
  check("implicit type/class nesting and either mixed-list order equal explicit nesting, including nested conditions and declaration order", () => {
    for (const [implicit, explicit] of [
      ['.a{button{color:red}}', '.a{& button{color:red}}'],
      ['.a{.b{color:red}}', '.a{& .b{color:red}}'],
      ['.a{--widget{color:red}}', '.a{& --widget{color:red}}'],
      ['.a{button,&>span{color:red}}', '.a{& button,&>span{color:red}}'],
      ['.a{&>span,button{color:red}}', '.a{&>span,& button{color:red}}'],
      ['.a,#never{.b,.c{button,&>.d{color:red}}}', '.a,#never{& .b,& .c{& button,&>.d{color:red}}}'],
      ['@media screen{.a{@supports(display:grid){button{color:red}.b{padding:1px}}}}', '@media screen{.a{@supports(display:grid){& button{color:red}& .b{padding:1px}}}}'],
      ['.a{color:blue;button{color:red}color:green;.b{padding:1px}background:black}', '.a{color:blue;& button{color:red}color:green;& .b{padding:1px}background:black}'],
      ['.a{--payload:{x:y};button{content:";{}"}--tail:"{}"}', '.a{--payload:{x:y};& button{content:";{}"}--tail:"{}"}'],
    ]) assert.deepEqual(parse_part_stylesheet(implicit), parse_part_stylesheet(explicit), implicit);
    for (const source of ['.a{.b{color red}}', '.a{button{color:red}', '.a{.b{:future(&){color:red}}}', '.a{button{@scope(.x){b{color:red}}}}']) assert.throws(() => parse_part_stylesheet(source), source);
  });
  check("ordinary selectors include anonymous occurrence roots with zero added specificity and retain portable owned teardown", () => {
    let map: LiveMap = selector_fixture();
    const seen = new Set<string>();
    for (let cycle = 0; cycle < 3; cycle++) {
      const aggregate = owner(map), p = page(map), record = encode_portable_document_stylesheet(aggregate.stylesheet(identity(map)));
      const ids = document_css_subject_identities(record, "outbound"); assert.equal(ids.length, 5);
      for (const id of ids) { assert.equal(seen.has(id), false); seen.add(id); }
      assert.equal(aggregate.documentOverlay(identity(map)).size, 5); assert.equal(p.q("part_root"), undefined);
      assert.ok(record.rules.some(rule => rule.selector === 'button:where(:scope,:scope *)'));
      assert.ok(record.rules.some(rule => rule.selector === 'section:where(:scope,:scope *) button'));
      assert.ok(record.rules.some(rule => rule.selector === 'button:where(:scope,:scope *)::before'));
      assert.ok(record.rules.some(rule => rule.selector.includes(':is(.a,#never):where(:scope,:scope *) .b')));
      assert.ok(record.rules.every(rule => rule.scopes[0]!.startsWith('@scope ([hson\\:quid=')));
      const css = p.css.snapshot(), root = p.q("ancestor")!, old = root.path();
      p.document.content.move({ kind: "path", path: [0, 0, 1, 0, 0, 0] }, 2, 0);
      assert.notDeepEqual(root.path(), old); assert.equal(p.css.snapshot(), css);
      p.document.content.move({ kind: "path", path: [0, 0, 1, 0, 0, 0] }, 0, 2);
      const next = install_libraries_snapshot(map.cut({ data: [], documents: ["page"] }).libs).map;
      root.delete(); assert.doesNotMatch(p.css.snapshot(), /padding-bottom:18px/);
      assert.equal(aggregate.documentOverlay(identity(map)).size, 4);
      assert.match(p.css.snapshot(), /padding-left:13px/); assert.match(p.css.snapshot(), /padding-left:21px/);
      map = next;
    }
  });
  check("styled occurrences use distinct roots without requiring or promoting local QUADs", () => {
    const map = styled_fixture(), aggregate = owner(map), id = identity(map), p = page(map);
    assert.equal(aggregate.documentOverlay(id).size, 3);
    const record = encode_portable_document_stylesheet(aggregate.stylesheet(id));
    assert.equal(document_css_subject_identities(record, "outbound").length, 3);
    assert.equal(new Set(record.order.map(entry => entry.owner)).size, 3);
    assert.ok(p.q("slot0")); assert.ok(p.q("slot1")); assert.equal(p.q("root"), undefined); assert.equal(p.q("label"), undefined);
    const ledger = aggregate.identityEpoch().issued();
    allocator(aggregate.identityEpoch().owner, () => { throw Error("read allocated"); });
    try { p.render(); map.capture(); map.cut({ documents: ["page"], data: [], html: "page" }); } finally { allocator(aggregate.identityEpoch().owner, undefined); }
    assert.equal(aggregate.identityEpoch().issued(), ledger);
    const anonymous = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<button/>', 'button{color:red}') }), page: { document: '<hson-part lib="parts" at="x"/>' } });
    assert.equal(owner(anonymous).documentOverlay(identity(anonymous)).size, 1); assert.equal(page(anonymous).q("root"), undefined);
  });
  check("nested CSS, selector lists, conditions, layers and supported globals retain owned structure", () => {
    const css = '@layer base{button,.active{color:red;&:is(:hover,:focus),span{color:blue}@supports(display:grid){padding:1px}}}@container box (width>1px){button{margin-left:2px}}@scope (.local) to (.stop){button{margin-right:3px}}@starting-style{button{opacity:0}}@keyframes once{from{opacity:0}to{opacity:1}}@property --tone{syntax:"*";inherits:false}';
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<section <button/>/>', css) }), page: { document: '<hson-part lib="parts" at="x"/>' } });
    const record = encode_portable_document_stylesheet(owner(map).stylesheet(identity(map)));
    assert.equal(record.properties.length, 1); assert.equal(record.keyframes.length, 1);
    assert.ok(record.rules.some(rule => rule.selector.includes(':is(button,.active)')));
    assert.ok(record.rules.every(rule => rule.scopes[0]!.startsWith('@scope ([hson\\:quid=')));
    for (const name of ["@supports", "@container", "@scope (.local)", "@starting-style"]) assert.ok(record.rules.some(rule => rule.scopes.some(scope => scope.startsWith(name))));
    page(map).document.content.remove({ kind: "path", path: [] }, 0); assert.equal(page(map).css.snapshot(), "");
    for (const css of ['@import "x";', '@font-face{font-family:x;src:url(x)}', '@layer a,b;', 'a{:future(&){color:red}}', 'a{@scope (.x){b{color:red}}}', 'a{color:red']) assert.throws(() => parse_part_stylesheet(css));
  });
  check("local root and descendant CSS identity references share the occurrence scope without alias collisions", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<section @:root <button @:child/>/>', '[hson\\:quad="root"]{padding:1px}[hson\\:quad="child"]{color:red}') }),
      page: { document: '<main <hson-part lib="parts" at="x"/> <hson-part lib="parts" at="x"/>/>' } });
    assert.equal(owner(map).documentOverlay(identity(map)).size, 4);
    assert.equal(page(map).q("root"), undefined); assert.equal(page(map).q("child"), undefined);
    assert.equal(install_libraries_snapshot(map.cut({ documents: ["page"], data: [] }).libs).map.lib("page").mode, "document");
    const invalid = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<p/>', '[hson\\:quad="absent"]{color:red}') }) });
    atomic(invalid, () => invalid.addLibraries({ bad: { document: '<hson-part lib="parts" at="x"/>' } }), /subject/);
  });
  check("replacing an occurrence retires its old globals before admitting the new contribution", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<section <button/>/>', 'button{color:red}@keyframes owned{from{opacity:0}}') }),
      page: { document: '<main <hson-part lib="parts" at="x"/>/>' } });
    const prior = document_css_subject_identities(encode_portable_document_stylesheet(owner(map).stylesheet(identity(map))), "outbound")[0]!;
    const connector = hsonTransform.fromHson('<hson-part lib="parts" at="x"/>').toNode().$_content[0]; if (!is_Node(connector)) throw Error("connector");
    page(map).document.content.replace({ kind: "path", path: [0, 0] }, 0, connector);
    assert.doesNotMatch(page(map).css.snapshot(), new RegExp(prior));
    assert.equal(encode_portable_document_stylesheet(owner(map).stylesheet(identity(map))).keyframes.length, 1);
    atomic(map, () => page(map).css.keyframes.set({ name: "owned", steps: { from: { opacity: "1" } } }), /conflict/);
  });
  check("failed realized Schema checks and identity-only reentrancy never publish the outer candidate", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<button/>', 'button{color:red}') }), page: { document: '<aside/>' } });
    atomic(map, () => map.addLibraries({ bad: { document: '<main <hson-part lib="parts" at="x"/>/>', schema: Hson.schema`<type "document" tag "main" content "empty">` } }));
    let entered = false; const aggregate = owner(map);
    allocator(aggregate.identityEpoch().owner, () => {
      if (!entered) { entered = true; aggregate.acquireLocalDocumentIdentity(identity(map), path([0]), "987654321"); }
      return "123456789";
    });
    try { assert.throws(() => map.addLibraries({ bad: { document: '<hson-part lib="parts" at="x"/>' } }), /changed/); }
    finally { allocator(aggregate.identityEpoch().owner, undefined); }
    assert.equal(aggregate.identityEpoch().issued().size, 1); assert.equal(aggregate.documentOverlay(identity(map)).quidAtPath(path([0])), "987654321"); assert.throws(() => map.lib("bad"));
  });
  check("styled local topology remains rejected by incremental portable and durable codecs", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<button/>', 'button{color:red}') }) });
    let commit: HostedAggregateCommit | undefined; const off = owner(map).observe(value => { commit = value.hosted; });
    try { map.addLibraries({ page: { document: '<hson-part lib="parts" at="x"/>' } }); } finally { off(); }
    assert.ok(commit); assert.throws(() => make_portable_aggregate_commit(commit!), /subject-owned CSS/);
    assert.throws(() => durable_aggregate_commit(commit!, [{ name: "page", ownership: "shared" }]), /subject-owned CSS/);
  });
  check("moving roots retains style; nested owned contributions retire atomically with their parent", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ outer: part('<section <hson-part at="inner"/>/>', 'button{color:red}'), inner: part('<button/>', '&{padding:7px}') }),
      page: { document: '<main <hson-part @:first lib="parts" at="outer"/> <hson-part @:second lib="parts" at="outer"/>/>' } });
    const p = page(map), first = p.q("first")!, second = p.q("second")!, css = p.css.snapshot(), old = first.path();
    p.document.content.move({ kind: "path", path: [0, 0] }, 0, 1);
    assert.notDeepEqual(first.path(), old); assert.equal(p.css.snapshot(), css);
    let seen = 0; const off = map.commits.observe(() => { seen++; assert.equal(document_css_subject_identities(encode_portable_document_stylesheet(owner(map).stylesheet(identity(map))), "outbound").length, 2); });
    try { first.delete(); } finally { off(); }
    assert.equal(seen, 1); assert.equal(p.q("first"), undefined); assert.ok(p.q("second"));
    assert.equal(owner(map).documentOverlay(identity(map)).size, 2);
    assert.equal(encode_portable_document_stylesheet(owner(map).stylesheet(identity(map))).rules.length, 2);
  });
  check("independent authored subject CSS retains strict unsafe-retirement rejection", () => {
    const map = styled_fixture(1), p = page(map), quad = p.q("slot0")!;
    const quid = owner(map).documentQuad(identity(map), "slot0", undefined)!.quid;
    p.css.sel(`[hson\\:quid="${quid}"]`).setProp("color", "red");
    atomic(map, () => quad.delete());
    p.css.clearAll(); quad.delete(); assert.equal(owner(map).documentOverlay(identity(map)).size, 0);
  });
  check("runtime styled insertion, removal and portable A to B to C preserve ownership without sources", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<section <button/>/>', 'button{color:red}') }), page: { document: '<html <head/> <body <i/>/>/>' } });
    const connector = hsonTransform.fromHson('<hson-part lib="parts" at="x"/>').toNode().$_content[0]; if (!is_Node(connector)) throw Error("connector");
    page(map).document.content.insert({ kind: "path", path: [0, 0, 1, 0] }, 1, connector);
    let previous: LiveMap = map; const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const current = i === 0 ? previous : install_libraries_snapshot(previous.cut({ data: [], documents: ["page"] }).libs).map;
      const ids = document_css_subject_identities(encode_portable_document_stylesheet(owner(current).stylesheet(identity(current))), "outbound");
      assert.equal(ids.length, 1); assert.equal(seen.has(ids[0]!), false); seen.add(ids[0]!);
      assert.match(page(current).render(), /color:red/); assert.doesNotMatch(JSON.stringify(page(current).root()), /hson-part/);
      if (i) assert.throws(() => current.lib("parts")); previous = current;
    }
    page(previous).document.content.remove({ kind: "path", path: [0, 0, 1, 0] }, 1);
    assert.equal(page(previous).css.snapshot(), ""); assert.equal(owner(previous).documentOverlay(identity(previous)).size, 0);
    assert.equal(install_libraries_snapshot(previous.capture()).map.lib("page").mode, "document");
  });
  check("global conflicts, exhausted allocation and reentrant inner work reject the outer candidate", () => {
    for (const global of ['@keyframes repeated{from{opacity:0}}', '@property --repeated{syntax:"*";inherits:false}']) {
      const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<p/>', `p{color:red}${global}`) }) });
      let allocations = 0; allocator(owner(map).identityEpoch().owner, () => { allocations++; throw Error("unexpected allocation"); });
      try { atomic(map, () => map.addLibraries({ bad: { document: '<main <hson-part lib="parts" at="x"/> <hson-part lib="parts" at="x"/>/>' } }), /Duplicate @/); }
      finally { allocator(owner(map).identityEpoch().owner, undefined); }
      assert.equal(allocations, 0);
    }
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<p/>', 'p{color:red}') }), state: { data: { count: 0 } } });
    allocator(owner(map).identityEpoch().owner, () => "invalid");
    try { atomic(map, () => map.addLibraries({ bad: { document: '<hson-part lib="parts" at="x"/>' } }), /QUID/); }
    finally { allocator(owner(map).identityEpoch().owner, undefined); }
    let inner = false;
    allocator(owner(map).identityEpoch().owner, () => { if (!inner) { inner = true; const state = map.lib("state"); state.at(["count"]).set(1); } return "123456789"; });
    try { assert.throws(() => map.addLibraries({ bad: { document: '<hson-part lib="parts" at="x"/>' } }), /changed/); }
    finally { allocator(owner(map).identityEpoch().owner, undefined); }
    assert.equal(map.lib("state").at(["count"]).snap(), 1); assert.throws(() => map.lib("bad"));
    assert.equal(owner(map).identityEpoch().issued().size, 0);
  });
  check("retained styled coverage: escaped identity syntax literals supports tests and preorder contributions survive restoration", () => {
    const local=(name:string)=>`[hson\\:quad="${name}"]`;
    const map=hsonLiveMap.fromLibraries({parts:collection({outer:part('<section @:root <hson-part @:child at="inner"/>/>',
      String.raw`[hson\3a quad="root"]:has(>${local("child")}),${local("child")}:not([data-look="hson:quid"]){--literal:"hson:quad"}@supports selector([hson\:quad="syntaxOnly"]){${local("root")}{--order:outer}}`),
      inner:part('<button @:root/>',`${local("root")}{--order:inner}`),unused:part('<p/>','p{--order:UNVISITED}') }),
      page:{document:'<main <hson-part lib="parts" at="outer"/> <hson-part lib="parts" at="outer"/>/>'}});
    const record=encode_portable_document_stylesheet(owner(map).stylesheet(identity(map)));
    assert.equal(document_css_subject_identities(record,"outbound").length,4);
    assert.ok(record.rules.some(rule=>rule.scopes.includes('@supports selector([hson\\:quad="syntaxOnly"])')));
    assert.deepEqual(record.rules[0]!.declarations,[["--literal",'"hson:quad"']]);
    const css=page(map).css.snapshot();assert.ok(css.indexOf('--order:outer')<css.indexOf('--order:inner'));assert.doesNotMatch(css,/UNVISITED/);
    const next=install_libraries_snapshot(map.cut({data:[],documents:["page"]}).libs).map;
    assert.equal(document_css_subject_identities(encode_portable_document_stylesheet(owner(next).stylesheet(identity(next))),"outbound").length,4);
    assert.match(page(next).css.snapshot(),/syntaxOnly/);
    for(const invalid of [local("absent"),'[hson\\:quid="123456789"]','[hson\\:quad]','[hson\\:quad^="label"]','[hson\\:quad="label" i]','[x|hson\\:quad="label"]',':future([hson\\:quad="label"])']) {
      const m=hsonLiveMap.fromLibraries({});
      let calls=0;allocator(owner(m).identityEpoch().owner,()=>{calls++;return "123456789";});
      try{atomic(m,()=>m.addLibraries({parts:collection({x:part('<p @:label/>',invalid+'{color:red}')}),bad:{document:'<hson-part lib="parts" at="x"/>'}}));}finally{allocator(owner(m).identityEpoch().owner,undefined);}
      assert.equal(calls,0);
    }
  });
  check("retained styled coverage: independent rules permit explicit atomic CSS takeover in either graph/CSS order", () => {
    for(const first of [false,true]) {
      const map=styled_fixture(1),p=page(map),quid=owner(map).documentQuad(identity(map),"slot0",undefined)!.quid;
      p.css.sel(`[hson\\:quid="${quid}"]`).setProp('color','red');
      const parent=owner(map).documentQuad(identity(map),"slot0",undefined)!.path.slice(0,-1);let commits=0;
      const off=map.commits.observe(()=>commits++);
      try{map.batch(draft=>{const selected=draft.lib("page");if(selected.mode!=="document")throw Error("document");
        if(first)selected.css.stylesheet('body{color:blue}');
        selected.content.replace({kind:"path",path:path(parent)},0,{$_tag:"i",$_content:[]});
        if(!first)selected.css.stylesheet('body{color:blue}');
      });}finally{off();}
      assert.equal(commits,1);assert.equal(owner(map).documentOverlay(identity(map)).size,0);assert.doesNotMatch(p.css.snapshot(),new RegExp(quid));
    }
  });
}
