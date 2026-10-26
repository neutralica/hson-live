import assert from 'node:assert/strict';
import { hsonLiveMap } from '../../src/api/livemap/index.ts';
import { hsonLiveTree } from '../../src/api/livetree/livetree.facade.ts';
import { CSS_PROPERTY_NAMES } from '../../src/core/css-properties.ts';
import { css_property, normalize_css_map } from '../../src/core/css-map.ts';
import { trim_css_value_boundary } from '../../src/core/css-value-boundary.ts';
import { normalize_css_key, canon_to_css_prop } from '../../src/api/transform/utils/attrs-utils/normalize-css.ts';
import { structured_part_stylesheet } from '../../src/internal/css/structured-css.ts';
import { parse_part_stylesheet } from '../../src/internal/css/part-stylesheet.ts';
import { trim_managed_css } from '../../src/internal/css/managed-css-lexical.ts';
import { css_property_inventory } from '../../scripts/css-property-inventory.mts';
import { internal_livemap_aggregate_authority as authority } from '../../src/api/livemap/livemap.internal.ts';

const part = { kind:'document' as const, document:'<p hson:part @:label/>', css:{width:1,'& a':{color:'red'},'@:label':{color:'red'},$media:{screen:{color:'red'}}} };
const define = () => hsonLiveMap.fromLibraries({parts:{parts:{p:part}}});
const record = (input: unknown) => structured_part_stylesheet(input,new Set(['label']));

export async function structured_css_review_cases(check: (name: string, run: () => void | Promise<void>) => Promise<void>) {
  await check('review 1: CSS token boundaries survive structured rendering and match textual declarations', () => {
    const values=['\u00a0red\u00a0','\\ ','\\31 ','red\\  ','  red  ','\u2003red\u2003','λ','"λ \u00a0"','/*lead*/ red /*tail*/ ','calc(1px + 2px)','var(--x, "a,b")'];
    for (const property of ['--x','font-family']) for (const value of values) {
      const structured=record({[property]:value}), textual=parse_part_stylesheet(`:scope{${property}:${value}}`);
      assert.deepEqual(structured.rules[0]!.declarations,textual.rules[0]!.declarations,`${property}:${value}`);
      assert.equal(trim_css_value_boundary(value),trim_managed_css(value));
    }
    assert.deepEqual(record({width:{value:' 2 ',unit:'rem'},height:2}).rules.map(r=>r.declarations),[[['width','2rem']],[['height','2']]]);
    assert.equal(normalize_css_map({'--x':'\u00a0red\u00a0'})['--x'],'\u00a0red\u00a0');
    const tree=hsonLiveTree.fromHson('<p/>',{isolated:true});tree.css.setMany({'--x':'\u00a0red\u00a0','--escape':'\\ '});
    assert.match(tree.css.snapshot(),/\u00a0red\u00a0/);assert.ok(tree.css.snapshot().includes('\\ '));
    for(const value of ['red;display:none','red}body{color:red','\\',NaN,null,true]) assert.throws(()=>record({'--x':value}));
  });
  await check('review 2: maintained property inventory and all supported spellings round-trip', () => {
    assert.deepEqual([...CSS_PROPERTY_NAMES],css_property_inventory());
    for(const name of CSS_PROPERTY_NAMES) {
      assert.equal(css_property(name),name,name);
      assert.equal(css_property(normalize_css_key(name)),name,name);
      assert.equal(canon_to_css_prop(normalize_css_key(name)),name,name);
      const vendor=/^(Webkit|Moz|ms|O)([A-Z].*)$/.exec(normalize_css_key(name));
      if(vendor) {
        const heads: Record<string,string>={Webkit:'webkit',Moz:'moz',ms:'Ms',O:'o'};
        assert.equal(css_property(heads[vendor[1]!]!+vendor[2]!),name,name);
      }
    }
    for(const key of ['textBoxTrim','textBoxEdge','viewTransitionClass','readingFlow','readingOrder','-ms-scroll-limit-x-max','msScrollLimitXMax','msScrollbar3dlightColor']) assert.doesNotThrow(()=>record({[key]:'initial'}));
    for(const key of ['colour','textBoxTrimm','viewTransitionClas','readingFlew','-webkit-typo']) assert.throws(()=>record({[key]:'initial'}));
    assert.doesNotThrow(()=>record({'--1':'x','--λ':'x','--\\31 foo':'x','--x\u00a0':'x'}));
  });
  await check('Library path snapshots and captured location snapshots agree across forwarding', async () => {
    const m=define(), l=hsonLiveMap.locus.create({parts:{parts:{p:part}}},{actions:{readSnapshots(context){
      assert.equal(context.parts.parts.snap(['p','document']),part.document);
      assert.deepEqual(context.parts.parts.at([]).snap(),context.parts.parts.snap());
    }}});
    try {
      for (const library of [m.parts.parts,l.parts.parts]) {
        assert.equal(library.snap(['p','document']),part.document);
        assert.deepEqual(library.at([]).snap(),library.snap());
        assert.deepEqual(Reflect.apply(library.at([]).snap,undefined,[['p','document']]),library.snap());
        assert.equal(library.at(['p','document']).snap(),part.document);
        assert.equal(library.p.at(['kind']).snap(),'document');
        assert.match(library.p.write(),/hson-part/);
      }
      assert.equal((await l.dispatchAction({type:'action',id:'read',name:'readSnapshots'})).type,'ack');
    } finally {l.dispose();}
  });
  await check('ordinary Part-shaped Data rejects omission without acquiring Part governance', () => {
    const m=hsonLiveMap.fromLibraries({data:{data:{...part,stylesheet:''}}}), data=m.data.data.at([]);
    data.at(['css','width']).set(3);
    data.object.setKey('stylesheet',':scope{color:blue}');
    const before=m.capture(), ledger=authority(m).identityEpoch().issued();
    const invalid={...part,css:{color:undefined}};
    for(const write of [()=>data.replace(invalid as never),()=>data.set({css:invalid.css} as never),
      ()=>data.object.setKey('css',invalid.css as never),()=>m.batch(w=>w.data.data.at([]).replace(invalid as never))]) {
      assert.throws(write);assert.deepEqual(m.capture(),before);assert.equal(authority(m).identityEpoch().issued(),ledger);
    }
    assert.equal('write' in data,false);
  });
  await check('structured flat output retains textual selector, declaration, media and order behavior', () => {
    const css={color:'red','&:is(:hover,a)':{WebkitTransform:'none',__before:{color:'blue'}},
      '@:label':{'& [data-x="a,b"]':{'--x':'\\31 '}},$media:{'screen, print':{opacity:1,'@:label':{color:'green'}}}};
    assert.deepEqual(record(css),parse_part_stylesheet(`:scope{color:red}
       :scope:is(:hover,a){-webkit-transform:none}
      :scope:is(:hover,a)::before{color:blue}
      :scope:is(:hover,a)::before{content:""}
      [hson\\:quad="label"] [data-x="a,b"]{--x:\\31 }
      @media screen,print{:scope{opacity:1}[hson\\:quad="label"]{color:green}}`));
  });
  await check('Part CSS is whole-definition authoring across local, staged and Locus paths', async () => {
    const m=define(), p=m.parts.parts.p;
    const next={...part,css:{width:{value:2,unit:undefined},'& a':{color:undefined,display:'block'}}};
    p.replace(next);assert.deepEqual(p.snap()?.css,next.css && {width:{value:2},'& a':{display:'block'}});
    const before=m.capture(), ledger=authority(m).identityEpoch().issued();
    for(const location of [p,p.at([]),p.present()!,p.asObject()!,m.parts.parts.at([]).at(['p'])]) {
      for(const path of [['css'],['css','& a'],['stylesheet']]) assert.throws(()=>location.at(path as never),/field access/);
      const object=location.asObject()!.object;
      for(const call of [()=>object.getKey('css' as never),()=>object.pick(['css'] as never),()=>object.omit(['stylesheet'] as never),
        ()=>object.hasKey('css' as never),()=>object.setKey('css' as never,{} as never),()=>object.setMany({css:{}} as never),
        ()=>object.deleteKey('css' as never),()=>object.deleteMany(['stylesheet'] as never),()=>object.renameKey('document','css' as never),
        ()=>object.renameKey('css' as never,'document')]) assert.throws(call,/field access/);
    }
    assert.throws(()=>m.parts.parts.snap(['p','css'] as never),/field access/);
    assert.throws(()=>p.set({css:{color:'blue'}} as never),/complete definition/);
    assert.throws(()=>p.update(()=>({stylesheet:''}) as never),/complete definition/);
    assert.throws(()=>m.batch(w=>{w.parts.parts.p.set({document:'<a/>'});w.parts.parts.p.at(['css'] as never);}),/field access/);
    assert.throws(()=>m.batch(w=>w.parts.parts.p.asObject().object.setKey('css' as never,{} as never)),/field access/);
    assert.deepEqual(m.capture(),before);assert.equal(authority(m).identityEpoch().issued(),ledger);
    m.batch(w=>w.parts.parts.p.replace(next));
    const l=hsonLiveMap.locus.create({parts:{parts:{p:part}}});
    try {
      for(const path of [['css'],['stylesheet']]) assert.throws(()=>l.parts.parts.p.at(path as never),/field access/);
      assert.throws(()=>l.parts.parts.snap(['p','css'] as never),/field access/);
      await assert.rejects(l.parts.parts.p.asObject()!.object.setMany({css:{}} as never),/field access/);
      await assert.rejects(l.parts.parts.p.set({css:{color:'blue'}} as never),/complete definition/);
      await assert.rejects(l.stage(w=>w.parts.parts.p.at(['css'] as never)),/field access/);
      await l.parts.parts.p.replace(next);assert.deepEqual(l.parts.parts.p.snap()?.css,p.snap()?.css);
    } finally {l.dispose();}
    let reads=0;const cycle: Record<string,unknown>={};cycle['& a']=cycle;
    for(const css of [{color:null},{color:true},{colour:undefined},Object.create({color:'red'}),cycle,{get color(){reads++;return 'red';}}]) {
      assert.throws(()=>p.replace({...part,css} as never));assert.deepEqual(m.capture(),before);
    }
    assert.equal(reads,0);
    const data=hsonLiveMap.fromLibraries({data:{data:{kind:'document',document:'<p hson:part/>',css:{color:true},stylesheet:false}},parts:{parts:{css:part}}});
    data.data.data.at(['css','color']).set(false);data.data.data.at(['stylesheet']).set(true);
    assert.equal(data.data.data.snap(['css','color']),false);assert.equal(data.parts.parts.at(['css']).snap()?.kind,'document');
    assert.throws(()=>data.parts.parts.at(['css','css'] as never),/field access/);
    assert.throws(()=>data.data.data.at(['css']).set({color:undefined} as never));
  });
  await check('review 4: malformed lists reject without losing valid function/string/escape commas', () => {
    for(const selector of ['& a,','& a, /*tail*/',',& a','& a,,& b','& a, ,& b',' , ','& :is(a,)','& :not(a,,b)','& :has(> a,)']) {
      assert.throws(()=>record({[selector]:{color:'red'}}),selector);
      assert.throws(()=>record({'@:label':{[selector]:{color:'red'}}}),selector);
    }
    for(const condition of ['screen,','screen, /*tail*/',',screen','screen,,print','screen, ,print',' , ']) assert.throws(()=>record({$media:{[condition]:{color:'red'}}}),condition);
    for(const selector of ['& :is(a,b):not(.a,.b)','& [data-x="a,b"].a\\,b','&:has(> a, > b)']) assert.doesNotThrow(()=>record({'@:label':{[selector]:{color:'red'}}}));
    for(const condition of ['screen and (width > 10px), print','(width > 10px) and (orientation: landscape)','(color), (monochrome)']) assert.doesNotThrow(()=>record({$media:{[condition]:{color:'red'}}}));
  });
  await check('review 6: vendor aliases normalize equally and collide before mutation', () => {
    for(const prefix of [['Webkit','webkit','-webkit-'],['Moz','moz','-moz-'],['ms','Ms','-ms-'],['O','o','-o-']]) {
      const native=prefix[2]+'transform';for(const key of [prefix[0]+'Transform',prefix[1]+'Transform',native])assert.equal(css_property(key),native);
      assert.throws(()=>record({[prefix[0]+'Transform']:'none',[prefix[1]+'Transform']:'none'}));
      const tree=hsonLiveTree.fromHson('<p/>',{isolated:true});tree.css.setMany({[prefix[1]+'Transform']:'none'} as never);
      assert.ok(tree.css.snapshot().includes(native));
    }
  });
}
