import { fileURLToPath } from "node:url";
import { instrument_trusted_schema_map_sources } from "../../src/internal/trusted-schema-diagnostics/instrument-map-sources.ts";
export { hson, trustedSchemas } from "./schema-d6-schemas.fixture.mts";
const schemas = new URL('./schema-d6-schemas.fixture.mts', import.meta.url).href;
export const trustedSchemaBindings = Object.entries({ UserSchema:'user', DocumentSchema:'document', TaggedSchema:'tagged' }).map(([exportName,schemaId]) => ({ schemaId, binding: { moduleUrl:schemas, exportName } }));
export const caseFile = (name: string) => fileURLToPath(new URL(`./d6-${name}.ts`, import.meta.url));
const imports = 'import { Hson } from "hson-live/hson"; import { TaggedSchema } from "./schema-d6-schemas.fixture.mts";';
export const cases = {
  fresh: imports + 'const value="a"; const source=Hson`<kind ${value} >`; try { Hson.validate(TaggedSchema,source); } catch {}',
  repeated: imports + 'function run(){ const value="a"; const source=Hson`<kind ${value} >`; try { Hson.validate(TaggedSchema,source); } catch {} } run();run();',
};
for (const [name,text] of Object.entries(cases)) {
  const code = instrument_trusted_schema_map_sources(caseFile(name),text,new URL('../../src/internal/trusted-schema-diagnostics/source-lifecycle.ts',import.meta.url).href)
    .replaceAll('"hson-live/hson"',JSON.stringify(new URL('../../src/hson-authoring.ts',import.meta.url).href))
    .replaceAll('"./schema-d6-schemas.fixture.mts"',JSON.stringify(schemas));
  await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
