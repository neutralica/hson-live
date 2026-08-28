import { fileURLToPath } from "node:url";
const imports = 'import { HSON } from "hson-live/hson";\nimport { hsonLiveMap } from "hson-live/livemap";\nimport { UserSchema, OtherSchema, DocumentSchema, ConstraintSchema, LiteralSchema } from "./schema-d5-schemas.fixture.mts";\n';
const source = 'const age = "37"; const source = HSON`<user <age ${age}>>`;\n';
const validate = 'HSON.validate(UserSchema, source);';
const map = 'const map = hsonLiveMap.fromHson(source);\n';
const use = 'map.schema.use(UserSchema);';
export const cases: Readonly<Record<string, string>> = {
  direct: imports + source + validate,
  beforeValidate: imports + source + 'throw new Error("stopped before application validation");\n' + validate,
  valid: imports + source.replace('"37"', '37') + validate,
  literal: imports + 'const value=1; const source=HSON`<user <age "bad" unused ${value}>>`;\n' + validate,
  document: imports + 'const value="bad"; const source=HSON`<button count=${value}/>`;\nHSON.validate(DocumentSchema, source);',
  constraint: imports + 'const value=-1; const source=HSON`<user <age ${value}>>`;\nHSON.validate(ConstraintSchema, source);',
  literalSet: imports + 'const value="pending"; const source=HSON`<user <age ${value}>>`;\nHSON.validate(LiteralSchema, source);',
  multiple: imports + source + 'try { HSON.validate(UserSchema, source); } catch {} HSON.validate(OtherSchema, source);',
  map: imports + source + map + use,
  mapValid: imports + source.replace('"37"', '37') + map + use,
  mapMutated: imports + source + map + 'map.set(["user","age"], 37);\n' + use,
  mapReverted: imports + source + map + 'map.set(["user","age"], 37); map.set(["user","age"], "37");\n' + use,
  mapMultiple: imports + source + map + use + '\nmap.schema.use(OtherSchema);',
  mapTwo: imports + source + map + 'const b = hsonLiveMap.fromHson(source);\n' + use + '\nb.schema.use(OtherSchema);',
  repeated: imports + 'function make() {\n' + source + 'try { '+validate+' } catch {} } make(); make();',
  mapRepeated: imports + 'function make() {\n' + source + map + use + '} make(); try { make(); } catch {}',
  unsupported: imports + 'const value={}; HSON`<user <age ${value}>>`;',
  nonfinite: imports + 'const value=Infinity; HSON`<user <age ${value}>>`;',
  grammar: imports + 'const value="bad"; HSON`<${value}/>`;',
  literalGrammar: imports + 'const value=37; HSON`<user <age ${value}> +>`;',
  crlf: (imports + source + validate).replaceAll('\n','\r\n'),
  unicode: imports + source.replace('<age ${age}>', '<age ${age} note "😀">') + validate,
  thrown: imports + 'function fail(){ throw new Error("expression sentinel"); } HSON`<user <age ${fail()}>>`;',
};
export const caseFile = (name: string) => fileURLToPath(new URL(`./d5-${name}.ts`, import.meta.url));
