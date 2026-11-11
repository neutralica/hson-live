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
  try {
    if (cause instanceof LiveMapDocumentIdentityError
      || cause instanceof LiveMapProjectedIdentityError
      || cause instanceof LiveMapDocumentIdentityProvenanceError
      || cause instanceof LiveMapDocumentInstallError
      || (cause instanceof LiveMapDocumentMutationError && hasIdentityCode(cause.code))
      || (cause instanceof LiveMapDocumentStagingError && hasIdentityCode(cause.reasonCode))) {
      return "Locus runtime identity validation failed.";
    }
    // Error objects can carry accessors, and even instanceof can trap on a proxy.
    const message = cause instanceof Error ? cause.message : undefined;
    if (typeof message !== "string") return fallback;
    if (message.startsWith("LiveMap-wide active QUID collision for ")
      || message.startsWith("Projected QUID ")
      || message.startsWith("Duplicate projected QUID ")
      || (message.startsWith("Data path ") && message.endsWith(" different QUID."))) {
      return "Locus runtime identity validation failed.";
    }
    return message;
  } catch {
    return fallback;
  }
}

function hasIdentityCode(code: unknown): boolean {
  return typeof code === "string" && (code.includes("IDENTITY") || code.includes("WITNESS"));
}
