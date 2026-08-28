import { fileURLToPath } from "node:url";
const imports = 'import { HSON, hson } from "hson-live";\nimport { hsonLiveMap } from "hson-live/livemap";\nimport { UserSchema, OtherSchema, DocumentSchema, FragmentSchema, TextSchema, StringSchema, OrderedSchema } from "./schema-d3-schemas.fixture.mts";\n';
const source = 'const source = HSON`<user <age "37">>`;\n';
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
  document: imports + 'const source = HSON`<button count="bad"/>`;\n' + map + 'map.schema.use(DocumentSchema);',
  documentMutated: imports + 'const source = HSON`<button count=1 disabled/>`;\n' + map + 'map.at([]).attrs.set("count", 2); map.schema.use(DocumentSchema);',
  documentReverted: imports + 'const source = HSON`<button count=1 disabled/>`;\n' + map + 'map.at([]).attrs.set("count", 2); map.at([]).attrs.set("count", 1); map.schema.use(DocumentSchema);',
  fragment: imports + 'const source = HSON`<a/> <c/>`;\n' + map + 'map.schema.use(FragmentSchema);',
  text: imports + 'const source = HSON`"text"`;\n' + map + 'map.schema.use(TextSchema);',
  scalar: imports + 'const source = HSON`"text"`;\n' + map + 'map.schema.use(StringSchema);',
  inline: imports.replace('import { HSON, hson } from "hson-live";', 'import { HSON } from "hson-live/hson";') + 'const map = hsonLiveMap.fromHson(HSON`<user <age "37">>`);\n' + use,
  aliases: imports + source + 'const authored = (source); const map = (hsonLiveMap.fromHson)((authored)); const currentMap = (map); const S = UserSchema; (currentMap).schema.use((S));',
  ordered: imports + 'const source = HSON`<\'2\' "b" \'1\' "a">`;\n' + map + 'map.schema.use(OrderedSchema);',
  // Exports let runtime tests perform a real post-association mutation as well.
  live: imports + source.replace('"37"', '37') + map + use + 'export { map };',
  mixed: imports + source + map + use + 'try { HSON.validate(OtherSchema, source); } catch {}',
  repeated: imports + 'function make() {\n' + source + map + use + '} make(); make();',
  equal: imports + source + 'const equal = HSON`<user <age "37">>`;\n' + map + 'const b = hsonLiveMap.fromHson(equal);\n' + use + 'b.schema.use(OtherSchema);',
};
export const caseFile = (name: string) => fileURLToPath(new URL(`./d3-${name}.ts`, import.meta.url));
