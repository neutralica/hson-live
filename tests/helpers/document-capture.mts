import type { LiveMap } from "../../src/types/livemap.types.ts";
import { capture_livemap_document, type LiveMapDocumentCaptureOptions } from "../../src/api/livemap/livemap.document.capture.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";

/** Internal capture invariants use the aggregate owner and its exact identity evidence. */
export function capture_internal_document(map: LiveMap, name: string, options?: LiveMapDocumentCaptureOptions) {
  const aggregate = internal_livemap_aggregate_authority(map);
  const index = aggregate.hostedRegistry().libraries.findIndex(entry =>
    entry.name === name && entry.scope === undefined && entry.mode === "document");
  const identity = aggregate.libraries()[index];
  if (identity === undefined) throw new Error("Expected an application document Library.");
  return capture_livemap_document(aggregate.identityEpoch(), "document", aggregate.hostedPosition().revision,
    aggregate.root(identity), aggregate.documentOverlay(identity), options,
    () => aggregate.documentCaptureContinuity(identity));
}
