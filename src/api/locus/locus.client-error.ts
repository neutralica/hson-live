import {
  LiveMapDocumentIdentityProvenanceError,
  LiveMapDocumentInstallError,
  LiveMapDocumentMutationError,
  LiveMapDocumentStagingError,
  LiveMapProjectedIdentityError,
} from "../livemap/livemap.error.js";
import { LiveMapDocumentIdentityError } from "../livemap/livemap.document.identity.js";

/** Keep framework-generated, runtime-local QUID values out of client errors. */
export function locus_client_error_message(cause: unknown, fallback: string): string {
  if (cause instanceof LiveMapDocumentIdentityError
    || cause instanceof LiveMapProjectedIdentityError
    || cause instanceof LiveMapDocumentIdentityProvenanceError
    || cause instanceof LiveMapDocumentInstallError
    || (cause instanceof LiveMapDocumentMutationError
      && (cause.code.includes("IDENTITY") || cause.code.includes("WITNESS")))
    || (cause instanceof LiveMapDocumentStagingError
      && (cause.reasonCode.includes("IDENTITY") || cause.reasonCode.includes("WITNESS")))
    || (cause instanceof Error && (
      cause.message.startsWith("LiveMap-wide active QUID collision for ")
      || cause.message.startsWith("Projected QUID ")
      || cause.message.startsWith("Duplicate projected QUID ")
      || (cause.message.startsWith("Data path ") && cause.message.endsWith(" different QUID."))
    ))) {
    return "Locus runtime identity validation failed.";
  }
  return cause instanceof Error ? cause.message : fallback;
}
