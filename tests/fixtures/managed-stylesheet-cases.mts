import { document_css_subject_identities, translate_document_css_identities } from "../../src/internal/css/css-identity-translation.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { css_identity_translation_cases } from "./css-identity-translation-cases.mts";
import { structured_css_fixture } from "../helpers/structured-css-fixture.mts";
import { MANAGED_STYLESHEET_BROWSER_ORACLES } from "./managed-stylesheet-browser-oracles.mts";
import assert from "node:assert/strict";
import { hsonLiveMap, hsonLiveTree } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { canonical_portable_document_css_op, apply_portable_document_css_op } from "../../src/internal/css/portable-document-operations.ts";
import { opaque_document_stylesheet } from "../../src/internal/css/opaque-stylesheet.ts";
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet, render_portable_document_stylesheet, render_portable_document_stylesheet_carriers, empty_portable_document_stylesheet, drop_portable_document_rule, set_portable_document_declaration, set_portable_document_keyframes } from "../../src/internal/css/portable-document-stylesheet.ts";

export function managed_stylesheet_cases(check: (name: string, run: () => void) => void): void {
  css_identity_translation_cases(check);
  check("raw text retains every authored token without registering structured members", () => {
    for (const source of [...MANAGED_STYLESHEET_BROWSER_ORACLES.map(item => item.css),
      '', ' \n /* comment */ ', '.x{color:red;color:blue;display:-webkit-box;display:flex}',
      '@import "x"; @font-face{font-family:x;src:url(x)} @layer a,b;',
      '.x { button:future(&, ???) { color: ??? } } .empty{}',
      '/* unclosed', '.broken{content:"unfinished', String.raw`[hson\:quid="123456789"]{color:red}[hson\:quad="missing"]{color:blue}`]) {
      const record = opaque_document_stylesheet(source);
      for(const direction of ['inbound','outbound'] as const) {
        assert.deepEqual(document_css_subject_identities(record,direction),[]);
        assert.deepEqual(translate_document_css_identities(record,direction,{associations:[],assertCurrent(){}}),record);
      }
      assert.deepEqual(record, {rules:[],properties:[],keyframes:[],order:[{kind:'text',text:source}]});
      const state = decode_portable_document_stylesheet(JSON.parse(JSON.stringify(record)));
      assert.deepEqual(encode_portable_document_stylesheet(state),record);
      assert.deepEqual(render_portable_document_stylesheet_carriers(state),[source]);
      const map=hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body/>/>',stylesheet:source}});
      assert.equal(map.doc.must('page').css.snapshot(),source);
      assert.deepEqual(map.doc.must('page').css.list(),[]);assert.equal(internal_livemap_aggregate_authority(map).identityEpoch().issued().size,0);
      assert.equal(map.doc.must('page').css.keyframes.has('f'),false);
      assert.equal(install_libraries_snapshot(map.capture()).map.doc.must('page').css.snapshot(),source);
      const tree=hsonLiveTree.fromHson('<main/>',{isolated:true});
      tree.css.global.stylesheet(source);assert.equal(tree.css.snapshot(),source);
      tree.css.global.drop('stylesheet:1');assert.equal(tree.css.snapshot(),source);
      tree.css.global.clearAll();assert.equal(tree.css.snapshot(),'');tree.remove();
    }
  });
  check("structured operations preserve opaque position and whole replacement owns its lifetime", () => {
    let state=decode_portable_document_stylesheet(opaque_document_stylesheet('/* unclosed'));
    state=set_portable_document_declaration(state,'x','.x','marginTop','5px');
    assert.deepEqual(render_portable_document_stylesheet_carriers(state),['/* unclosed','.x{margin-top:5px;}']);
    state=drop_portable_document_rule(state,'x');
    assert.deepEqual(render_portable_document_stylesheet_carriers(state),['/* unclosed']);
    state=apply_portable_document_css_op(state,{domain:'css',kind:'append',stylesheet:opaque_document_stylesheet('.next{}')});
    assert.deepEqual(render_portable_document_stylesheet_carriers(state),['/* unclosed','.next{}']);
    state=apply_portable_document_css_op(state,{domain:'css',kind:'replace',stylesheet:opaque_document_stylesheet(' replacement ')});
    assert.deepEqual(render_portable_document_stylesheet_carriers(state),[' replacement ']);
  });
  check("raw transport safety is enforced at HTML realization without modifying stored text", () => {
    for(const text of ['</style>', '</STYLE >', 'a\rb', '\0', '\ud800']) {
      const map=hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body/>/>',stylesheet:text}});
      const page=map.doc.must('page');assert.equal(page.css.snapshot(),text);
      assert.equal(install_libraries_snapshot(map.capture()).map.doc.must('page').css.snapshot(),text);
      assert.throws(()=>page.render());
    }
  });
  check("selector identities and public lookup preserve significant terminal characters", () => {
    const selectors = ['#t\\ ', '#t\\\u00a0', '#t\u00a0', '#t', '#t\\20 x'];
    const map = hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body/>/>'}});
    const commits: Parameters<typeof map.replay>[0][] = []; map.commits.observe(commit => commits.push(commit));
    const tree = hsonLiveTree.fromNode({$_tag:"main",$_content:[]},{isolated:true});
    for (const css of [map.doc.must("page").css, tree.css.global]) {
      for (const selector of selectors) css.sel(selector).set.color("red");
      assert.equal(css.list().length, selectors.length);
      for (const selector of selectors) { const key = `sel:${selector}`; assert.ok(css.has(key), key); assert.ok(css.get(key)?.includes(selector), key); }
      css.sel(selectors[0]!).set.color("green");
      assert.ok(css.get(`sel:${selectors[0]}`)?.includes("green"));
      assert.ok(css.get(`sel:${selectors[1]}`)?.includes("red"));
      css.drop(`sel:${selectors[0]}`); assert.equal(css.has(`sel:${selectors[0]}`), false);
      assert.equal(css.has(`sel:${selectors[1]}`), true);
      css.sel(selectors[0]!).set.color("blue");
      const text = css === tree.css.global ? tree.css.snapshot() : map.doc.must("page").css.snapshot();
      assert.ok(text.indexOf(`${selectors[1]}{`) < text.indexOf(`${selectors[0]}{`), "recreation appends");
    }
    const state=decode_portable_document_stylesheet(map.capture().libraries[0]!.css);
    const dropped=drop_portable_document_rule(state,`sel:${selectors[0]}`);
    assert.equal(dropped.rules.length,state.rules.length-1);
    assert.ok(dropped.rules.some(rule=>rule.ruleKey===`sel:${selectors[1]}`));
    const before=map.rev, count=commits.length;
    map.doc.must("page").css.sel('  #t  ').set.color("red");
    assert.equal(map.rev,before); assert.equal(commits.length,count);
    const replay=hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body/>/>'}});
    for(const commit of commits) replay.replay(commit);
    assert.deepEqual(replay.capture().libraries[0]!.css,map.capture().libraries[0]!.css);
    assert.deepEqual(install_libraries_snapshot(map.capture()).map.capture().libraries[0]!.css,map.capture().libraries[0]!.css);
    tree.remove();
  });
  check("portable stylesheet arrays reject malformed physical storage without executing code", () => {
    const entry = {kind:"group",header:"@layer",entries:[]};
    const malformed: unknown[][] = [Array(1), [,entry], [entry,,entry], [entry,]];
    malformed[3]!.length=2;
    let invoked=0;
    for(const get of [() => {invoked++; return entry;}, () => {invoked++; throw Error("executed accessor");}]) {
      const items: unknown[]=[];Object.defineProperty(items,"0",{get,enumerable:true});malformed.push(items);
    }
    const mapOverride: unknown[]=[];Object.defineProperty(mapOverride,"map",{value:()=>{invoked++;return []}});malformed.push(mapOverride);
    const iterator: unknown[]=[];Object.defineProperty(iterator,Symbol.iterator,{value:()=>{invoked++;throw Error("executed iterator")}});malformed.push(iterator);
    const decorated: unknown[]=[];Object.defineProperty(decorated,"extra",{value:1});malformed.push(decorated);
    const map=hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body/>/>'}});
    map.doc.must("page").css.stylesheet('.x{color:red}'); const before=map.capture(), root=map.doc.must("page").document, rev=map.rev;
    let commits=0;map.commits.observe(()=>commits++);
    for(const entries of malformed) {
      const record={rules:[],properties:[],keyframes:[],order:[{kind:"group",header:"@layer",entries}]};
      assert.throws(()=>decode_portable_document_stylesheet(record), /array|storage/i);
      const capture={...before,libraries:before.libraries.map(item => { const altered={...item}; Object.defineProperty(altered,"css",{value:record,enumerable:true});return altered; })};
      assert.throws(()=>map.restore(capture));
      assert.equal(map.doc.must("page").document,root);assert.equal(map.rev,rev);assert.equal(commits,0);assert.deepEqual(map.capture(),before);
      assert.throws(()=>install_libraries_snapshot(capture));
    }
    assert.equal(invoked,0,"indexed getters, iterators and methods must never execute");
    const empty={rules:[],properties:[],keyframes:[],order:[entry]};
    assert.deepEqual(encode_portable_document_stylesheet(decode_portable_document_stylesheet(empty)),empty);
    const shared: unknown[]=[];
    assert.equal(decode_portable_document_stylesheet({...empty,order:[{...entry,entries:shared},{...entry,entries:shared}]}).order.length,2);
    const cyclic: unknown[]=[];cyclic.push({...entry,entries:cyclic});
    assert.throws(()=>decode_portable_document_stylesheet({...empty,order:cyclic}),/Cyclic/);
    const valid=structured_css_fixture('@layer{@media screen{.x{color:red}}}');
    const missing=structuredClone(valid);const top=missing.order[0]!;
    if(top.kind!=="group") throw Error("missing group");
    const nested=top.entries[0]!;if(nested.kind!=="group") throw Error("missing nested group");
    (nested.entries[0] as {ruleKey:string}).ruleKey="missing";
    assert.throws(()=>decode_portable_document_stylesheet(missing),/order disagrees/);
    for(const key of ["rules","properties","keyframes","order"] as const) assert.throws(()=>decode_portable_document_stylesheet({...empty,[key]:Array(1)}), /array|storage/i);
    const badScopes=structuredClone(valid);Object.defineProperty(badScopes.rules[0]!,"scopes",{value:Array(1)});
    assert.throws(()=>decode_portable_document_stylesheet(badScopes),/array|storage/i);
    const badPairs=structuredClone(valid);Object.defineProperty(badPairs.rules[0]!,"declarations",{value:[Array(2)]});
    assert.throws(()=>decode_portable_document_stylesheet(badPairs),/array|storage/i);
    const frames=encode_portable_document_stylesheet(set_portable_document_keyframes(empty_portable_document_stylesheet(), {name:'a',steps:{from:{opacity:'.2'}}}));
    Object.defineProperty(frames.keyframes[0]!,"steps",{value:Array(1)});
    assert.throws(()=>decode_portable_document_stylesheet(frames),/array|storage/i);
    map.doc.must("page").css.sel('.retry').set.color("green");assert.equal(map.rev,rev+1);assert.equal(commits,1);
  });

  check("CSS batch replay qualifies physical arrays before publication and preserves JSON closure", () => {
    const clear={domain:"css",kind:"clear-all"} as const;
    let invoked=0;
    const holesAtEnd:unknown[]=[clear];holesAtEnd.length=2;
    const bad:unknown[][]=[Array(1),[,clear],[clear,,clear],holesAtEnd];
    for(const get of [()=>{invoked++;return clear},()=>{invoked++;throw Error("executed indexed getter")}]) {
      const items:unknown[]=[];Object.defineProperty(items,"0",{get,enumerable:true});bad.push(items);
    }
    const method=[clear];Object.defineProperty(method,"map",{value(){invoked++;return [clear]}});bad.push(method);
    const iterator=[clear];Object.defineProperty(iterator,Symbol.iterator,{value(){invoked++;throw Error("executed iterator")}});bad.push(iterator);
    const decorated=[clear];Object.defineProperty(decorated,"extra",{value:1,enumerable:true});bad.push(decorated);
    const symbol=[clear];Object.defineProperty(symbol,Symbol("extra"),{value:1});bad.push(symbol);
    const hidden=[clear];Object.defineProperty(hidden,"0",{value:clear,enumerable:false});bad.push(hidden);
    const inherited:unknown[]=Array(1);Object.setPrototypeOf(inherited,Object.assign(Object.create(Array.prototype),{0:clear}));bad.push(inherited);
    const serialization=[clear];Object.defineProperty(serialization,"toJSON",{value(){invoked++;return [clear]}});bad.push(serialization);
    const make=()=>{const map=hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body/>/>'}});map.doc.must("page").css.stylesheet('.x{color:orange}');return map};
    const map=make(), peer=make(), page=map.doc.must("page"), root=page.root(), owner=page.document, before=map.capture(), rev=map.rev;
    const commits:Parameters<typeof map.replay>[0][]=[];map.commits.observe(commit=>commits.push(commit));
    for(const operations of bad) {
      const batch={domain:"css",kind:"batch",operations};
      assert.throws(()=>canonical_portable_document_css_op(batch),TypeError);
      assert.throws(()=>map.replay({kind:"map",changed:true,prevRev:rev,rev:rev+1,operations:[{library:"page",operation:batch}]} as never),TypeError);
      assert.equal(map.rev,rev);assert.equal(page.css.snapshot(),'.x{color:orange}');
      assert.deepEqual(map.capture(),before);assert.equal(commits.length,0);assert.deepEqual(page.root(),root);assert.equal(page.document,owner);
    }
    assert.equal(invoked,0,"source getters, methods, iterators and serialization hooks never execute");
    for(const operations of [[],[{domain:"css",kind:"batch",operations:[clear]}]]) {
      assert.throws(()=>canonical_portable_document_css_op({domain:"css",kind:"batch",operations}), /batch must contain|operation kind|operation fields/i);
    }
    const rule=(color:string)=>({domain:"css",kind:"rule",ruleKey:"final",scopes:[],rule:{ruleKey:"final",selector:".x",scopes:[],declarations:[["color",color]]}});
    const source={domain:"css",kind:"batch",operations:[rule("green"),clear,rule("blue")]};
    const admitted=canonical_portable_document_css_op(source);
    assert.deepEqual(JSON.parse(JSON.stringify(admitted)),source,"ordered canonical units survive JSON exactly");
    map.replay({kind:"map",changed:true,prevRev:rev,rev:rev+1,operations:[{library:"page",operation:admitted}]});
    assert.equal(map.rev,rev+1);assert.equal(commits.length,1);assert.equal(page.css.snapshot(),'.x{color:blue;}');
    assert.deepEqual(page.root(),root);assert.equal(page.document,owner);assert.deepEqual(commits[0]!.operations[0]!.operation,admitted);
    peer.replay(JSON.parse(JSON.stringify(commits[0])));
    assert.deepEqual(peer.capture(),map.capture());
    const after=map.capture(), count=commits.length;
    const current=decode_portable_document_stylesheet(after.libraries[0]!.css);
    assert.deepEqual(apply_portable_document_css_op(current,admitted),current,"unchanged final state stays a semantic no-op");
    assert.throws(()=>map.replay({kind:"map",changed:true,prevRev:map.rev,rev:map.rev+1,operations:[{library:"page",operation:admitted}]}),/semantic stylesheet change/);
    assert.equal(commits.length,count);assert.deepEqual(map.capture(),after);
  });

}
