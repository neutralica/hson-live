import type { HsonAttrs, HsonNode, Primitive } from "../../src/core/types.ts";

export const str = (value: string): HsonNode => ({ $_tag: "_hson_str", $_content: [value] });
export const val = (value: Exclude<Primitive, string>): HsonNode => ({ $_tag: "_hson_val", $_content: [value] });
export const obj = (...content: HsonNode[]): HsonNode => ({ $_tag: "_hson_obj", $_content: content });
export const elem = (...content: HsonNode[]): HsonNode => ({ $_tag: "_hson_elem", $_content: content });
export const named = (tag: string, ...content: HsonNode[]): HsonNode => ({ $_tag: tag, $_content: content });
export const root = (...content: HsonNode[]): HsonNode => ({ $_tag: "_hson_root", $_content: content });
export const arr = (...content: HsonNode[]): HsonNode => ({
  $_tag: "_hson_arr",
  $_content: content.map((child, index) => ({ $_tag: "_hson_ii", $_meta: { index: String(index) }, $_content: [child] })),
});

type SourceFixture = Readonly<{ id: string; source: string; graph: HsonNode }>;

type HtmlQuotingFixture = SourceFixture & Readonly<{ quoted: string; untrusted: boolean }>;
const attributed = (tag: string, attrs: HsonAttrs, ...content: HsonNode[]): HsonNode => ({
  ...named(tag, ...content), $_attrs: attrs,
});

// The graph oracle is independent of either lexical spelling or runtime parser.
export const htmlQuotingFixtures: readonly HtmlQuotingFixture[] = [
  { id: "ordinary unquoted class", source: '<div class=column></div>', quoted: '<div class="column"></div>',
    graph: root(elem(attributed('div', { class: 'column' }))), untrusted: true },
  { id: "mixed quotes and embedded delimiters", source: `<div title="a > b < c / >" class=column data-note='two words' id=kept></div>`,
    quoted: `<div title="a > b < c / >" class="column" data-note='two words' id="kept"></div>`,
    graph: root(elem(attributed('div', { title: 'a > b < c / >', class: 'column', 'data-note': 'two words', id: 'kept' }))), untrusted: true },
  { id: "Unicode and HTML whitespace boundaries", source: '<div title=雪🙂 data-value=a\u00a0b\tclass=column\n id=kept></div>',
    quoted: '<div title="雪🙂" data-value="a\u00a0b"\tclass="column"\n id="kept"></div>',
    graph: root(elem(attributed('div', { title: '雪🙂', 'data-value': 'a\u00a0b', class: 'column', id: 'kept' }))), untrusted: true },
  { id: "punctuation is ordinary HTML data", source: String.raw`<div data-value=./a:b?c#d@!$%()*+,-_~[]{}|\ lib=not/a/selector at=plain/path></div>`,
    quoted: String.raw`<div data-value="./a:b?c#d@!$%()*+,-_~[]{}|\" lib="not/a/selector" at="plain/path"></div>`,
    graph: root(elem(attributed('div', { 'data-value': './a:b?c#d@!$%()*+,-_~[]{}|\\', lib: 'not/a/selector', at: 'plain/path' }))), untrusted: false },
  { id: "HTML values do not acquire Hson operand ownership", source: '<hson-part lib=not/a/selector at=too/many/segments data-param=%{name} data-path=^{item.label}></hson-part>',
    quoted: '<hson-part lib="not/a/selector" at="too/many/segments" data-param="%{name}" data-path="^{item.label}"></hson-part>',
    graph: root(elem(attributed('hson-part', { lib: 'not/a/selector', at: 'too/many/segments', 'data-param': '%{name}', 'data-path': '^{item.label}' }))), untrusted: false },
  { id: "character references decode once", source: '<a href=https://example.test/a?x&#61;1&amp;y&#61;2 data-value=&amp;lt;&#x1F642;&#34;&#39;&#60;&#62; title=caf&eacute;></a>',
    quoted: '<a href="https://example.test/a?x&#61;1&amp;y&#61;2" data-value="&amp;lt;&#x1F642;&#34;&#39;&#60;&#62;" title="caf&eacute;"></a>',
    graph: root(elem(attributed('a', { href: 'https://example.test/a?x=1&y=2', 'data-value': '&lt;🙂"\'<>', title: 'café' }))), untrusted: true },
  { id: "class normalization preserves character references", source: '<div class=caf&eacute;-&copy;-&#x96EA;-&amp;lt;></div>',
    quoted: '<div class="caf&eacute;-&copy;-&#x96EA;-&amp;lt;"></div>',
    graph: root(elem(attributed('div', { class: 'café-©-雪-&lt;' }))), untrusted: true },
  { id: "bare ampersands and literal escape characters", source: String.raw`<div title=a&b data-value=literal\n></div>`,
    quoted: String.raw`<div title="a&b" data-value="literal\n"></div>`,
    graph: root(elem(attributed('div', { title: 'a&b', 'data-value': String.raw`literal\n` }))), untrusted: true },
  { id: "valueless, empty and absent attributes keep the existing contract", source: `<div data-flag data-empty="" data-single='' data-value=ready></div>`,
    quoted: `<div data-flag data-empty="" data-single='' data-value="ready"></div>`,
    graph: root(elem(attributed('div', { 'data-flag': 'data-flag', 'data-empty': 'data-empty', 'data-single': 'data-single', 'data-value': 'ready' }))), untrusted: true },
  { id: "quoted whitespace keeps trusted ingress semantics", source: '<div data-space=" " data-value=ready></div>',
    quoted: '<div data-space=" " data-value="ready"></div>',
    graph: root(elem(attributed('div', { 'data-space': '', 'data-value': 'ready' }))), untrusted: false },
  { id: "boolean attributes and a separated self-closing delimiter", source: '<input disabled data-value=ready />', quoted: '<input disabled data-value="ready" />',
    graph: root(elem(attributed('input', { disabled: 'disabled', 'data-value': 'ready' }))), untrusted: false },
  { id: "void elements and adjacent value slash", source: '<img alt=雪 src=pic.svg/><br class=break>', quoted: '<img alt="雪" src="pic.svg/"/><br class="break">',
    graph: root(elem(attributed('img', { alt: '雪', src: 'pic.svg/' }), attributed('br', { class: 'break' }))), untrusted: false },
  { id: "comments and text are not attributes", source: '<!-- > <span bad= > --><p class=column>before 1 &lt; 2 &amp; after</p>',
    quoted: '<!-- > <span bad= > --><p class="column">before 1 &lt; 2 &amp; after</p>',
    graph: root(elem(attributed('p', { class: 'column' }, elem(str('before 1 < 2 & after'))))), untrusted: true },
  { id: "supported script and style text", source: '<script type=text/javascript>const n = 1 < 2 && 3 > 2;</script><style media=screen>p { color: red; }</style>',
    quoted: '<script type="text/javascript">const n = 1 < 2 && 3 > 2;</script><style media="screen">p { color: red; }</style>',
    graph: root(elem(attributed('script', { type: 'text/javascript' }, elem(str('const n = 1 < 2 && 3 > 2;'))),
      attributed('style', { media: 'screen' }, elem(str('p { color: red; }'))))), untrusted: false },
  ...[
    ['&constructor;', '&constructor;'],
    ['&toString;', '&toString;'],
    ['&hasOwnProperty;', '&hasOwnProperty;'],
    ['&valueOf;', '&valueOf;'],
    ['&__proto__;', '&__proto__;'],
    ['&unknownEntity;', '&unknownEntity;'],
    ['&copy;', '©'],
    ['a&nbsp;b', 'a\u00a0b'],
    ['caf&eacute;', 'café'],
    ['&#169;-&#x96EA;-&#34;', '©-雪-"'],
    ['&amp;', '&'],
    ['&amp;amp;', '&amp;'],
    ['&amp;constructor;', '&constructor;'],
    ['&amp;amp;constructor;', '&amp;constructor;'],
    ['&amp;copy;', '&copy;'],
  ].map(([source, value]) => ({
    id: `HTML class entity ${source}`,
    source: `<div class=${source}></div>`,
    quoted: `<div class="${source}"></div>`,
    graph: root(elem(attributed('div', { class: value }))),
    untrusted: true,
  })),
];

export const invalidHtmlQuotingFixtures = [
  '<div class=></div>', '<input data-value= />', '<div data-value= ></div>',
  '<div @bad=value></div>', '<div _hson_attr_transit_61=value></div>', '<div hson:quid=000000001></div>',
  '<_hson_ii hson:index=0></_hson_ii>', '<_hson_elem><p class=column></p></_hson_elem>',
];

export const scalarHtmlFixtures: readonly SourceFixture[] = [
  ...["", "x"].map(text => ({ id: `STR(${JSON.stringify(text)})`, source: `<_hson_obj>${text === "" ? '""' : text}</_hson_obj>`, graph: root(str(text)) })),
  ...[-0, 1, true, false, null].map(value => ({ id: `VAL(${Object.is(value, -0) ? "-0" : String(value)})`, source: `<_hson_obj><_hson_val>${Object.is(value, -0) ? "-0" : String(value)}</_hson_val></_hson_obj>`, graph: root(val(value)) })),
];

export const memberHtmlFixtures: readonly SourceFixture[] = [
  ...scalarHtmlFixtures.map(fixture => ({ id: `member ${fixture.id}`, source: `<_hson_obj><a>${fixture.source}</a></_hson_obj>`, graph: root(obj(named("a", obj(...fixture.graph.$_content.filter((child): child is HsonNode => typeof child === "object" && child !== null))))) })),
  ...[-0, 1, true, false, null].map(value => ({ id: `direct member VAL(${Object.is(value, -0) ? "-0" : String(value)})`, source: `<_hson_obj><a><_hson_val>${Object.is(value, -0) ? "-0" : String(value)}</_hson_val></a></_hson_obj>`, graph: root(obj(named("a", obj(val(value))))) })),
  { id: "direct member STR", source: `<_hson_obj><a>x</a></_hson_obj>`, graph: root(obj(named("a", obj(str("x"))))) },
  { id: "direct member empty STR", source: `<_hson_obj><a>""</a></_hson_obj>`, graph: root(obj(named("a", obj(str(""))))) },
  { id: "nested object", source: `<_hson_obj><a><_hson_obj><b><_hson_val>1</_hson_val></b></_hson_obj></a></_hson_obj>`, graph: root(obj(named("a", obj(named("b", obj(val(1))))))) },
  { id: "array relationship and physical indexes", source: `<_hson_obj><a><_hson_arr><_hson_ii hson:index="1"><_hson_val>true</_hson_val></_hson_ii><_hson_ii hson:index="0"><_hson_val>-0</_hson_val></_hson_ii></_hson_arr></a></_hson_obj>`, graph: root(obj(named("a", arr(val(-0), val(true))))) },
  { id: "empty object relationship", source: `<_hson_obj><a><_hson_obj/></a></_hson_obj>`, graph: root(obj(named("a", obj()))) },
  { id: "empty array relationship", source: `<_hson_obj><a><_hson_arr/></a></_hson_obj>`, graph: root(obj(named("a", arr()))) },
  { id: "ordered integer-like members", source: `<_hson_obj><_-_-10><_hson_val>1</_hson_val></_-_-10><_-_-2><_hson_val>2</_hson_val></_-_-2><a>x</a></_hson_obj>`, graph: root(obj(named("10", obj(val(1))), named("2", obj(val(2))), named("a", obj(str("x"))))) },
];

export const invalidHtmlFixtures: readonly string[] = [
  `<_hson_obj><_hson_obj/></_hson_obj>`,
  `<_hson_obj><_hson_arr/></_hson_obj>`,
  `<_hson_obj>x<_hson_val>1</_hson_val></_hson_obj>`,
  `<_hson_obj><a/></_hson_obj>`,
  `<_hson_obj><a><p/></a></_hson_obj>`,
  `<_hson_obj><a><_hson_obj/><_hson_arr/></a></_hson_obj>`,
  `<_hson_obj><a><_hson_val>1</_hson_val><_hson_val>2</_hson_val></a></_hson_obj>`,
  `<_hson_ii hson:index="0"><_hson_val>1</_hson_val></_hson_ii>`,
  `<_hson_root><_hson_root/></_hson_root>`,
  `<_hson_arr><_hson_ii hson:index="0"><_hson_obj><_hson_val>1</_hson_val></_hson_obj></_hson_ii></_hson_arr>`,
  `<_hson_arr><_hson_ii hson:index="0"><_hson_obj>x</_hson_obj></_hson_ii></_hson_arr>`,
  `<_hson_arr><_hson_ii hson:index="0"><p/></_hson_ii></_hson_arr>`,
  `<_hson_arr><_hson_ii hson:index="0"><_hson_elem><p/></_hson_elem></_hson_ii></_hson_arr>`,
];

export const arrayHtmlFixtures: readonly SourceFixture[] = [
  { id: 'nested array external index lowering', source: '<_hson_arr><_hson_ii hson:index="0"><_hson_arr><_hson_ii hson:index="1"><_hson_val>true</_hson_val></_hson_ii><_hson_ii hson:index="0"><_hson_val>-0</_hson_val></_hson_ii></_hson_arr></_hson_ii></_hson_arr>', graph: root(arr(arr(val(-0), val(true)))) },
  { id: 'ordered array data roles', source: '<_hson_arr><_hson_ii hson:index="0"><_hson_val>-0</_hson_val></_hson_ii><_hson_ii hson:index="1">x</_hson_ii><_hson_ii hson:index="2"><_hson_obj><a><_hson_val>1</_hson_val></a></_hson_obj></_hson_ii><_hson_ii hson:index="3"><_hson_arr><_hson_ii hson:index="0"><_hson_val>true</_hson_val></_hson_ii></_hson_arr></_hson_ii><_hson_ii hson:index="4"><_hson_obj/></_hson_ii><_hson_ii hson:index="5"><_hson_arr/></_hson_ii></_hson_arr>', graph: root(arr(val(-0), str('x'), obj(named('a', obj(val(1)))), arr(val(true)), obj(), arr())) },
];

export const mixedSvgFixtures: readonly SourceFixture[] = [
  { id: 'SVG then element', source: '<svg/><p/>', graph: root(elem(named('svg'), named('p'))) },
  { id: 'element then SVG', source: '<p/><svg/>', graph: root(elem(named('p'), named('svg'))) },
  { id: 'SVG then text', source: '<svg/>tail', graph: root(elem(named('svg'), str('tail'))) },
  { id: 'text then SVG', source: 'lead<svg/>', graph: root(elem(str('lead'), named('svg'))) },
  { id: 'three siblings', source: '<svg/><p/><span/>', graph: root(elem(named('svg'), named('p'), named('span'))) },
  { id: 'attributed SVG and trailing content', source: '<svg viewBox="0 0 10 10"><g id="kept"/></svg>tail<p/>', graph: root(elem({ ...named('svg', elem({ ...named('g'), $_attrs: { id: 'kept' } })), $_attrs: { viewBox: '0 0 10 10' } }, str('tail'), named('p'))) },
  { id: 'ordinary comments and whitespace', source: '<svg/> \n<!--ordinary--><p/>', graph: root(elem(named('svg'), named('p'))) },
  { id: 'reserved empty text sibling', source: '<svg/><!--hson-text:-->', graph: root(elem(named('svg'), str(''))) },
];

export const invalidSvgFixtures = ['<svg><_hson_obj/></svg>', '<svg><_hson_arr/></svg>'];

const styledSvg = named("svg", elem(
  { ...named("g", elem(named("svg", elem({ ...named("path"), $_attrs: { "stroke-width": "2" } })))), $_attrs: { id: "first" } },
  { ...named("circle"), $_attrs: { id: "last" } },
));
styledSvg.$_attrs = { viewBox: "0 0 10 10" };
// SVG's existing raw style storage is broader than the structured attrs type.
Reflect.set(styledSvg.$_attrs, "style", " fill: red ");

export const svgSourceFixtures: readonly SourceFixture[] = [
  { id: "SVG children", source: `<svg><g/></svg>`, graph: root(elem(named("svg", elem(named("g"))))) },
  { id: "self-closing SVG", source: `<svg/>`, graph: root(elem(named("svg"))) },
  { id: "empty paired SVG", source: `<svg></svg>`, graph: root(elem(named("svg"))) },
  { id: 'SVG with ignored trailing instruction', source: '<svg/><?authored-instruction?>', graph: root(elem(named('svg'))) },
  { id: 'nested SVG branches', source: '<svg><g><path/></g></svg>', graph: root(elem(named('svg', elem(named('g', elem(named('path'))))))) },
  { id: "SVG attributes, order and nesting", source: `<svg viewBox="0 0 10 10" style=" fill: red "><g id="first"><svg><path stroke-width="2"/></svg></g><circle id="last"/></svg>`, graph: root(elem(styledSvg)) },
];
