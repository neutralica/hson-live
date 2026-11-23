type Kind = "str" | "num";
type WriteCase = Readonly<{ name: string; source: string; kind?: Kind; completeCollection: boolean; attachedEvent: boolean }>;
type Options = Readonly<{ prefix?: string; after?: string; alias?: true; libraries?: string; completeCollection?: boolean; attachedEvent?: boolean }>;

const documentRecord = (kind: Kind, marker = "", metadata = "") =>
  `{kind:"document",document:'<p hson:part ${kind}:label=%{needed}${marker} "^{label}"/>'${metadata}}`;
const str = documentRecord("str"), num = documentRecord("num");
const peer = '{kind:"document",document:"<i hson:part/>"}';
const declarations = 'import {hsonLiveMap as maps} from "hson-live";\n'
  + 'declare const opaque:any, flag:boolean, key:string;\n';
const writes = '\nmap.parts.g.p.write({other:0, needed:81});\nmap.parts.g.p.write({needed:"ok", other:0});'
  + '\nmap.parts.g.p.write({other:0});\nmap.parts.g.p.write({ });\n';

function sample(name: string, members: string, kind?: Kind, options: Options = {}): WriteCase {
  const { prefix = "", after = "", alias = false, libraries = '{g:{parts:{' + members + '}}}', completeCollection = false, attachedEvent = false } = options;
  const source = declarations + prefix + (alias ? 'const table=' + libraries + ' as const;\n' : '')
    + 'const map=maps.fromLibraries(' + (alias ? 'table' : libraries) + ');' + after + writes;
  return { name, source, completeCollection, attachedEvent, ...(kind === undefined ? {} : { kind }) };
}

export const part_write_target_cases: readonly WriteCase[] = [
  ...['"1"', '1'].flatMap(key => [
    sample('leading-' + key, key + ':' + peer + ',p:' + str, "str", { completeCollection: true }),
    sample('trailing-' + key, 'p:' + str + ',' + key + ':' + peer, "str", { completeCollection: true }),
    sample('aliased-' + key, 'a:' + peer + ',' + key + ':' + peer + ',p:' + str, "str", { alias: true, completeCollection: true }),
    ...['E', 'E as typeof E'].map(event => sample('marker-' + key + '-' + event,
      'p:' + documentRecord("str", " event:go", ',events:{go:' + event + '}') + ',' + key + ':' + peer,
      "str", { prefix: 'const E="<hson:event on:click local:go <>>";\n', completeCollection: event === "E",
        attachedEvent: key === '"1"' && event === "E" })),
  ]),
  sample("direct-string", 'p:' + str, "str", { completeCollection: true }),
  sample("direct-number", 'p:' + num, "num", { completeCollection: true }),
  sample("bounded-wrappers", 'p:((' + str + '!) satisfies object)!', "str"),
  sample("wrapped-constant-selection", 'p:(true ? ' + str + ' : ' + num + ')' + '!'.repeat(32), "str"),
  sample("exhausted-member-wrappers", 'p:' + str + '!'.repeat(256)),
  sample("exhausted-coordinate-wrappers", "", undefined, { libraries: '{g:{parts:{p:' + str + '}}}' + '!'.repeat(123) }),
  sample("true", 'p:true ? ' + str + ' : ' + num, "str"),
  sample("false", 'p:false ? ' + str + ' : ' + num, "num"),
  sample("reversed", 'p:true ? ' + num + ' : ' + str, "num"),
  sample("named", 'p:true ? S : N', "str", { prefix: 'const S=' + str + ' as const, N=' + num + ' as const;\n' }),
  sample("nested", 'p:false ? opaque : (true ? N : opaque)', "num", { prefix: 'const N=' + num + ' as const;\n' }),
  sample("opaque-peer", 'p:' + str + ',q:opaque', "str"),
  sample("spread-before", '...opaque,p:' + str, "str"),
  sample("computed-before", '[key]:opaque,p:' + num, "num"),
  sample("spread-after", 'p:' + str + ',...opaque'),
  sample("computed-after", 'p:' + str + ',[key]:opaque'),
  sample("duplicate", 'p:' + str + ',["p"]:' + num),
  sample("unresolved", 'p:flag ? ' + str + ' : ' + num),
  sample("one-observed", 'p:flag ? ' + str + ' : opaque'),
  sample("unavailable", 'q:' + str + ',p:false ? ' + str + ' : opaque'),
  sample("wrong-kind", 'p:true ? ' + str.replace('"document"', '"other"') + ' : ' + num),
  sample("single-use-constant", 'p:true ? R : opaque', "num", { prefix: 'const R=' + num + ' as const;' }),
  sample("reused-constant", 'p:true ? R : opaque,q:R', undefined, { prefix: 'const R=' + num + ' as const;' }),
  sample("shadowed-private", 'p:R', "str", { prefix: 'const R=' + str + '; function other(R:number){return R;}' }),
  sample("private-type-query", 'p:R', "str", { prefix: 'type R=number; const R=' + str + '; export type View=typeof R;' }),
  sample("private-chain", 'p:tail', "str", { prefix: 'const root=' + str + ', middle=root, tail=middle;' }),
  ...['export const R=' + str + ';', 'const R=' + str + '; export {R};',
    'const R=' + str + '; export {R as renamed};', 'const R=' + str + '; export default R;'].map(prefix =>
    sample("public-record " + prefix, 'p:R', undefined, { prefix })),
  ...['const box={R};', 'function take(x:unknown){} take(R);', 'const later=()=>R;',
    '{declare const R:{document:string}; R.document="<i/>";}',
    '{declare const {R}:{R:{document:string}}; R.document="<i/>";}', 'eval("R.document=0");'].map(use => sample("private-escape " + use, 'p:R', undefined, { prefix: 'const R=' + str + ';' + use })),
  sample("exported-style", 'p:' + documentRecord("str", "", ',css:style'), undefined,
    { prefix: 'export const style={color:"blue"};' }),
  sample("exported-coordinate", "", undefined, { prefix: 'export const parts={p:' + str + '};', libraries: '{g:{parts}}' }),
  sample("conditional-document-alias", 'p:R', "str",
    { prefix: 'const R={kind:"document",document:true ? \'<p hson:part str:label=%{needed} "^{label}"/>\' : opaque} as const;' }),
  sample("duplicate-peer", '1:opaque,p:' + str + ',["1"]:opaque', "str"),
  sample("same-observation", 'p:flag ? R : R', undefined, { prefix: 'const R=' + num + ' as const;' }),
  sample("invalid-style", 'p:true ? ' + str.replace('kind:', 'css:5,kind:') + ' : ' + num),
  sample("invalid-style-alias", 'p:true ? ' + str.replace('kind:', 'css:bad,kind:') + ' : ' + num,
    undefined, { prefix: 'const bad=5;' }),
  sample("custom-prototype", 'p:true ? ' + str.replace('kind:', '__proto__:{x:1},kind:') + ' : ' + num),
  sample("modified-selected-branch", 'p:true ? R : ' + num, undefined,
    { prefix: 'const R=' + str + '; R.document="<i hson:part/>";' }),
  sample("modified-through-alias", 'p:A', undefined,
    { prefix: 'const R=' + str + '; const A=R; R.document="<i hson:part/>";' }),
  sample("modified-after-use", 'p:R', undefined,
    { prefix: 'const R=' + str + ';', after: 'R.document="<i hson:part/>";' }),
  sample("modified-unrelated-member", 'p:' + str + ',q:R', "str",
    { prefix: 'const R=' + num + '; R.document="<i hson:part/>";' }),
  sample("modified-collection-alias", "", undefined,
    { prefix: 'const T={p:' + str + '}; T.p.document="<i hson:part/>";', libraries: '{g:{parts:T}}' }),
  sample("modified-library-alias", "", undefined,
    { prefix: 'const L={parts:{p:' + str + '}}; L.parts.p.document="<i hson:part/>";', libraries: '{g:L}' }),
  sample("modified-batch-alias", "", undefined,
    { prefix: 'const B={g:{parts:{p:' + str + '}}}; B.g.parts.p.document="<i hson:part/>";', libraries: 'B' }),
  sample("invalid-style-leaf-alias", 'p:' + documentRecord("str", "", ',css:{color:leaf}'), undefined, { prefix: 'const leaf=false;' }),
  sample("unavailable-style-leaf", 'p:' + documentRecord("str", "", ',css:{color:opaque}')),
  sample("valid-style-leaf-alias", 'p:' + documentRecord("str", "", ',css:style'), "str", { prefix: 'const color="blue"; const style={color};' }),
  sample("explicit-css-deletion", 'p:' + documentRecord("str", "", ',css:{color:undefined}'), "str"),
  sample("collection-custom-prototype", '__proto__:{x:1},p:' + str),
  sample("aliased-library-inherited-schema", "", undefined,
    { prefix: 'const L={__proto__:{schema:null},parts:{p:' + str + '}};', libraries: '{g:L}' }),
  sample("own-prototype-name", '["__proto__"]:' + peer + ',p:' + str, "str", { completeCollection: true }),
  sample("null-prototype-path", "", "str",
    { libraries: '{__proto__:null,g:{__proto__:null,parts:{__proto__:null,p:' + str + '}}}', completeCollection: true }),
  sample("unrelated-custom-prototype", 'q:' + num.replace('kind:', '__proto__:{x:1},kind:') + ',p:' + str, "str"),
];

const namespaceImport = 'import * as relay from "./namespace-relay.js"; ';
const namedNamespace = 'import {group as imported} from "./namespace-relay.js"; ';
const change = 'function change(value: object) { Reflect.get(value, "item").document="<i hson:part/>"; } ';
const recordSource = 'import {Hson} from "hson-live";\n'
  + 'export const item={kind:"document" as const,document:Hson.document`<p hson:part str:label=%{needed} "^{label}"/>`};\n'
  + 'export const other={document:"<i/>"};';
const namespaceRelay = 'export * as group from "./namespace-record.js";';
const namespaceSource = declarations + 'import {item} from "./namespace-record.js";\nimport "./namespace-reference.js";\n'
  + 'const map=maps.fromLibraries({g:{parts:{p:item,q:'
  + num.replaceAll('label', 'peerLabel').replace('needed', 'peer') + '}}});'
  + '\n/* 🧪 */ map.parts.g.p.write({needed:81});'
  + '\n/* 🧭 */ map.parts.g.q.write({peer:"bad"});'
  + '\nmap.parts.g.p.write({ });\nmap.parts.g.q.write({ });';

// Imported mutable records retain their authored Documents under every public route.
export const imported_part_write_cases = ([
  ["direct export", ""],
  ["hidden behind private alias", "", namespaceRelay, "const local=item;"],
  ["namespace value", namedNamespace + change + "change(imported);"],
  ["forwarded namespace", namespaceImport + change + "change(relay.group);", 'export * from "./namespace-forward.js";'],
  ["erased reference", namedNamespace + "export type T=typeof imported.item;"],
] as const).map(([name, reference, relay = namespaceRelay, alias]) => ({
  name, source: alias ? namespaceSource.replace("const map=", alias + "const map=").replace("p:item", "p:local") : namespaceSource,
  dependencies: {
    "namespace-record.ts": recordSource, "namespace-relay.ts": relay,
    "namespace-reference.ts": reference, "namespace-forward.ts": namespaceRelay,
  },
}));
