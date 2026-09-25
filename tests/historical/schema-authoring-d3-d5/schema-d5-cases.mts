import { fileURLToPath } from "node:url";
const imports = 'import { Hson } from "hson-live/hson";\nimport { hsonLiveMap } from "hson-live/livemap";\nimport { UserSchema, OtherSchema, DocumentSchema, ConstraintSchema, LiteralSchema } from "./schema-d5-schemas.fixture.mts";\n';
const source = 'const age = "37"; const source = Hson.canonical`<user <age ${age}>>`;\n';
const validate = 'UserSchema.certify(source);';
const map = 'const map = hsonLiveMap.fromHson(source);\n';
const use = 'map.schema.use(UserSchema);';
export const cases: Readonly<Record<string, string>> = {
  direct: imports + source + validate,
  beforeValidate: imports + source + 'throw new Error("stopped before application validation");\n' + validate,
  valid: imports + source.replace('"37"', '37') + validate,
  literal: imports + 'const value=1; const source=Hson.canonical`<user <age "bad" unused ${value}>>`;\n' + validate,
  document: imports + 'const value="bad"; const source=Hson.canonical`<button count=${value}/>`;\nDocumentSchema.certify(source);',
  constraint: imports + 'const value=-1; const source=Hson.canonical`<user <age ${value}>>`;\nConstraintSchema.certify(source);',
  literalSet: imports + 'const value="pending"; const source=Hson.canonical`<user <age ${value}>>`;\nLiteralSchema.certify(source);',
  multiple: imports + source + 'try { UserSchema.certify(source); } catch {} OtherSchema.certify(source);',
  map: imports + source + map + use,
  mapValid: imports + source.replace('"37"', '37') + map + use,
  mapMutated: imports + source + map + 'map.set(["user","age"], 37);\n' + use,
  mapReverted: imports + source + map + 'map.set(["user","age"], 37); map.set(["user","age"], "37");\n' + use,
  mapMultiple: imports + source + map + use + '\nmap.schema.use(OtherSchema);',
  mapTwo: imports + source + map + 'const b = hsonLiveMap.fromHson(source);\n' + use + '\nb.schema.use(OtherSchema);',
  repeated: imports + 'function make() {\n' + source + 'try { '+validate+' } catch {} } make(); make();',
  mapRepeated: imports + 'function make() {\n' + source + map + use + '} make(); try { make(); } catch {}',
  unsupported: imports + 'const value={}; Hson.canonical`<user <age ${value}>>`;',
  nonfinite: imports + 'const value=Infinity; Hson.canonical`<user <age ${value}>>`;',
  grammar: imports + 'const value="bad"; Hson.canonical`<${value}/>`;',
  literalGrammar: imports + 'const value=37; Hson.canonical`<user <age ${value}> +>`;',
  crlf: (imports + source + validate).replaceAll('\n','\r\n'),
  unicode: imports + source.replace('<age ${age}>', '<age ${age} note "😀">') + validate,
  thrown: imports + 'function fail(){ throw new Error("expression sentinel"); } Hson.canonical`<user <age ${fail()}>>`;',
};
export const caseFile = (name: string) => fileURLToPath(new URL(`./d5-${name}.ts`, import.meta.url));
