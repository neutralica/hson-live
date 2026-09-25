import { instrument_trusted_schema_map_sources } from "../../src/internal/trusted-schema-diagnostics/instrument-map-sources.ts";
import { cases,caseFile } from "./schema-d5-cases.mts";
const code=instrument_trusted_schema_map_sources(caseFile('nonfinite'),cases.nonfinite!,new URL('../../src/internal/trusted-schema-diagnostics/source-lifecycle.ts',import.meta.url).href)
  .replaceAll('"hson-live/hson"',JSON.stringify(new URL('../../src/hson-authoring.ts',import.meta.url).href))
  .replaceAll('"hson-live/livemap"',JSON.stringify(new URL('../../src/api/livemap/livemap.facade.ts',import.meta.url).href))
  .replaceAll('"./schema-d5-schemas.fixture.mts"',JSON.stringify(new URL('./schema-d5-schemas.fixture.mts',import.meta.url).href));
await import('data:text/javascript;base64,'+Buffer.from(code+'\n// uncaught provider copy').toString('base64'));
throw new Error('Unreachable after the original Hson admission throw.');
