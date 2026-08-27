import { TrustedSchemaDiagnosticRuntime } from "./runtime.js";
import type { TrustedSchemaRequest, TrustedSchemaResponse } from "./protocol.js";

const generation = Number(process.env.HSON_TRUSTED_SCHEMA_GENERATION);
const runtime = new TrustedSchemaDiagnosticRuntime(Number.isSafeInteger(generation) ? generation : 0);

process.on("message", (request: TrustedSchemaRequest) => {
  void runtime.handle(request).then(
    (response) => process.send?.(response satisfies TrustedSchemaResponse),
    (cause) => process.send?.({ protocolVersion: 1, requestId: request.requestId, runtimeGeneration: request.runtimeGeneration, type: "error", error: "VALIDATION_THROW", message: cause instanceof Error ? cause.message : "Runtime failure." } satisfies TrustedSchemaResponse),
  );
});
