import assert from "node:assert/strict";
import { ANY_DOCUMENT, Hson, hsonLiveMap, hsonLiveTree, hsonMirror, hsonTransform } from "../../src/index.ts";
import { parse_style_string } from "../../src/api/transform/utils/attrs-utils/parse-style.ts";
import { serialize_style } from "../../src/api/transform/utils/attrs-utils/serialize-style.ts";
import { InlineCssError } from "../../src/internal/css/inline-css.ts";
import { canonical_hson_graph_equal } from "../../src/core/canonical-hson-equal.ts";
import { encode_exact_hson_value, decode_exact_hson_value } from "../../src/api/livemap/livemap.document.view-state-codec.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { runtime_for_tree } from "../../src/api/livetree/runtime/livetree-runtime.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type { LiveMapDocumentLibrary } from "../../src/types/livemap.types.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { make_portable_aggregate_commit, type HostedAggregateCommit } from "../../src/api/livemap/livemap.hosted.ts";
import { ProjectedValueAdmissionError } from "../../src/core/projected-value-admission.ts";
import { subject_for_tree } from "../../src/api/livetree/runtime/livetree-runtime.ts";

export function inline_style_cases(check: (name: string, run: () => void) => void): void {
  check("data receiving context rejects attributes while document CSS remains strict", () => {
    const text = (source: string) => source as Parameters<typeof Hson.data.fromHson>[0];
    const data = Hson.data.fromHson(text('<z -0 a ["", null, true, <nested []>]>'));
    assert.deepEqual(Hson.data.entries(data)?.map(([name]) => name), ["z", "a"]);
    assert.equal(Object.is(Hson.data.materialize(Hson.data.entries(data)![0]![1]), -0), true);
    assert.equal(Hson.data.fromHson(data), data);
    assert.deepEqual(Hson.data.materialize(Hson.data.fromHson(text('<style "broken CSS text">'))), { style: "broken CSS text" });
    for (const source of ['<p style="color:red"/>', '<p style="broken"/>', '<p title="x"/>', '<p/>', '<p @000000001/>', '<a 1 a 2>', '1e999']) {
      assert.throws(() => Hson.data.fromHson(text(source)), TypeError);
    }
    const page = Hson.document`<p style="color:red!important;color:blue"/>`;
    const p = Hson.document.toNode(ANY_DOCUMENT.certify(page)).$_content[0] as HsonNode;
    assert.equal(p.$_attrs?.style?.color, "red !important");
    assert.throws(() => hsonTransform.fromHson('<p style="width:min(var(--missing,2s),10px)"/>').toNode(),
      (error) => error instanceof InlineCssError || error instanceof Error && error.cause instanceof InlineCssError);
  });
  check("strict CSS lexical boundaries retain escaped quotes and separators", () => {
    const source = 'content:"a\\\";b"; color:red';
    const expected = { content: '"a\\\";b"', color: "red" };
    assert.deepEqual(parse_style_string(source), expected);
    const page = Hson.document`<p style="${source}"/>`;
    const p = Hson.document.toNode(ANY_DOCUMENT.certify(page)).$_content[0] as HsonNode;
    assert.deepEqual({ ...p.$_attrs?.style }, expected);
    assert.deepEqual(parse_style_string('--text:"  a; b  "; --escaped:foo\\;bar'), {
      "--text": '"  a; b  "', "--escaped": 'foo\\;bar',
    });
    assert.equal(serialize_style({ "--escaped": 'foo\\;' }), '--escaped: foo\\;');
    assert.deepEqual(parse_style_string('c\\6f lor:red; --T\\6f ne:blue'), { color: "red", "--Tone": "blue" });
    assert.deepEqual(parse_style_string('mystery-property:foo\\;bar'), { mysteryProperty: 'foo\\;bar' });
    assert.deepEqual(parse_style_string('width:calc(100% - 2px)'), { width: 'calc(100% - 2px)' });
  });
  check("duplicate declarations honor importance and last equal-priority occurrence", () => {
    for (const [source, value] of [
      ['color:red!important;color:blue', 'red !important'],
      ['color:red;color:blue!important', 'blue !important'],
      ['color:red!important;color:blue!important', 'blue !important'],
      ['color:red;color:blue', 'blue'], ['color:red;color:red', 'red'],
    ]) assert.deepEqual(parse_style_string(source), { color: value });
    assert.deepEqual(parse_style_string('--x:red!important;--x:blue'), { "--x": "red !important" });
  });
  check("ordering is retained or rejected before a flat map can change it", () => {
    assert.deepEqual(parse_style_string('margin:10px;margin-top:5px'), { margin: "10px", marginTop: "5px" });
    assert.throws(() => parse_style_string('margin-top:5px;margin:10px'), InlineCssError);
    assert.deepEqual(parse_style_string('width:5px;color:red;opacity:.5'), { width: "5px", color: "red", opacity: ".5" });
    assert.throws(() => parse_style_string('mystery:foo;mystery:bar'), InlineCssError);
    assert.deepEqual(parse_style_string('mystery:foo;mystery:foo'), { mystery: "foo" });
    assert.deepEqual(parse_style_string('float:left'), { float: 'left' });
    assert.throws(() => parse_style_string('css-float:left'), InlineCssError);
    for (const source of ['display:block;display:run-in', 'color:red;color:device-cmyk(0 0 0 0)', 'color:device-cmyk(0 0 0 0)!important;color:blue']) {
      assert.throws(() => parse_style_string(source), InlineCssError, source);
    }
  });
  check("invalid first middle and last declarations reject the whole Hson/HTML input", () => {
    for (const source of [
      'broken;color:red', 'color:red;broken;display:grid', 'color:red;broken',
      'color:red width:5px', 'color:red;content:"unfinished', 'color:red;/*unfinished',
      'color:red;--x:var(x)', 'color:red!importantish', 'color:red;--x:foo\\ ',
      'color:red;--x:', 'color:red;--x:(oops', 'color:red;--x:foo)', 'color:red; width:bogus', 'margin-top:2', '--x:foo\\', 'background-image:url(foo\\)',
      'color:red;width:calc(nope)', 'width:calc(1px+2px)', 'width:calc(1px +)',
      'color:red;width:-1px', 'color:red;padding:-2px',
    ]) {
      assert.throws(() => parse_style_string(source), InlineCssError, source);
      assert.throws(() => hsonTransform.fromHson(`<p style=${JSON.stringify(source)}/>`).toNode(), InlineCssError, source);
      const html = `<p style="${source.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></p>`;
      assert.throws(() => hsonTransform.fromTrustedHtml(html).toNode(), InlineCssError, source);
    }
    assert.deepEqual(parse_style_string('color:red;display:grid'), { color: "red", display: "grid" });
  });
  check("inline mutations preflight complete batches and preserve retry/no-op behavior", () => {
    const tree = hsonLiveTree.fromHson('<p/>');
    tree.style.set.color('blue');
    tree.style.set.color('red!important');
    assert.equal(tree.style.get.color(), 'red !important');
    const original = structuredClone(tree.node);
    assert.throws(() => tree.style.setMany({ backgroundColor: 'black', width: 'bogus' }), InlineCssError);
    assert.ok(canonical_hson_graph_equal(original, structuredClone(tree.node)));
    assert.throws(() => tree.style.setMany({ fooBar: 'a', 'foo-bar': 'b' }), /collide/);
    assert.throws(() => tree.style.set.content('"unfinished'), InlineCssError);
    assert.throws(() => tree.style.set.color('red;display:grid'), InlineCssError);
    tree.style.set.color('green');
    tree.style.set.marginTop('5px');
    const before = structuredClone(tree.node);
    assert.throws(() => tree.style.set.margin('10px'), InlineCssError);
    assert.ok(canonical_hson_graph_equal(before, structuredClone(tree.node)));
    tree.style.remove('marginTop');
    tree.style.set.margin('10px');tree.style.set.marginTop('5px');
    const attrs = subject_for_tree(tree).$_attrs;
    tree.style.set.margin('10px');
    assert.equal(subject_for_tree(tree).$_attrs, attrs);
    const scalar = hsonLiveTree.fromHson('<p/>');
    scalar.attrs.set('style', -0);
    scalar.style.setMany({});
    assert.throws(() => scalar.style.set.color('red'), InlineCssError);
    assert.ok(Object.is(scalar.node.$_attrs?.style, -0));
    scalar.style.clear();scalar.style.set.color('red');
    assert.equal(scalar.style.get.color(), 'red');
  });
  check("Mirror CSS rejection does not commit, mint identity, or partially notify", () => {
    const aggregate = hsonLiveMap.fromLibraries({ page: { document: '<main <p/>/>' } });
    const map = aggregate.doc.must('page') as unknown as LiveMapDocumentLibrary;
    const mirror = hsonMirror(map);
    const tree = mirror.tree.find.must.byTag('p');
    const runtime = runtime_for_tree(tree);
    let commits = 0;
    const unsubscribe = map.commits.observe(() => commits++);
    try {
      const rev = map.rev, issued = runtime.issuedQuids.size;
      assert.throws(() => tree.style.setMany({ color: 'red', width: 'bogus' }), InlineCssError);
      assert.equal(map.rev, rev); assert.equal(commits, 0);assert.equal(runtime.issuedQuids.size, issued);
      tree.style.setMany({ color: 'red!important', margin: '10px', marginTop: '5px' });
      assert.equal(map.rev, rev + 1);assert.equal(commits, 1);assert.equal(runtime.issuedQuids.size, issued);
      tree.style.set.color('red!important');assert.equal(map.rev, rev + 1);assert.equal(commits, 1);
      assert.equal(tree.node.$_meta?.quid, undefined);
    } finally { unsubscribe();mirror.dispose(); }
  });
  check("P1 significant CSS boundaries reject before projection or an unrelated write", () => {
    assert.throws(()=>parse_style_string('\ufeffcolor:red;opacity:.5'),InlineCssError);
    for (const separator of ['\u00a0', '\u2003', '\u202f', '\ufeff']) {
      for (const value of [separator + 'red', 'red' + separator]) {
        const css = `--x:${value};color:var(--x);opacity:.5`;
        assert.throws(() => parse_style_string(css), error => error instanceof InlineCssError && error.code === 'INLINE_CSS_UNSUPPORTED');
        assert.throws(() => hsonTransform.fromHson(`<p style=${JSON.stringify(css)}/>`).toNode(), InlineCssError);
        assert.throws(() => hsonTransform.fromTrustedHtml(`<p style="${css}"></p>`).toNode(), InlineCssError);
        const tree = hsonLiveTree.fromHson('<p/>');const original = structuredClone(tree.node);
        assert.throws(() => tree.style.setMany({ '--x': value, opacity: '.5' }), InlineCssError);
        assert.ok(canonical_hson_graph_equal(original, structuredClone(tree.node)));
      }
    }
    assert.deepEqual(parse_style_string('--x: \tred\r\n ;color:var(--x)'), { '--x': 'red', color: 'var(--x)' });
    assert.deepEqual(parse_style_string('--x:"\u00a0red\u2003";content:var(--x)'), { '--x': '"\u00a0red\u2003"', content: 'var(--x)' });
    assert.deepEqual(parse_style_string('--x:\\ red;--escaped:\\a0 red'), { '--x': '\\ red', '--escaped': '\\a0 red' });
    const accessorControl=hsonLiveTree.fromHson('<p/>');let reads=0;
    assert.throws(()=>accessorControl.style.set.color({get value(){reads++;return '\u00a0red';}}),/invalid/);assert.equal(reads,0);
    const aggregate = hsonLiveMap.fromLibraries({page:{document:'<p/>'}});
    const library = aggregate.doc.must('page') as unknown as LiveMapDocumentLibrary;const mirror = hsonMirror(library);
    const tree = mirror.tree.find.must.byTag('p');let commits = 0;const stop = library.commits.observe(() => commits++);
    try {
      tree.attrs.set('style', '--x:\u00a0red;color:var(--x)');
      const original = structuredClone(tree.node), rev = library.rev, issued = runtime_for_tree(tree).issuedQuids.size;commits = 0;
      assert.throws(() => tree.style.set.opacity('.5'), InlineCssError);
      assert.ok(canonical_hson_graph_equal(original, structuredClone(tree.node)));assert.equal(library.rev, rev);assert.equal(commits, 0);assert.equal(runtime_for_tree(tree).issuedQuids.size, issued);
      tree.attrs.set('style', {color:'red'});tree.style.set.opacity('.5');assert.equal(tree.style.get.opacity(), '.5');
      tree.attrs.set('style', {'--x':'\u00a0red',color:'var(--x)'});const stored=structuredClone(tree.node), storedRev=library.rev;commits=0;
      assert.throws(()=>tree.style.set.opacity('.8'),InlineCssError);assert.ok(canonical_hson_graph_equal(stored,structuredClone(tree.node)));assert.equal(library.rev,storedRev);assert.equal(commits,0);
    } finally {stop();mirror.dispose();}
  });
  check("P2 preexisting lawful aliases support public reads no-ops replacements and removals", () => {
    for (const [key, api] of [['cssFloat','cssFloat'], ['float','cssFloat'], ['margin-top','marginTop'], ['marginTop','marginTop']]) {
      const initial = key.includes('margin') ? '5px' : 'left', changed = key.includes('margin') ? '7px' : 'right';
      const aggregate = hsonLiveMap.fromLibraries({page:{document:{$_tag:'_hson_root',$_content:[{$_tag:'p',$_content:[],$_attrs:{style:{[key]:initial, '--keep':{value:-0,unit:'px'}}}}]}}});
      const library=aggregate.doc.must('page') as unknown as LiveMapDocumentLibrary, mirror=hsonMirror(library), tree=mirror.tree.find.must.byTag('p');
      const get = () => api === 'cssFloat' ? tree.style.get.cssFloat() : tree.style.get.marginTop();
      let commits=0;const stop=library.commits.observe(()=>commits++);
      try {
        const original=structuredClone(tree.node), rev=library.rev, issued=runtime_for_tree(tree).issuedQuids.size;
        assert.equal(get(), initial);tree.style.setMany({[api]:initial});assert.equal(library.rev,rev);assert.equal(commits,0);assert.ok(canonical_hson_graph_equal(original,structuredClone(tree.node)));
        tree.style.setMany({[api]:changed});assert.equal(get(),changed);assert.equal(library.rev,rev+1);assert.equal(commits,1);
        const style=tree.node.$_attrs?.style;assert.ok(style && typeof style==='object');assert.equal(style[key],changed);assert.equal(Object.keys(style).length,2);
        const keep=style['--keep'];assert.ok(keep && typeof keep==='object');assert.ok(Object.is(keep.value,-0));assert.ok(Object.hasOwn(keep,'unit'));
        tree.style.remove(api);assert.equal(get(),undefined);assert.equal(library.rev,rev+2);assert.equal(commits,2);assert.equal(runtime_for_tree(tree).issuedQuids.size,issued);assert.equal(mirror.status,'active');
      } finally {stop();mirror.dispose();}
    }
    const tree=hsonLiveTree.fromHson('<p/>');tree.attrs.set('style',{'margin-top':'5px',marginTop:'7px'});
    tree.style.set.marginTop('9px');const style=tree.node.$_attrs?.style;assert.ok(style && typeof style==='object');assert.deepEqual({...style}, {'margin-top':'9px'});
    tree.attrs.set('style',{cssFloat:'left','--keep':{value:-0,unit:undefined}});tree.style.set.cssFloat('right');
    const retained=tree.node.$_attrs?.style;assert.ok(retained && typeof retained==='object');const keep=retained['--keep'];assert.ok(keep && typeof keep==='object');assert.ok(Object.is(keep.value,-0));assert.ok(Object.hasOwn(keep,'unit'));assert.equal(keep.unit,undefined);
  });
  check("P3 headless dimensional arithmetic is admitted only in its supported property domain", () => {
    for (const css of ['width:calc(1px + 2s)','padding:calc(1px * 2px)','opacity:calc(1px + 2px)','width:calc(2 + 3)','width:calc(1px / 0)','width:calc(1px / (var(--n) + 1))','mystery:calc(1px + 2px)','width:calc(var(--x, calc(nope)))']) {
      assert.throws(()=>parse_style_string(css),InlineCssError,css);
      assert.throws(()=>hsonTransform.fromHson(`<p style=${JSON.stringify(css)}/>`).toNode(),InlineCssError,css);
      assert.throws(()=>hsonTransform.fromTrustedHtml(`<p style="${css}"></p>`).toNode(),InlineCssError,css);
      const tree=hsonLiveTree.fromHson('<p/>');tree.style.set.color('red');const original=structuredClone(tree.node);const colon=css.indexOf(':');
      assert.throws(()=>tree.style.setMany({[css.slice(0,colon)]:css.slice(colon+1)}),InlineCssError,css);assert.ok(canonical_hson_graph_equal(original,structuredClone(tree.node)));
    }
    for (const css of ['width:calc(1px + 2px)','padding:calc(1px * 2)','opacity:calc(.2 + .3)','width:calc((1px + 2px) / 3)','width:calc(1px + 2px * 3)','width:calc(100% - 2px)','opacity:var(--opacity)','mystery:plain']) {
      const property=css.slice(0,css.indexOf(':')), value=css.slice(css.indexOf(':')+1);
      assert.equal(Object.values(parse_style_string(css))[0],value);const tree=hsonLiveTree.fromHson('<p/>');tree.style.setMany({[property]:value});assert.equal(Object.values(tree.style.getMany())[0],value);
    }
  });
  check("P3 final unproven variable arithmetic rejects through every receiving route", () => {
    const invalid = [
      'width:calc(var(--missing, 2s) + 1px)', 'width:calc(var(--missing, 1px +) + 1px)',
      'width:calc(var(--present) + 1px)', 'width:calc(var(--present, 2px) + 1px)',
      'width:calc(var(--missing, var(--nested, 2px)) + 1px)',
      'width:calc(calc(var(--present, 2px) + 1px) * 2)',
      'width:calc(100% - var(--gap, 2px))', 'width:calc(var(--present))',
      'opacity:calc(var(--present, .2) + .3)', 'width:calc(var(--present, 1px) * 2)',
      'width:calc(1px / var(--present, 2))', 'animation-delay:calc(var(--present, 1s) + 2s)',
      'width:calc(1px + 2s)', 'padding:calc(1px * 2px)', 'width:calc(1px / 0)',
      'opacity:calc(1px + 2px)', 'width:calc(2 + 3)',
    ];
    const aggregate=hsonLiveMap.fromLibraries({page:{document:'<p style="width:37px;--present:2s"/>'}});
    const library=aggregate.doc.must('page') as unknown as LiveMapDocumentLibrary, mirror=hsonMirror(library), tree=mirror.tree.find.must.byTag('p');
    let notifications=0;const stop=library.commits.observe(()=>notifications++);
    try {
      const oracle=structuredClone(tree.node), rev=library.rev, issued=runtime_for_tree(tree).issuedQuids.size;
      for (const css of invalid) {
        for (const list of [css, `color:red;${css};opacity:.5`]) {
          assert.throws(()=>parse_style_string(list), InlineCssError, list);
          assert.throws(()=>hsonTransform.fromHson(`<p style=${JSON.stringify(list)}/>`).toNode(), InlineCssError, list);
          assert.throws(()=>hsonTransform.fromTrustedHtml(`<p style="${list}"></p>`).toNode(), InlineCssError, list);
        }
        const colon=css.indexOf(':'), input={[css.slice(0,colon)]:css.slice(colon+1)};
        assert.throws(()=>tree.style.setMany(input), InlineCssError, css);
        const standalone=hsonLiveTree.fromHson('<p style="width:37px"/>',{isolated:true}), before=structuredClone(standalone.node);
        assert.throws(()=>standalone.style.setMany(input),InlineCssError,css);
        assert.ok(canonical_hson_graph_equal(before,structuredClone(standalone.node)));
        assert.ok(canonical_hson_graph_equal(oracle,structuredClone(tree.node)));
        assert.equal(library.rev,rev);assert.equal(notifications,0);assert.equal(runtime_for_tree(tree).issuedQuids.size,issued);
      }
      tree.style.set.width('calc((1px + 2px) * 2 / 3)');assert.equal(tree.style.get.width(),'calc((1px + 2px) * 2 / 3)');
      assert.equal(library.rev,rev+1);assert.equal(notifications,1);assert.equal(mirror.status,'active');
      for (const css of ['width:calc(25% + 2px)', 'opacity:calc(.2 + .3)', 'animation-delay:calc(1s + 200ms)',
        'width:calc(1px * (2 + 3))', 'width:calc(1px / (3 - 1))', 'width:var(--width, 37px)',
        '--arithmetic:calc(var(--missing, 2s) + 1px)', '--value:var(--nested, 2s)']) assert.ok(parse_style_string(css));
    } finally {stop();mirror.dispose();}
  });
  check("unproven math cannot escape inline admission through the lexer variable exemption", () => {
    const values = [
      'min(1px + var(--missing, 2s), 10px)', 'min(var(--missing, 2s), 10px)',
      'max(1px + var(--missing, 2s), 10px)', 'max(var(--missing, 2s), 10px)',
      'clamp(1px, var(--missing, 2s), 10px)', 'clamp(1px, 1px + var(--missing, 2s), 10px)',
      'min(var(--present, 2px), 10px)', 'max(var(--missing, 1px +), 10px)',
      'clamp(1px, var(--missing, var(--nested, 2s)), 10px)',
      'min((1px + var(--missing, 2s)), 10px)', 'max(min(var(--missing, 2s), 8px), 10px)',
      'min(calc(1px + var(--missing, 2s)), 10px)', 'calc(min(var(--missing, 2s), 10px) + 1px)',
      'MIN(var(--missing, 2s), 10px)', 'm\\69 n(var(--missing, 2s), 10px)',
      'm\\61 x(var(--missing, 2s), 10px)', 'cl\\61 mp(1px, var(--missing, 2s), 10px)',
      'c\\61 lc(var(--missing, 2s) + 1px)', '-webkit-calc(var(--missing, 2s) + 1px)',
      '-moz-calc(var(--missing, 2s) + 1px)',
      'var(--width, min(var(--missing, 2s), 10px))',
      'var(--width, var(--nested, max(var(--missing, 2px), 10px)))',
      'var(--width, calc(var(--missing, 2s) + 1px))',
    ];
    const unsupportedFamilies=['round','mod','rem','sin','cos','tan','asin','acos','atan','atan2','pow','sqrt','hypot','log','exp','abs','sign','calc-size','random','progress','media-progress','container-progress'];
    for(const name of unsupportedFamilies) values.push(`${name}(var(--missing, 2px), 10px)`);
    const aggregate=hsonLiveMap.fromLibraries({page:{document:'<p style="width:37px;color:green;--present:2s"/>'}});
    const library=aggregate.doc.must('page') as unknown as LiveMapDocumentLibrary, mirror=hsonMirror(library), tree=mirror.tree.find.must.byTag('p');
    const standalone=hsonLiveTree.fromHson('<p style="width:37px;color:green"/>',{isolated:true});
    const oracle=structuredClone(tree.node), standaloneOracle=structuredClone(standalone.node), rev=library.rev, issued=runtime_for_tree(tree).issuedQuids.size;
    let notifications=0;const stop=library.commits.observe(()=>notifications++);
    try {
      for(const value of values) {
        const css=`color:red;width:${value}`;
        assert.throws(()=>parse_style_string(css),error=>error instanceof InlineCssError&&error.code==='INLINE_CSS_UNSUPPORTED',css);
        assert.throws(()=>hsonTransform.fromHson(`<p style=${JSON.stringify(css)}/>`).toNode(),InlineCssError,css);
        assert.throws(()=>Hson.document`<p style="${css}"/>`,error=>error instanceof Error&&error.cause instanceof InlineCssError&&error.cause.code==='INLINE_CSS_UNSUPPORTED',css);
        assert.throws(()=>hsonTransform.fromTrustedHtml(`<p style="${css}"></p>`).toNode(),InlineCssError,css);
        assert.throws(()=>tree.style.setMany({color:'red',width:value}),InlineCssError,value);
        assert.throws(()=>standalone.style.setMany({color:'red',width:value}),InlineCssError,value);
        assert.ok(canonical_hson_graph_equal(oracle,structuredClone(tree.node)));assert.ok(canonical_hson_graph_equal(standaloneOracle,structuredClone(standalone.node)));
        assert.equal(tree.style.get.color(),'green');assert.equal(tree.style.get.width(),'37px');assert.equal(library.rev,rev);assert.equal(notifications,0);assert.equal(runtime_for_tree(tree).issuedQuids.size,issued);
      }
      for(const value of ['min(1px,10px)','max(1px,10px)','clamp(1px,3px,10px)']) assert.throws(()=>parse_style_string(`width:${value}`),InlineCssError); // Already outside the current literal grammar.
      for(const css of ['width:calc((1px + 2px) * 2 / 3)', 'width:calc(25% + 2px)',
        'width:-webkit-calc(1px + 2px)', 'width:var(--width, 37px)',
        'width:var(--width, calc(1px + 2px))', 'color:rgb(var(--channels, 0 128 0))',
        'content:"min(var(--missing, 2s))"', 'width:calc(1px /* min(var(--missing)) */ + 2px)',
        '--math:min(var(--missing, 2s),10px)', '--literal:min(1px,10px)']) assert.ok(parse_style_string(css),css);
      const richGraph:HsonNode={$_tag:'_hson_elem',$_content:[{$_tag:'p',$_content:[],$_attrs:{style:{width:'min(var(--missing, 2s),10px)',negative:{value:-0,unit:undefined}}}}]};
      assert.ok(canonical_hson_graph_equal(richGraph,hsonTransform.fromNode(richGraph).toNode()));
      tree.style.setMany({color:'red',width:'calc(1px + 2px)'});assert.equal(library.rev,rev+1);assert.equal(notifications,1);assert.equal(tree.style.get.color(),'red');assert.equal(tree.style.get.width(),'calc(1px + 2px)');assert.equal(mirror.status,'active');
    } finally {stop();mirror.dispose();}
  });
  check("local Mirror preserves retained own-undefined typed style through accepted effects", () => {
    for(const keep of [{value:-0,unit:undefined},{value:-0},{value:-0,unit:''},{value:-0,unit:'px'}]) {
      const original: HsonNode={$_tag:'_hson_root',$_content:[{$_tag:'p',$_content:[],$_attrs:{style:{
        cssFloat:'left',opacity:'.2','--keep':keep,'--other':{value:'retained',unit:'_'},'--null':null,'--empty':'',
      }}}]};
      const sourceOracle=structuredClone(original);
      const aggregate=hsonLiveMap.fromLibraries({page:{document:original}}), library=aggregate.doc.must('page') as unknown as LiveMapDocumentLibrary;
      const authority=internal_livemap_aggregate_authority(aggregate), snapshot=authority.captureHosted();
      const mirror=hsonMirror(library),tree=mirror.tree.find.must.byTag('p');let notifications=0, hosted:HostedAggregateCommit|undefined, firstEffect:HostedAggregateCommit|undefined;
      const stop=library.commits.observe(()=>notifications++), stopAuthority=authority.observe(commit=>{hosted=commit.hosted;});
      const oracle=structuredClone(keep), other=structuredClone(tree.node.$_attrs?.style), rev=library.rev, issued=runtime_for_tree(tree).issuedQuids.size;
      const verify=(advances:number)=>{
        const style=tree.node.$_attrs?.style;assert.ok(style&&typeof style==='object');assert.deepEqual(style['--keep'],oracle);
        const leaf=style['--keep'];assert.ok(leaf&&typeof leaf==='object');assert.ok(Object.is(leaf.value,-0));assert.equal(Object.hasOwn(leaf,'unit'),Object.hasOwn(oracle,'unit'));
        assert.equal(leaf.unit,oracle.unit);assert.equal(library.rev,rev+advances);assert.equal(notifications,advances);
        assert.equal(runtime_for_tree(tree).issuedQuids.size,issued);assert.equal(mirror.status,'active');
        assert.deepEqual(style['--other'],other&&typeof other==='object'?other['--other']:undefined);
        assert.equal(style['--null'],null);assert.equal(style['--empty'],'');
      };
      try {
        assert.equal(tree.style.get.cssFloat(),'left');tree.style.set.cssFloat('left');verify(0);
        tree.style.set.cssFloat('right');verify(1);assert.equal(tree.style.get.cssFloat(),'right');
        assert.ok(hosted);const changedEffect=hosted;firstEffect=changedEffect;
        const representation=JSON.parse(changedEffect.replay.operations[0].payload);
        const carrier=decode_exact_hson_value(representation.value);assert.ok(carrier&&typeof carrier==='object'&&'$_tag' in carrier);
        const effectStyle=carrier.$_attrs?.style;assert.ok(effectStyle&&typeof effectStyle==='object');assert.deepEqual(effectStyle['--keep'],oracle);
        if(Object.hasOwn(keep,'unit')&&keep.unit===undefined) assert.throws(()=>make_portable_aggregate_commit(changedEffect),error=>error instanceof ProjectedValueAdmissionError&&error.code==='UNDEFINED_VALUE');
        tree.style.remove('cssFloat');verify(2);assert.equal(tree.style.get.cssFloat(),undefined);
        tree.style.setMany({color:'red',opacity:'.5'});verify(3);assert.equal(tree.style.get.color(),'red');
        tree.style.remove('opacity');verify(4);tree.style.remove('opacity');verify(4);
        const before=structuredClone(tree.node);assert.throws(()=>tree.style.set.width('calc(var(--missing, 2s) + 1px)'),InlineCssError);verify(4);
        assert.ok(canonical_hson_graph_equal(before,structuredClone(tree.node)));
        tree.style.set.width('3px');verify(5);assert.equal(tree.style.get.width(),'3px');
        tree.attrs.setMany({title:'retained title',hidden:true});verify(6);assert.equal(tree.node.$_attrs?.title,'retained title');
        const attrsBefore=structuredClone(tree.node);assert.throws(()=>Reflect.apply(tree.attrs.set,tree.attrs,['title',undefined]));verify(6);
        assert.ok(canonical_hson_graph_equal(attrsBefore,structuredClone(tree.node)));
        assert.ok(canonical_hson_graph_equal(sourceOracle,original));
      } finally {stopAuthority();stop();mirror.dispose();}
      assert.ok(firstEffect);authority.restoreHosted(snapshot);authority.replayHosted(firstEffect);
      const replayed=aggregate.doc.must('page').root().$_content[0];assert.ok(replayed&&typeof replayed==='object'&&'$_tag' in replayed);
      const subject=sourceOracle.$_content[0];assert.ok(subject&&typeof subject==='object'&&'$_tag' in subject&&subject.$_attrs?.style&&typeof subject.$_attrs.style==='object');
      const expected:HsonNode={...subject,$_attrs:{...subject.$_attrs,style:{...subject.$_attrs.style,cssFloat:'right'}}};
      assert.ok(canonical_hson_graph_equal(expected,replayed));
    }
    assert.throws(()=>hsonTransform.fromNode({$_tag:'_hson_elem',$_content:[{$_tag:'p',$_content:[],$_attrs:{title:undefined}}]}));
  });
  check("P4 inline vendor native and JS spellings retain prefixes and exact custom case", () => {
    const originalCase=hsonLiveTree.fromHson('<p/>');originalCase.style.set.color('red');originalCase.style.setProp('-webkit-user-select','none');
    const originalStyle=originalCase.node.$_attrs?.style;assert.ok(originalStyle && typeof originalStyle==='object');assert.equal(serialize_style(originalStyle),'-webkit-user-select: none; color: red');assert.equal(originalStyle['-webkit-user-select'],'none');
    const vendorNames: readonly (readonly [native: `${string}-${string}`, js: string])[] = [['-webkit-user-select','WebkitUserSelect'],['-moz-user-select','MozUserSelect'],['-ms-user-select','msUserSelect'],['-o-user-select','OUserSelect']];
    for (const [native, js] of vendorNames) {
      assert.deepEqual(parse_style_string(`${native}:none`), {[native]:'none'});
      for (const key of [native,js]) {const tree=hsonLiveTree.fromHson('<p/>');tree.style.setMany({[key]:'none'});assert.equal(serialize_style(tree.node.$_attrs?.style && typeof tree.node.$_attrs.style==='object' ? tree.node.$_attrs.style : undefined),`${native}: none`);assert.equal(tree.style.get[native](),'none');tree.style.remove(key);assert.equal(tree.style.get[native](),undefined);}
    }
    const tree=hsonLiveTree.fromHson('<p/>');tree.style.setMany({'--Tone':'red','--tone':'blue',backgroundColor:'black'});
    assert.equal(tree.style.get['--Tone'](),'red');assert.equal(tree.style.get['--tone'](),'blue');assert.equal(tree.style.get.backgroundColor(),'black');
  });
  check("P5 fully resolved inline batch collisions are controlled and publish nothing", () => {
    const aggregate=hsonLiveMap.fromLibraries({page:{document:'<p style="color:green"/>'}}), library=aggregate.doc.must('page') as unknown as LiveMapDocumentLibrary;
    const mirror=hsonMirror(library), tree=mirror.tree.find.must.byTag('p');let commits=0;const stop=library.commits.observe(()=>commits++);
    try {
      const original=structuredClone(tree.node), rev=library.rev, issued=runtime_for_tree(tree).issuedQuids.size;
      for(const values of [{COLOR:'red',color:'blue'},{backgroundColor:'red','background-color':'blue'},{cssFloat:'left',float:'right'},{WebkitUserSelect:'none','-webkit-user-select':'text'}]) {
        assert.throws(()=>tree.style.setMany(values),error=>error instanceof InlineCssError && error.code==='INLINE_CSS_UNSUPPORTED' && /collid/.test(error.message));
        assert.ok(canonical_hson_graph_equal(original,structuredClone(tree.node)));assert.equal(library.rev,rev);assert.equal(commits,0);assert.equal(runtime_for_tree(tree).issuedQuids.size,issued);
      }
      tree.style.set.color('red');assert.equal(library.rev,rev+1);assert.equal(commits,1);assert.equal(tree.style.get.color(),'red');assert.equal(mirror.status,'active');
    }finally{stop();mirror.dispose();}
  });
  check("rich storage stays exact across graph Binary tagged and capture boundaries", () => {
    const original: HsonNode = { $_tag: '_hson_elem', $_content: [{ $_tag: 'p', $_content: [], $_attrs: { style: {
      zero: 0, negative: -0, bool: false, nullable: null, empty: '', whitespace: '  red  ',
      absent: { value: -0 }, undefinedUnit: { value: -0, unit: undefined },
      emptyUnit: { value: 2, unit: '' }, stringUnit: { value: '2', unit: 'px' },
      fooBar: 'a', 'foo-bar': 'b', '_hson_key': 'c',
    } } }] };
    const oracle = structuredClone(original);
    const transform = hsonTransform.fromNode(original);
    for (const recovered of [transform.toNode(), hsonTransform.fromBinary(transform.toBinary().serialize()).toNode(),
      decode_exact_hson_value(encode_exact_hson_value(original))]) { assert.ok(recovered && typeof recovered === "object" && "$_tag" in recovered);assert.ok(canonical_hson_graph_equal(oracle, recovered)); }
    const root: HsonNode = { $_tag: '_hson_root', $_content: original.$_content };
    const map = hsonLiveMap.fromLibraries({ page: { document: root } });
    const restored = install_libraries_snapshot(map.capture()).map;
    assert.ok(canonical_hson_graph_equal(root, restored.doc.must('page').root()));
    const leaf = (transform.toNode().$_content[0] as HsonNode).$_attrs?.style;
    assert.ok(leaf && typeof leaf === 'object');
    assert.ok(Object.is(leaf.negative, -0));
    assert.ok(leaf.undefinedUnit && typeof leaf.undefinedUnit === 'object' && Object.hasOwn(leaf.undefinedUnit, 'unit'));
    assert.ok(leaf.absent && typeof leaf.absent === 'object' && !Object.hasOwn(leaf.absent, 'unit'));
    assert.throws(() => Hson.document.fromNode(original), /notation|closure/);
    assert.ok(canonical_hson_graph_equal(oracle, original));
    assert.throws(() => hsonTransform.fromHson('undefined').toNode());
    assert.throws(() => hsonTransform.fromNode({ $_tag: '_hson_elem', $_content: [{ $_tag: 'p', $_content: [], $_attrs: { style: { width: undefined } } }] }));
  });
  check("CSS projection uses ordinary numeric coercion without changing stored -0", () => {
    const input = { '--zero': -0, width: { value: -0, unit: 'px' } };
    assert.equal(serialize_style(input), '--zero: 0; width: 0px');
    assert.ok(Object.is(input['--zero'], -0));assert.ok(Object.is(input.width.value, -0));
    const doc = Hson.document`<main <p style="color:red"/> <style "p{color:blue}"/>/>`;
    assert.ok(Hson.document.fromNode(Hson.document.toNode(ANY_DOCUMENT.certify(doc))));
    assert.ok(hsonTransform.fromHson(doc).toHtml().serialize().includes('color: red'));
  });
}
