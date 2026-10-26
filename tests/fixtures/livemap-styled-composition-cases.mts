import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { document_css_subject_identities, translate_document_css_identities } from "../../src/internal/css/css-identity-translation.ts";
import { make_portable_aggregate_commit, type HostedAggregateCommit } from "../../src/api/livemap/livemap.hosted.ts";
import { durable_aggregate_commit } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { opaque_document_stylesheet } from "../../src/internal/css/opaque-stylesheet.ts";
import { read_livemap_part_internal as readPart, make_livemap_mirror_from_semantic_checkpoint_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { parse_authored_document_library, document_quad_disposition } from "../../src/api/livemap/livemap.document.quad.ts";
import { expand_document_composition, document_composition_options } from "../../src/api/livemap/livemap.document.composition.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type { LiveMap, LiveMapInput, LiveMapDocumentLibrary, LiveMapDocumentCommitTarget } from "../../src/types/livemap.types.ts";
// Explicitly model historical flat snapshots for the retained flat CSS/SSR tests.
// Dynamic admission now retains scopes; only this fixture discards namespace
// semantics after projecting complete flat subject correspondence.
export function legacy_flat_styled_map(input: LiveMapInput): LiveMap {
  const source = hsonLiveMap.fromLibraries(input), a = owner(source), snapshot = a.captureSemanticCheckpoint();
  const libraries = snapshot.libraries.map((entry, index) => {
    if (entry.scopes === undefined) return entry;
    const id = a.libraries()[index]!, overlay = a.documentOverlay(id);
    const css = encode_portable_document_stylesheet(a.stylesheet(id));
    const quads = a.projectDocumentCorrespondence(id, document_css_subject_identities(css, "outbound"));
    const associations = (quads ?? []).map(item => ({ ...item, quid: overlay.quidAtPath(item.path)!, disposition: document_quad_disposition(item) }));
    return { name: entry.name, root: entry.root, ...(quads === undefined ? {} : { quads }),
      css: translate_document_css_identities(css, "outbound", { associations, assertCurrent() {} }, true) };
  });
  return make_livemap_mirror_from_semantic_checkpoint_internal({ ...snapshot, libraries });
}
const part = (document: string, css: string) => ({ kind: "document" as const, document, stylesheet: css });
function page(map: LiveMap): LiveMapDocumentLibrary { const value = map.doc.must("page"); if (value.mode !== "document") throw Error("document"); return value; }
function identity(map: LiveMap) { return owner(map).libraries()[owner(map).hostedRegistry().libraries.findIndex(entry => entry.name === "page")]!; }
function atomic(map: LiveMap, run: () => unknown, reason?: RegExp) {
  const before = map.capture(), ledger = owner(map).identityEpoch().issued(); let events = 0;
  const off = map.commits.observe(() => events++);
  try { if (reason) assert.throws(run, reason); else assert.throws(run); } finally { off(); }
  assert.deepEqual(map.capture(), before); assert.equal(owner(map).identityEpoch().issued(), ledger); assert.equal(events, 0);
}
const styled_part = (document: string, css: import('../../src/core/style.types.ts').CssMap) => ({kind:'document' as const,document,css});
export function styled_fixture(count = 3) {
  const connectors = Array.from({ length: count }, (_, i) => `<hson-part ${i < 2 ? `@:slot${i}` : ""} lib="parts" at="button" id="instance${i}"/>`).join(" ");
  return legacy_flat_styled_map({ parts: { parts: { button: styled_part('<section @:root id="%{id}" <span @:label class="label" "Label"/> <i @:unused/> <hson-part at="child" label="%{id}"/>/>',
    {border:'3px solid rgb(1,2,3)','--tone':'rgb(10,20,30)','& span':{color:'var(--tone)'},$media:{screen:{'& span':{paddingLeft:'7px'}}},'& button':{color:'rgb(60,70,80)','&.active':{paddingLeft:'11px'}}}),
    child:{kind:'document',document:'<button id="%{label}-button" class="active" "Nested"/>'} } },
    page:{document:`<html <head/> <body <main ${connectors}/> <aside id="unrelated" <span class="label" "Unrelated"/> <button class="active" id="outside-button" "Outside"/>/>/>/>`} });
}
/** Browser scoping oracles use structured authoring; raw text has separate isolation oracles. */
export function selector_fixture() {
  return legacy_flat_styled_map({parts:{parts:{
    bare:styled_part('<button id="%{id}" class="bare" "Bare"/>',{color:'rgb(10,20,30)',paddingLeft:'13px',borderTop:'2px solid rgb(1,2,3)',__before:{content:'"ok"'},paddingRight:'24px'}),
    ancestor:styled_part('<section id="%{id}" class="a" <button id="%{id}-child" class="b" "Child"/> <div class="local" <button id="%{id}-deep" class="deep" "Deep"/>/> <hson-part at="leaf" id="%{id}-nested"/>/>',
      {borderTop:'5px solid rgb(1,2,3)','& button':{color:'rgb(40,50,60)',marginLeft:'17px',paddingLeft:'14px',paddingRight:'15px',marginTop:'16px'},'& .b':{borderTop:'4px solid rgb(4,5,6)',marginRight:'23px'},
        '& .local':{borderTop:'7px solid rgb(7,8,9)'},'& .local button':{wordSpacing:'6px',letterSpacing:'3px'},$media:{screen:{'& button':{paddingBottom:'18px'},'& .b':{paddingTop:'19px'}}}}),
    leaf:{kind:'document',document:'<button id="%{id}" "Nested"/>'},
    sibling:styled_part('<section id="sibling" class="a" <button id="sibling-child" class="b" "Sibling"/>/>',{borderTop:'8px solid rgb(8,9,10)','& button':{color:'rgb(70,80,90)',paddingLeft:'21px'}}),
    explicit:styled_part('<button id="explicit" "Explicit"/>',{color:'rgb(70,80,90)',paddingLeft:'19px'}),
  }},page:{document:'<html <head/> <body <main <hson-part lib="parts" at="bare" id="bare0"/> <hson-part lib="parts" at="bare" id="bare1"/> <hson-part @:ancestor lib="parts" at="ancestor" id="ancestor"/> <hson-part lib="parts" at="sibling"/> <hson-part lib="parts" at="explicit"/>/> <section id="outside-section" class="a" <button id="outside" class="b" "Outside"/>/>/>/>'}});
}
export function second_repair_fixture() {
  const map=legacy_flat_styled_map({parts:{parts:{
    equivalent:styled_part('<button id="%{id}"/>',{color:'rgb(10,20,30)',paddingLeft:'13px'}),
    colon:styled_part('<section id="%{id}" class="colon" <button id="%{id}-button" class="b" "Child"/>/>',
      {'& button:is(.b)':{color:'rgb(10,20,30)',marginRight:'23px',paddingRight:'17px',marginLeft:'19px'},'& button:not(.x)':{paddingLeft:'13px'},'& button:first-child':{borderTop:'5px solid rgb(1,2,3)'},'& button::before':{content:'"hello"'},'& button':{marginRight:'1px'},$media:{screen:{'& button:is(.b)':{letterSpacing:'3px'}}}}),
    sibling:styled_part('<section id="colon-sibling" class="colon" <button id="colon-sibling-button" class="b" "Sibling"/>/>',{'& button':{color:'rgb(70,80,90)',paddingLeft:'21px'}}),
  }},page:{document:'<html <head/> <body <main <button id="equivalent0"/> <button @:eq1 id="equivalent1"/> <button id="equivalent2"/> <button @:eq3 id="equivalent3"/> <hson-part lib="parts" at="colon" id="colon0"/> <hson-part lib="parts" at="colon" id="colon1"/> <hson-part lib="parts" at="sibling"/>/> <section class="colon" <button id="colon-outside" class="b" "Outside"/>/>/>/>'}});
  const p=page(map),before=p.root();
  for(let index=0;index<4;index++) {
    const replacement=hsonTransform.fromHson(`<hson-part lib="parts" at="equivalent" id="equivalent${index}"/>`).toNode().$_content[0];if(!is_Node(replacement))throw Error('connector');
    const target:LiveMapDocumentCommitTarget={kind:'path',path:path([0,0,1,0,0,0])};
    const result=index<2?p.document.content.replace(target,index,replacement):map.batch(w=>w.doc.must('page').graph({domain:'graph',op:'replace-content',target,index,replacement}));
    assert.equal(result.changed,true);assert.equal(result.rev,index+1);assert.deepEqual(p.root(),before);
  }
  return map;
}
export function styled_composition_cases(check: (name: string, run: () => void) => void) {
  check("raw Part text stays literal while structured CssMap keeps local scope and identity", () => {
    const raw=String.raw`/* native */ button { & :future([hson\:quad="missing"]) {color:red;color:blue} } @import "x"; .empty{}`;
    const map=hsonLiveMap.fromLibraries({parts:{parts:{x:{kind:'document',document:'<section @:root <button @:child/>/>',stylesheet:raw,
      css:{color:'green','@:child':{padding:7}}}}},page:{document:'<html <head/> <body <hson-part lib="parts" at="x"/> <hson-part lib="parts" at="x"/>/>/>'}});
    const a=owner(map),record=encode_portable_document_stylesheet(a.stylesheet(identity(map)));
    assert.deepEqual(record.order.filter(entry=>entry.kind==='text').map(entry=>entry.text),[raw,raw]);
    assert.equal(record.rules.length,4);assert.equal(record.properties.length,0);assert.equal(record.keyframes.length,0);
    assert.ok(record.rules.every(rule=>rule.scopes.some(scope=>scope.startsWith('@scope ([hson\\:quid='))));
    assert.ok(record.rules.some(rule=>rule.selector.includes('hson\\:quid')));
    assert.equal(record.rules.some(rule=>rule.selector.includes('missing')),false);
    const html=page(map).render();assert.equal(html.split(raw).length-1,2);assert.doesNotMatch(html,/hson:quid=/);
    assert.equal(new Set(record.order.map(entry=>entry.owner)).size,2);
  });
  check("raw definitions do not conflict with one another or structured registries", () => {
    const source='@keyframes owned{from{opacity:0}}@property --tone{syntax:"*";inherits:false}';
    const map=legacy_flat_styled_map({parts:{parts:{x:part('<p/>',source)}},page:{document:'<main <hson-part lib="parts" at="x"/> <hson-part lib="parts" at="x"/>/>'}});
    const p=page(map);assert.equal(p.css.keyframes.has('owned'),false);assert.equal(p.css.atProperty.has('--tone'),false);
    map.batch(w=>{w.doc.must('page').css.keyframes.set({name:'owned',steps:{from:{opacity:'1'}}});w.doc.must('page').css.atProperty.register({name:'--tone',syn:'*',inh:false});});
    assert.equal(p.css.keyframes.has('owned'),true);map.batch(w=>w.doc.must('page').css.keyframes.delete('owned'));
    assert.equal(p.css.snapshot().split(source).length-1,2);
  });
  check("moving roots retains both contributions and retirement removes only the owning occurrence", () => {
    const map=legacy_flat_styled_map({parts:{parts:{outer:{kind:'document',document:'<section <hson-part at="inner"/>/>',stylesheet:'/* outer */',css:{color:'red'}},
      inner:{kind:'document',document:'<button/>',stylesheet:'/* inner */',css:{padding:7}}}},
      page:{document:'<html <head/> <body <hson-part @:first lib="parts" at="outer"/> <hson-part @:second lib="parts" at="outer"/>/>/>'}});
    const p=page(map);map.batch(w=>w.doc.must('page').css.rule('unrelated','.unrelated').set.color('blue'));
    const first=p.q('first')!,before=p.css.snapshot();
    p.document.content.move({kind:'path',path:path([0,0,1,0])},0,1);assert.equal(p.css.snapshot(),before);
    let commits=0;const off=map.commits.observe(()=>{commits++;const record=encode_portable_document_stylesheet(owner(map).stylesheet(identity(map)));
      assert.equal(record.order.filter(entry=>entry.kind==='text').length,2);assert.equal(record.rules.length,3);});
    try {first.delete();} finally {off();}assert.equal(commits,1);assert.ok(p.q('second'));assert.equal(p.q('first'),undefined);
    assert.equal(p.css.snapshot().split('/* outer */').length-1,1);assert.ok(p.css.has('unrelated'));
    p.q('second')!.delete();assert.match(p.css.snapshot(),/unrelated/);assert.doesNotMatch(p.css.snapshot(),/outer|inner|padding/);
  });
  check("whole replacement and structured deletion preserve unrelated text and explicit ownership", () => {
    const map=legacy_flat_styled_map({parts:{parts:{button:part('<section/>','section{color:red}')}},page:{document:'<html <head/> <body <main <hson-part @:slot0 lib="parts" at="button"/>/>/>/>'}}),p=page(map);p.css.rule('independent','.i').set.color('red');
    const before=p.css.snapshot();p.css.drop('stylesheet:1');assert.equal(p.css.snapshot(),before);
    p.css.drop('independent');assert.doesNotMatch(p.css.snapshot(),/\.i\{/);
    const quid=owner(map).documentQuad(identity(map),'slot0',undefined)!.quid;
    p.css.sel(`[hson\\:quid="${quid}"]`).setProp('color','red');atomic(map,()=>p.q('slot0')!.delete());
    for(const cssFirst of [false,true]) {
      const candidate=styled_fixture(1),q=page(candidate);const subject=owner(candidate).documentQuad(identity(candidate),'slot0',undefined)!.quid;
      q.css.sel(`[hson\\:quid="${subject}"]`).setProp('color','red');
      candidate.batch(w=>{const d=w.doc.must('page');if(cssFirst)d.css.stylesheet(' untouched ');d.at([1,0,0]).delete();if(!cssFirst)d.css.stylesheet(' untouched ');});
      assert.equal(q.css.snapshot(),' untouched ');
    }
  });
  check("portable A to B to C retains text and owner relationships with fresh identities", () => {
    let map: LiveMap=legacy_flat_styled_map({parts:{parts:{x:{kind:'document',document:'<section <button/>/>',stylesheet:'/* unclosed',css:{'& button':{color:'red'}}}}},
      page:{document:'<html <head/> <body <hson-part lib="parts" at="x"/> <i/>/>/>'}});
    const issued=new Set<string>();
    for(let cycle=0;cycle<3;cycle++) {
      const a=owner(map),record=encode_portable_document_stylesheet(a.stylesheet(identity(map))),ids=document_css_subject_identities(record,'outbound');
      assert.equal(ids.length,1);assert.equal(issued.has(ids[0]!),false);issued.add(ids[0]!);
      const raw=record.order.find(entry=>entry.kind==='text');assert.equal(raw?.text,'/* unclosed');
      assert.equal(raw?.owner,record.order.find(entry=>entry.kind==='group')?.owner);
      const cut=map.cut({html:'page',documents:['page'],data:[]});assert.match(cut.html,/\/\* unclosed<\/style><style/);
      map=install_libraries_snapshot(cut.libs).map;
    }
    page(map).at([1,0]).delete();assert.equal(page(map).css.snapshot(),'');
  });
  check("failed Schema, exhausted allocation and reentrant inner work remain atomic", () => {
    const map=hsonLiveMap.fromLibraries({parts:{parts:{x:part('<p/>','anything {')}},state:{data:{count:0}},page:{document:'<aside/>'}});
    atomic(map,()=>map.addLibraries({bad:{document:'<main <hson-part lib="parts" at="x"/>/>',schema:Hson.schema`<type "document" tag "main" content "empty">`}}));
    allocator(owner(map).identityEpoch().owner,()=> 'invalid');
    try {atomic(map,()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}),/QUID/);} finally {allocator(owner(map).identityEpoch().owner,undefined);}
    let inner=false;allocator(owner(map).identityEpoch().owner,()=>{if(!inner){inner=true;map.data.must('state').at(['count']).set(1);}return '123456789';});
    try {assert.throws(()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}),/changed/);} finally {allocator(owner(map).identityEpoch().owner,undefined);}
    assert.equal(map.data.must('state').at(['count']).snap(),1);assert.throws(()=>map.doc.must('bad'));
  });
}
