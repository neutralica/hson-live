import { structured_css_review_cases } from "./structured-css-review-cases.mts";
import { Hson } from "../../src/hson-authoring.ts";
import assert from 'node:assert/strict';
import { hsonLiveMap } from '../../src/api/livemap/index.ts';
import { hsonLiveTree } from '../../src/api/livetree/livetree.facade.ts';
import { internal_livemap_aggregate_authority as authority } from '../../src/api/livemap/livemap.internal.ts';
import { set_livemap_quid_candidate_source_for_tests as allocator } from '../../src/api/livemap/livemap.quid-allocation.ts';
import { structured_part_stylesheet, relative_css_selector } from '../../src/internal/css/structured-css.ts';
import { encode_portable_document_stylesheet } from '../../src/internal/css/portable-document-stylesheet.ts';
import { locus_map_internal } from '../../src/internal/governor-maps.ts';
import type { CssMap } from '../../src/core/style.types.ts';

const nav = '<nav hson:part <a @:previous/> <span @:current/> <a @:next/>/>';
const style: CssMap = { color: 'red', borderRadius: { value: 50, unit: '%' },
  '& :is(a,span)': { textDecoration: 'none', _hover: { opacity: .5 } },
  __before: { color: 'blue' }, '@:current': { fontWeight: 'bold', '& > i': { color: 'green' }, _focus: { outline: '0' } },
  $media: { '(max-width: 480px)': { gap: '0.5rem', '& a': { fontSize: '.85rem' }, '@:current': { fontWeight: 900 } },
    '(prefers-reduced-motion: reduce)': { transition: 'none' } } };
const part = (css: unknown = style, document = nav) => ({ kind: 'document' as const, document, css });
const sheet = (css: unknown) => structured_part_stylesheet(css, new Set(['current','previous','next']));
function admit(css: unknown, document = nav) {
  return hsonLiveMap.fromLibraries({ parts: { parts: { nav: part(css, document) } } } as never);
}
function realized() {
  return hsonLiveMap.fromLibraries({ parts: { parts: { nav: { kind: 'document', document: nav, stylesheet: ':scope{color:blue}', css: style },
    outer: { kind: 'document', document: '<section hson:part <hson-part at="nav"/>/>', css: { padding: 3 } } } },
    page: { document: '<html <head/> <body <hson-part lib="parts" at="outer"/> <hson-part lib="parts" at="nav"/>/>/>' } });
}
export async function structured_css_cases(check: (name: string, run: () => void | Promise<void>) => Promise<void>) {
  await check('structured roots, functions, pseudos, local targets and media preserve source order', () => {
    const css = sheet(style);
    assert.equal(css.rules[0]!.selector, ':scope');
    assert.deepEqual(css.rules[0]!.declarations, [['color','red']]);
    assert.ok(css.rules.some(r => r.selector === ':scope :is(a,span)'));
    assert.ok(css.rules.some(r => r.selector.includes('quad="current"')));
    assert.ok(css.rules.some(r => r.declarations.some(([k,v]) => k === 'content' && v === '""')));
    assert.ok(css.rules.some(r => r.scopes.includes('@media (max-width:480px)')));
    assert.ok(css.rules.some(r => r.scopes.includes('@media (prefers-reduced-motion:reduce)')));
    assert.equal(relative_css_selector('& :is(a,b)', '[data-owner="x"]'), '[data-owner="x"] :is(a,b)');
    assert.throws(() => relative_css_selector('& a, & b', ':scope'));
    assert.throws(() => relative_css_selector('& a, body', ':scope'));
    assert.throws(() => relative_css_selector(':is(&,body)', ':scope'));
    const m = realized(), cssText = m.doc.must('page').css.snapshot();
    assert.ok(cssText.indexOf('color:blue') < cssText.indexOf('color:red'));
    const html = m.doc.must('page').render();
    assert.match(html, /<style data-hson-managed-document-css="managed">/);
    assert.match(html, /@scope \(\[hson\\:quad=/); assert.doesNotMatch(html, /hson:quid|<script/);
    const a = authority(m), id = a.libraries()[a.hostedRegistry().libraries.findIndex(x => x.name === 'page')]!;
    const state = encode_portable_document_stylesheet(a.stylesheet(id));
    const owners = new Set(state.order.map(e => e.owner)); assert.equal(owners.size, 3);
  });
  await check('known modern, vendor, custom and normalized keys share strict declaration validation', () => {
    assert.doesNotThrow(() => sheet({color:'red!important'}));
    const result = sheet({ backgroundColor:'red', '-webkit-user-select':'none', msTransform:'none',
      anchorName:'--a', positionArea:'top', viewTransitionName:'item', '--1':'literal', '--\\31 foo':'escaped', width:{value:2,unit:'rem'} });
    assert.ok(result.rules.some(r => r.declarations.some(([k]) => k === '-webkit-user-select')));
    for (const css of [{colour:'red'}, {backgroundColor:'red','background-color':'blue'}, {'--\\31 foo':'red','--1foo':'blue'}, {cssFloat:'left',float:'right'},
      {a:{color:'red'}}, {'@media screen':{color:'red'}}, {_future:{color:'red'}}, {'& a, body':{color:'red'}},
      {color:null}, {color:true}, {color:NaN}, {color:Infinity}, {width:{value:1,unit:'potato'}},
      {color:{value:1,extra:true}}, {color:['red']}, {color:'red;display:block'}, {color:'red}body{display:none'},
      {'@:bad/name':{color:'red'}}, {'@:missing':{color:'red'}}, {'@:current':{'@:next':{color:'red'}}},
      {'& a':{'@:current':{color:'red'}}}, {$media:{$media:{color:'red'}}},
      {$media:{'(width:1px)':{$media:{screen:{color:'red'}}}}}, {$media:{'screen{}body':{color:'red'}}},
      {$media:{'':{color:'red'}}}, {$media:{screen:false}}]) assert.throws(() => admit(css), JSON.stringify(css));
  });
  await check('own-data inspection rejects accessors, cycles, prototypes and symbols without coercion', () => {
    let calls = 0; const accessor = Object.defineProperty({}, 'color', {enumerable:true,get(){calls++;return 'red';}});
    const typedAccessor = {color:Object.defineProperty({},'value',{enumerable:true,get(){calls++;return 2;}})};
    const cycle: Record<string, unknown> = {}; cycle['& a'] = cycle;
    for (const css of [accessor,typedAccessor,cycle,Object.create({color:'red'}),{[Symbol()]:1},new Map(),
      Object.defineProperty({},'color',{value:'red'})]) assert.throws(() => admit(css));
    assert.equal(calls,0);
  });
  await check('missing, duplicate and nested-namespace targets fail before any runtime issuance', () => {
    for (const document of ['<p hson:part/>','<p hson:part @:current <i @:current/>/>','<p hson:part <hson-part at="child"/>/>']) {
      const m = hsonLiveMap.create(), a = authority(m); let calls=0;
      allocator(a.identityEpoch().owner,()=>{calls++;return '123456789';});
      const before=m.capture();
      try { assert.throws(()=>m.addLibraries({parts:{parts:{child:{kind:'document',document:'<i hson:part @:current/>'},nav:part({'@:current':{color:'red'}},document)}}} as never)); }
      finally { allocator(a.identityEpoch().owner,undefined); }
      assert.equal(calls,0); assert.deepEqual(m.capture(),before);
    }
  });
  await check('undefined omission precedes initial, dynamic, direct, staged and collection replacement admission', async () => {
    const css = { color:undefined, width:{value:2,unit:undefined}, '& a':undefined,
      $media:{screen:{color:undefined,display:'block'}, print:undefined} };
    const expected = { width:{value:2}, $media:{screen:{display:'block'}} };
    const m = admit(css); assert.deepEqual(m.parts.must('parts').at(['nav']).snap()?.css, expected);
    const dynamic = hsonLiveMap.create(); dynamic.addLibraries({parts:{parts:{nav:part(css)}}} as never);
    const p = dynamic.parts.must('parts'); p.at(['nav']).replace(part(css) as never);
    dynamic.batch(w=>w.parts.must('parts').at(['nav']).replace(part(css) as never));
    p.at([]).asObject()!.object.setKey('second', part(css) as never);
    p.at([]).object.setMany({many:part(css)} as never);
    dynamic.batch(w=>w.parts.must('parts').at([]).object.setKey('third',part(css) as never));
    dynamic.batch(w=>w.parts.must('parts').at([]).object.setMany({stagedMany:part(css)} as never));
    assert.deepEqual(p.at(['third']).snap()?.css,expected);
    assert.deepEqual(p.at(['many']).snap()?.css,expected);
    assert.deepEqual(p.at(['stagedMany']).snap()?.css,expected);
    const l = hsonLiveMap.locus.create({parts:{parts:{}}});
    try {
      await l.parts.must('parts').at([]).replace({nav:part(css)} as never);
      await l.stage(w=>w.parts.must('parts').at(['nav']).replace(part(css) as never));
      await l.parts.must('parts').at([]).asObject()!.object.setKey('second',part(css) as never);
      await l.parts.must('parts').at([]).object.setMany({many:part(css)} as never);
      await l.stage(w=>w.parts.must('parts').at([]).object.setMany({stagedMany:part(css)} as never));
      assert.deepEqual(l.parts.must('parts').at(['second']).snap()?.css,expected);
      assert.deepEqual(l.parts.must('parts').at(['many']).snap()?.css,expected);
      assert.deepEqual(l.parts.must('parts').at(['stagedMany']).snap()?.css,expected);
    } finally { l.dispose(); }
    assert.throws(()=>hsonLiveMap.fromLibraries({ordinary:{data:{color:undefined}}} as never));
  });
  await check('atomic late CSS failures and definition/occurrence replacement preserve ownership', () => {
    const m = realized(), page=m.doc.must('page'), before=page.css.snapshot(), rev=m.rev, ledger=authority(m).identityEpoch().issued();
    assert.throws(()=>m.batch(w=>{w.doc.must('page').at([]).asElement().attrs.set('title','unpublished');
      w.parts.must('parts').at(['nav']).replace(part({colour:'red'}) as never);}));
    assert.equal(m.rev,rev);assert.equal(page.css.snapshot(),before);
    assert.throws(()=>m.addLibraries({bad:{document:'<main <hson-part lib="parts" at="nav"/>/>',schema:Hson.schema`<type "document" tag "main" content "empty">`}} as never));
    assert.equal(page.css.snapshot(),before);assert.equal(authority(m).identityEpoch().issued(),ledger);
    const deferred=m.parts.must('parts').at(['nav']).write();
    const markup=page.render();
    m.parts.must('parts').at(['nav']).replace(part({color:'green'}) as never);
    assert.equal(page.render(),markup);
    m.addLibraries({later:{document:deferred}});
    assert.match(m.doc.must('later').css.snapshot(),/color:green/);
    assert.doesNotMatch(m.doc.must('later').css.snapshot(),/color:red/);
    assert.equal(page.css.snapshot(),before); // existing occurrences are independent of future source edits
    const connector=m.parts.must('parts').at(['nav']).write({}); assert.match(connector,/hson-part/);
  });
  await check('renamed fields reject old forms and document css facade keeps its semantics', () => {
    const m=hsonLiveMap.fromLibraries({page:{document:'<main/>',stylesheet:'main{color:red}'}});
    assert.match(m.doc.page.css.snapshot(),/red/);m.doc.page.css.stylesheet('main{color:blue}');assert.doesNotMatch(m.doc.page.css.snapshot(),/red/);
    assert.throws(()=>hsonLiveMap.fromLibraries({page:{document:'<main/>',css:'main{color:red}'}} as never));
    assert.throws(()=>admit('p{color:red}'));
  });
  await check('LiveTree setMany shares declaration validation and preserves imperative null deletion', () => {
    const t=hsonLiveTree.fromHson('<nav/>',{isolated:true});
    t.css.setMany({color:'red','& :is(a,b)':{fontSize:2},_hover:{color:'blue'}});
    for(const css of [{$media:{screen:{color:'red'}}},{'@:label':{color:'red'}},
      {color:null},{color:true},{colour:'red'},{a:{color:'red'}},{'& a, body':{color:'red'}}]) {
      const before=t.css.snapshot();assert.throws(()=>t.css.setMany(css as never));assert.equal(t.css.snapshot(),before);
    }
    t.css.setProp('color',null);assert.equal(t.css.get.color(),undefined);
  });
  await check('hosted snapshots carry scoped structured contributions without private source', async () => {
    const l=hsonLiveMap.locus.create({parts:{parts:{nav:{kind:'document',document:nav,css:style}}},
      page:{document:'<html <head/> <body <hson-part lib="parts" at="nav"/> <hson-part lib="parts" at="nav"/>/>/>',access:'shared'}},
      {authorizeProjection:({requested})=>({libraries:requested.libraries})});
    try { const session=await l.session.create({libraries:['page']});const cut=session.now({html:'page'});
      assert.equal(cut.libs.libraries[0]!.scopes!.occurrences.length,2);assert.match(cut.html,/@media/);
      assert.doesNotMatch(JSON.stringify(cut),/hson:quid|identityEpoch|"name":"parts"/);
      const beforeMove=l.doc.page.css.snapshot();
      await l.stage(w=>w.doc.page.content.move({kind:'path',path:[0,0,1,0]},0,1));
      assert.equal(l.doc.page.css.snapshot(),beforeMove);
      await l.stage(w=>w.doc.page.at([1,0]).delete());assert.match(session.now({html:'page'}).html,/font-weight:bold/);
      await l.stage(w=>w.doc.page.at([1,0]).delete());assert.equal(locus_map_internal(l).doc.must('page').css.snapshot(),'');
    } finally {l.dispose();}
  });
  await structured_css_review_cases(check);
}
