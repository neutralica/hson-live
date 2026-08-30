import { fileURLToPath } from "node:url";
const imports = 'import { Hson, hson } from "hson-live";\nimport { hsonLiveMap } from "hson-live/livemap";\nimport { UserSchema, OtherSchema, DocumentSchema, DocumentSequenceSchema, TextSchema, StringSchema, OrderedSchema } from "./schema-d3-schemas.fixture.mts";\n';
const source = 'const source = Hson`<user <age "37">>`;\n';
const map = 'const map = hson.liveMap.fromHson(source);\n';
const use = 'map.schema.use(UserSchema);\n';
export const cases: Readonly<Record<string, string>> = {
  direct: imports + source + map + use,
  valid: imports + source.replace('"37"', '37') + map + use,
  mutated: imports + source + map + 'map.set(["user", "age"], 37);\n' + use,
  reverted: imports + source + map + 'map.set(["user", "age"], 37); map.set(["user", "age"], "37");\n' + use,
  two: imports + source + map + 'const b = hsonLiveMap.fromHson(source);\n' + use + 'b.schema.use(OtherSchema);',
  independent: imports + source + map + 'const b = hsonLiveMap.fromHson(source); map.set(["user", "age"], 37);\n' + use + 'b.schema.use(OtherSchema);',
  attempts: imports + source.replace('"37"', '37') + map + use + use + 'map.schema.use(OtherSchema);',
  retries: imports + source + map + use + 'map.schema.use(OtherSchema);',
  document: imports + 'const source = Hson`<button count="bad"/>`;\n' + map + 'map.schema.use(DocumentSchema);',
  documentMutated: imports + 'const source = Hson`<button count=1 disabled/>`;\n' + map + 'map.at([]).attrs.set("count", 2); map.schema.use(DocumentSchema);',
  documentReverted: imports + 'const source = Hson`<button count=1 disabled/>`;\n' + map + 'map.at([]).attrs.set("count", 2); map.at([]).attrs.set("count", 1); map.schema.use(DocumentSchema);',
  documentSequence: imports + 'const source = Hson`<a/> <c/>`;\n' + map + 'map.schema.use(DocumentSequenceSchema);',
  text: imports + 'const source = Hson`"text"`;\n' + map + 'map.schema.use(TextSchema);',
  scalar: imports + 'const source = Hson`"text"`;\n' + map + 'map.schema.use(StringSchema);',
  inline: imports.replace('import { Hson, hson } from "hson-live";', 'import { Hson } from "hson-live/hson";') + 'const map = hsonLiveMap.fromHson(Hson`<user <age "37">>`);\n' + use,
  aliases: imports + source + 'const authored = (source); const map = (hsonLiveMap.fromHson)((authored)); const currentMap = (map); const S = UserSchema; (currentMap).schema.use((S));',
  ordered: imports + 'const source = Hson`<\'2\' "b" \'1\' "a">`;\n' + map + 'map.schema.use(OrderedSchema);',
  // Exports let runtime tests perform a real post-association mutation as well.
  live: imports + source.replace('"37"', '37') + map + use + 'export { map };',
  mixed: imports + source + map + use + 'try { Hson.certify(OtherSchema, source); } catch {}',
  repeated: imports + 'function make() {\n' + source + map + use + '} make(); make();',
  equal: imports + source + 'const equal = Hson`<user <age "37">>`;\n' + map + 'const b = hsonLiveMap.fromHson(equal);\n' + use + 'b.schema.use(OtherSchema);',
  staticDirect: imports + 'const source = `<user <age "37">>`;\n' + map + use,
  staticEscaped: imports + 'const source = "<user <age \\x2237\\x22>>";\n' + map + use,
  staticMutated: imports + 'const source = `<user <age "37">>`;\n' + map + 'map.set(["user", "age"], 37);\n' + use,
  staticReverted: imports + 'const source = `<user <age "37">>`;\n' + map + 'map.set(["user", "age"], 37); map.set(["user", "age"], "37");\n' + use,
  staticTwo: imports + 'const source = `<user <age "37">>`;\n' + map + 'const b = hsonLiveMap.fromHson(source);\n' + use + 'b.schema.use(OtherSchema);',
  staticDocument: imports + 'const source = `<button count="bad"/>`;\n' + map + 'map.schema.use(DocumentSchema);',
  staticDocumentSequence: imports + 'const source = `<a/> <c/>`;\n' + map + 'map.schema.use(DocumentSequenceSchema);',
  staticText: imports + 'const source = `"text"`;\n' + map + 'map.schema.use(TextSchema);',
  staticLive: imports + 'const source = `<user <age 37>>`;\n' + map + use + 'export { map };',
};
export const caseFile = (name: string) => fileURLToPath(new URL(`./d3-${name}.ts`, import.meta.url));
