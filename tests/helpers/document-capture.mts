import type { LiveMapDocumentLibrary } from "../../src/types/livemap.types.ts";
import { capture_livemap_document, type LiveMapDocumentCaptureOptions } from "../../src/api/livemap/livemap.document.capture.ts";
import { require_authority } from "../../src/api/livemap/livemap.document.registration.ts";

export function capture_document(library: LiveMapDocumentLibrary, options?: LiveMapDocumentCaptureOptions) {
  const controller = require_authority(library.document);
  return capture_livemap_document(controller.identityEpoch, controller.mode, controller.rev(), controller.root(),
    controller.overlay(), options, controller.captureContinuity);
}
