import type { HsonNode, Primitive } from "../../src/core/types.ts";

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
