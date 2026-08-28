import { instrument_trusted_schema_map_sources } from "../../src/internal/trusted-schema-diagnostics/instrument-map-sources.ts";
import { cases, caseFile } from "./schema-d5-cases.mts";
export { hson, trustedSchemas } from "./schema-d5-schemas.fixture.mts";
const schemaModule = new URL('./schema-d5-schemas.fixture.mts', import.meta.url).href;
export const trustedSchemaBindings = Object.entries({ UserSchema:'user', OtherSchema:'other', DocumentSchema:'document', ConstraintSchema:'constraint', LiteralSchema:'literal' }).map(([exportName,schemaId]) => ({ schemaId,binding:{moduleUrl:schemaModule,exportName} }));
export const failures = new Map<string, unknown>();
for (const [name,text] of Object.entries(cases)) {
  const code = instrument_trusted_schema_map_sources(caseFile(name), text, new URL('../../src/internal/trusted-schema-diagnostics/source-lifecycle.ts', import.meta.url).href)
    .replaceAll('"hson-live/hson"', JSON.stringify(new URL('../../src/hson-authoring.ts', import.meta.url).href))
    .replaceAll('"hson-live/livemap"', JSON.stringify(new URL('../../src/api/livemap/livemap.facade.ts', import.meta.url).href))
    .replaceAll('"./schema-d5-schemas.fixture.mts"', JSON.stringify(schemaModule));
  try { await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64')); }
  catch (cause) { failures.set(name, cause); }
}
