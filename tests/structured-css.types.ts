import { hsonLiveMap, type LiveMapLibraryPathHandle, type LiveMapDocumentPart, type LiveMapPartCollection, type LiveMapWriteValue } from 'hson-live/livemap';
import { hsonLiveTree, type CssMap } from 'hson-live/livetree';
import type { LocusActionContext } from 'hson-live/locus';
import type { Echo } from 'hson-live/echo';
const css: CssMap = { color:'red', backgroundColor:'blue', 'border-radius':'50%', '-webkit-user-select':'none', msTransform:'none', '--tone':'red',
  '& a, & b': { _hover: { color:'red' } }, '@:current': { fontWeight:'bold' }, $media:{screen:{gap:1,color:undefined}} };
const shared: import('hson-live/livemap').CssMap = css;
const defs = {parts:{parts:{nav:{kind:'document',document:'<nav @:current/>',css:shared,stylesheet:':scope{color:blue}'}}},
  page:{document:'<html <head/> <body <hson-part lib="parts" at="nav"/>/>/>',stylesheet:'body{margin:0}'}} as const;
hsonLiveMap.fromLibraries(defs);
// Flat keyed Parts contextually type CSS without an author-supplied annotation.
hsonLiveMap.fromLibraries({parts:{parts:{nav:{kind:'document',document:'<nav @:current/>',css:{
  color:'red',backgroundColor:undefined,width:{value:2,unit:undefined},_hover:{opacity:.5},
  '& > a':{textDecoration:'none'},'@:current':{fontWeight:'bold'},
  $media:{screen:{gap:1,'@:current':{color:'blue'}}},
}}}}});
hsonLiveMap.locus.create({parts:{parts:{nav:{kind:'document',document:'<nav @:current/>',css:{
  color:undefined,_focus:{outline:'0'},'@:current':{fontWeight:900},$media:{screen:{gap:1}},
}}}}});
// @ts-expect-error unsupported property
const badProperty: CssMap = { colour:'red' };
// @ts-expect-error bare nested selector
const bare: CssMap = { a:{color:'red'} };
// @ts-expect-error declarative null is not deletion
const nullable: CssMap = { color:null };
// @ts-expect-error boolean is not a declaration
const bool: CssMap = { color:true };
// @ts-expect-error unknown group
const supports: CssMap = { $supports:{screen:{color:'red'}} };
// @ts-expect-error media groups do not recurse
const recursiveMedia: CssMap = { $media:{screen:{$media:{print:{color:'red'}}}} };
// @ts-expect-error nested QUAD references are outside V0
const nestedQuad: CssMap = { '@:current':{'@:other':{color:'red'}} };
// @ts-expect-error old textual css field
hsonLiveMap.fromLibraries({parts:{parts:{p:{kind:'document',document:'<p/>',css:'p{color:red}'}}}});
// @ts-expect-error whole Documents have no structured default subject
hsonLiveMap.fromLibraries({page:{document:'<main/>',css:{color:'red'}}});
// @ts-expect-error old textual Document css input
hsonLiveMap.fromLibraries({page:{document:'<main/>',css:'main{color:red}'}});
void [badProperty,bare,nullable,bool,supports,recursiveMedia,nestedQuad];

// @ts-expect-error generic library inference must also reject a typo alongside a known property
hsonLiveMap.fromLibraries({parts:{parts:{p:{kind:'document',document:'<p/>',css:{color:'red',colour:'blue'}}}}});

// Review 5: single-member writes must retain the same recursive evidence as collection writes.
const single = hsonLiveMap.fromLibraries({parts:{parts:{p:{kind:'document',document:'<p/>'}}}});
single.parts.parts.p.set({kind:'document',document:'<p/>',css:{color:undefined,width:{value:2,unit:undefined}}});
single.parts.parts.p.replace({kind:'document',document:'<p/>',css:{'& a':{color:'red'}}});
// @ts-expect-error single member set must reject a typo beside a valid property
single.parts.parts.p.set({kind:'document',document:'<p/>',css:{color:'red',colour:'blue'}});
// @ts-expect-error single member replacement must reject unsupported selectors
single.parts.parts.p.replace({kind:'document',document:'<p/>',css:{color:'red',a:{color:'blue'}}});
// @ts-expect-error member update must preserve recursive checking
single.parts.parts.p.update(()=>({css:{color:'red',colour:'blue'}}));
single.batch(writer=>{
  writer.parts.parts.p.set({kind:'document',document:'<p/>',css:{color:undefined,width:{value:2,unit:undefined}}});
  // @ts-expect-error staged member set must reject misspelled properties
  writer.parts.parts.p.set({kind:'document',document:'<p/>',css:{color:'red',colour:'blue'}});
  // @ts-expect-error staged member replacement must reject nested media
  writer.parts.parts.p.replace({kind:'document',document:'<p/>',css:{$media:{screen:{$media:{print:{color:'red'}}}}}});
});
const governed=hsonLiveMap.locus.create({parts:{parts:{p:{kind:'document',document:'<p/>'}}}});
void governed.parts.parts.p.set({kind:'document',document:'<p/>',css:{color:undefined}});
// @ts-expect-error Locus member set must reject the reported typo
void governed.parts.parts.p.set({kind:'document',document:'<p/>',css:{color:'red',colour:'blue'}});
// @ts-expect-error Locus member replacement must reject unsupported groups
void governed.parts.parts.p.replace({kind:'document',document:'<p/>',css:{$supports:{color:'red'}}});
void governed.stage(writer=>{
  // @ts-expect-error Locus stage must reject misspelled properties
  writer.parts.parts.p.set({kind:'document',document:'<p/>',css:{color:'red',colour:'blue'}});
});
// Review 2 and 6: modern properties and established vendor capitalization aliases.
const aliases: CssMap = {textBoxTrim:'trim-both',textBoxEdge:'cap alphabetic',viewTransitionClass:'card',readingFlow:'flex-visual',readingOrder:1,
  WebkitTransform:'none',webkitTransform:'none',MozTransform:'none',mozTransform:'none',msTransform:'none',MsTransform:'none',OTransform:'none',oTransform:'none',
  MsScrollbar3dlightColor:'red',msScrollLimitXMax:'1px'};
// @ts-expect-error vendor parity must not allow arbitrary spellings
const badAlias: CssMap = {webkitTransfrm:'none'};
void [aliases,badAlias];

single.parts.parts.at([]).asObject()!.object.setKey('other',{kind:'document',document:'<p/>',css:{color:undefined}});
// @ts-expect-error collection member writes reuse the recursive CssMap check
single.parts.parts.at([]).asObject()!.object.setKey('other',{kind:'document',document:'<p/>',css:{color:'red',colour:'blue'}});

// Authenticated Parts alone restrict field paths and partial CSS proposals.
// @ts-expect-error CSS fields have no public location
single.parts.parts.p.at(['css']);
// @ts-expect-error Textual CSS fields have no public location
single.parts.parts.at(['p','stylesheet']);
// @ts-expect-error Empty navigation and refinements retain provenance
single.parts.parts.p.at([]).present()!.asObject()!.at(['css']);
// @ts-expect-error Path snapshots cannot select protected fields
single.parts.parts.snap(['p','css']);
// @ts-expect-error Member key reads cannot select protected fields
single.parts.parts.p.asObject()!.object.getKey('css');
// @ts-expect-error Partial CSS patches are not complete definitions
single.parts.parts.p.set({css:{color:'red'}});
// @ts-expect-error Member key writes cannot select protected fields
single.parts.parts.p.asObject()!.object.setKey('css',{color:'red'});
// @ts-expect-error Key patches cannot select protected fields
single.parts.parts.p.asObject()!.object.setMany({css:{color:'red'}});
// @ts-expect-error Key renames cannot select protected fields
single.parts.parts.p.asObject()!.object.renameKey('document','stylesheet');
single.batch(writer=>{
  // @ts-expect-error Staging preserves path restrictions
  writer.parts.parts.at([]).at(['p']).asObject().at([]).at(['css']);
  // @ts-expect-error Staging forbids CSS field deletion
  writer.parts.parts.p.asObject().object.deleteKey('css');
});
// @ts-expect-error Locus preserves path restrictions
void governed.parts.parts.p.at(['stylesheet']);
const ordinary=hsonLiveMap.fromLibraries({data:{data:{kind:'document',document:'<p/>',css:{color:true},stylesheet:false}}});
ordinary.data.data.at([]).set({css:{color:false}});
ordinary.data.data.at(['css','color']).set(false);
ordinary.data.data.at(['stylesheet']).set(true);
// @ts-expect-error Ordinary Data does not acquire declarative omission
ordinary.data.data.at([]).set({css:{color:undefined}});
// @ts-expect-error Ordinary Data replacement remains JSON
ordinary.data.data.at([]).replace({kind:'document',document:'<p/>',css:{color:undefined},stylesheet:false});
const cssNamed=hsonLiveMap.fromLibraries({parts:{parts:{css:{kind:'document',document:'<p/>'}}}});
cssNamed.parts.parts.at(['css']).write();

// @ts-expect-error Even non-exact optional mode cannot admit partial CSS undefined writes.
single.parts.parts.p.set({css:undefined});
// @ts-expect-error Object patch helpers cannot select CSS, even when omitted by value.
single.parts.parts.p.asObject()!.object.setMany({css:undefined});

cssNamed.parts.parts.at([]).object.getKey('css');
cssNamed.parts.parts.at([]).object.pick(['css']);
single.parts.parts.p.asObject()!.object.getKey('document') satisfies string;
// @ts-expect-error Non-CSS key writes retain property-specific proposal types.
single.parts.parts.p.asObject()!.object.setKey('document',true);

// Library snapshots select paths; locations only read their captured coordinate.
declare const read: LocusActionContext<typeof single>;
declare const echo: Echo<typeof single>;
for (const library of [single.parts.parts, governed.parts.parts, read.parts.parts, echo.parts.parts]) {
  library.snap(['p','document']) satisfies string | undefined;
  library.at([]).snap().p satisfies LiveMapDocumentPart | undefined;
  library.at(['p','document']).snap() satisfies string | undefined;
  // @ts-expect-error A root location does not implement path snapshots.
  library.at([]).snap(['p','document']);
  // @ts-expect-error Refinement does not confer Library snapshot overloads.
  library.at([]).asObject()!.at([]).snap(['p','document']);
  // @ts-expect-error Member locations have no path-taking snap either.
  library.p.snap(['document']);
  // @ts-expect-error Genuine Library path snapshots still forbid CSS.
  library.snap(['p','stylesheet']);
}
single.batch(writer => {
  // @ts-expect-error Staged Libraries have no snapshot API.
  writer.parts.parts.snap();
  // @ts-expect-error Staged locations have no snapshot API.
  writer.parts.parts.at([]).snap();
});

// Part-shaped generic Data must still satisfy JSON proposals in both optional modes.
declare const dataPart: LiveMapLibraryPathHandle<LiveMapDocumentPart>;
dataPart.replace({kind:'document',document:'<p/>',css:{color:'red'}});
// @ts-expect-error A Part-shaped Data value cannot use Part omission semantics.
dataPart.replace({kind:'document',document:'<p/>',css:{color:undefined}});
// @ts-expect-error Generic proposal aliases cannot admit nested undefined either.
const invalidData: LiveMapWriteValue<LiveMapDocumentPart> = {kind:'document',document:'<p/>',css:{width:{value:2,unit:undefined}}};
dataPart.at(['css','color']).set('blue');
declare const dataParts: LiveMapLibraryPathHandle<LiveMapPartCollection>;
dataParts.replace({p:{kind:'document',document:'<p/>',css:{color:'red'}}});
// @ts-expect-error Collections of Part-shaped Data also remain ordinary JSON.
dataParts.replace({p:{kind:'document',document:'<p/>',css:{color:undefined}}});
single.parts.parts.p.replace({kind:'document',document:'<p/>',css:{width:{value:2,unit:undefined},color:undefined}});
single.parts.parts.at([]).object.setMany({newPart:{kind:'document',document:'<p/>',css:{color:undefined}}});

// All stylesheet receivers share the portable vocabulary; resolution is contextual.
const tree = hsonLiveTree.fromHson('<p/>');
const supported = {backgroundColor:'red',WebkitTransform:'none',width:{value:2,unit:'rem'},'& > a':{_hover:{color:'blue'}}};
tree.css.setMany(supported);
tree.css.global.sel('.x').setMany({color:'red',_hover:{opacity:1}});
tree.style.setMany({color:'red','--tone':'blue'});
tree.css.media('screen').setMany({color:'red'});
// @ts-expect-error Null is not a declaration value.
tree.css.set.color(null);
tree.css.set.color(undefined);
tree.css.setMany({$media:{screen:{color:'red'}}});
tree.css.setMany({'@:label':{color:'red'}});
tree.css.setMany(css);
const namedQuad: CssMap = {'@:label':{color:'red'}};
tree.css.setMany(namedQuad);
const nestedMedia = {'& a':{$media:{screen:{color:'red'}}}};
// @ts-expect-error Named nested values retain recursive grammar checks.
tree.css.setMany(nestedMedia);
// @ts-expect-error Existing declaration typo checking remains strict.
tree.css.setMany({colour:'red'});


// Inline maps retain the declaration vocabulary and reject branches after inference.
const inlineDeclarations = { backgroundColor: 'navy', 'border-radius': '50%', WebkitTransform: 'none',
  '--tone': 'gold', width: { value: 2, unit: 'rem' }, color: undefined };
tree.style.setMany(inlineDeclarations);
tree.style.setMany({ width: { value: 2, unit: undefined }, opacity: undefined });
// @ts-expect-error Null is not a declaration value.
tree.style.set.color(null);
tree.style.setProp('--tone', undefined);
tree.style.remove('width');
tree.style.clear();
const inlinePseudo = { color: 'red', _hover: { color: 'blue' } };
const inlineRelative = { color: 'red', '& > a': { color: 'blue' } };
const inlineTypo = { color: 'red', colour: 'blue' };
// @ts-expect-error Inline styles do not contain pseudo rules.
tree.style.setMany({ color: 'red', _hover: { color: 'blue' } });
// @ts-expect-error Inference must not hide inline pseudo rules.
tree.style.setMany(inlinePseudo);
// @ts-expect-error Inline styles do not contain relative selector rules.
tree.style.setMany({ '& > a': { color: 'blue' } });
// @ts-expect-error Inference must not hide inline relative rules.
tree.style.setMany(inlineRelative);
// @ts-expect-error Inferred inline declaration names remain checked.
tree.style.setMany(inlineTypo);
// @ts-expect-error Inline omission does not permit stylesheet branch keys.
tree.style.setMany({ color: 'red', _hover: undefined });
const inlineSelection = tree.findAll.byTag('p');
inlineSelection.style.setMany(inlineDeclarations);
// @ts-expect-error Broadcast inline access retains declaration-only typing.
inlineSelection.style.setMany(inlinePseudo);
tree.create.svg().style.setMany(inlineDeclarations);
// @ts-expect-error SVG inline access also rejects recursive branches.
tree.create.svg().style.setMany(inlineRelative);
tree.css.selector('& > a').setMany({ _hover: { '& > b': { color: 'blue' } }, '& > i': { __before: { color: 'red' } } });

// Portable named CssMap values pass directly through every stylesheet surface.
declare const portable: CssMap;
declare const row: typeof tree;
row.create.span().css.setMany(portable);
tree.findAll.byTag('p').css.setMany(portable);
for (const handle of [tree.css, tree.css.selector('& > a'), tree.css.media('screen'),
  tree.css.supports('(display:grid)').layer('theme'), tree.css.global.sel('.card'),
  tree.css.global.rule('card', '.card')]) handle.setMany(portable);
const imperativeMap = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body/>/>' } });
const imperativeCss = imperativeMap.doc.must('page').css;
imperativeCss.sel('.card').setMany(portable);
imperativeCss.layer('theme').supports('(display:grid)').media('screen').rule('card', '.card').setMany(portable);
imperativeMap.batch(writer => writer.doc.must('page').css.sel('.card').setMany(portable));
const imperativeLocus = hsonLiveMap.locus.create({ page: { document: '<html <head/> <body/>/>' } });
void imperativeLocus.doc.must('page').css.sel('.card').setMany(portable);
void tree.async.css.global.sel('.card').setMany(portable);
void tree.async.css.global.rule('card', '.card').setMany(portable);
const recursive: CssMap = { _hover: { '& > a': { _focus: { color: undefined } } },
  $media: { screen: { '@:label': { __before: { content: '"authored"' } } } } };
imperativeCss.sel('.card').setMany(recursive);
// @ts-expect-error Inline authoring remains declaration-only for named maps.
tree.style.setMany(portable);
// @ts-expect-error Unqualified nested records are outside CssMap.
imperativeCss.sel('.card').setMany({ child: { color: 'red' } });
// @ts-expect-error Unsupported declaration properties remain rejected.
imperativeCss.sel('.card').setMany({ colour: 'red' });
// @ts-expect-error Null rejects on Document CSS.
imperativeCss.sel('.card').setMany({ color: null });
// @ts-expect-error Booleans reject on async Document CSS.
void tree.async.css.global.sel('.card').setMany({ color: false });
// @ts-expect-error Arrays are not stylesheet maps.
imperativeCss.sel('.card').setMany(['red']);
const indexedNested: Readonly<Record<string, { color: string }>> = { child: { color: 'red' } };
// @ts-expect-error Indexed nesting cannot prove qualified branch keys.
imperativeCss.sel('.card').setMany(indexedNested);
