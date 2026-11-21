import { parentPort, workerData } from "node:worker_threads";
import { Hson } from "../../src/hson-authoring.js";
import { HsonSchema, hson_schema_digest, compiled_hson_schema_of } from "../../src/api/schema/hson-schema.js";
import { HsonSchemaError } from "../../src/api/livemap/livemap.error.js";
import { compile_schema_source } from "./compile-source.js";

export type TransportCase = { authored: string; portable: string; candidates: readonly string[] };

export function reconstruct({ authored, portable, candidates }: TransportCase) {
  const result = compile_schema_source(authored);
  if (!result.ok || result.schema1Source !== portable) throw Error("Transported definition differs from independent compilation");
  const handle = Hson.schema.fromHson(HsonSchema.fromHson(portable).toHson());
  return {
    portable: handle.toHson(), digest: hson_schema_digest(handle), graph: compiled_hson_schema_of(handle).graph,
    outcomes: candidates.map(source => {
      const value = Hson.data.fromSource(source);
      try { handle.certify(value); return value.toHson(); }
      catch (error) { if (error instanceof HsonSchemaError) return error.issues; throw error; }
    }),
  };
}

if (parentPort) {
  const fixtures: TransportCase[] = workerData;
  parentPort.postMessage(fixtures.map(reconstruct));
}
