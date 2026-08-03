import type {
  LiveMapDocumentIdentityHandle,
  LiveMapProjectedIdentityHandle,
  LivePath,
} from "../../src/types/livemap.types.ts";
import {
  acquire_livemap_document_identity,
  type LiveMapDocumentIdentityTargetInternal,
} from "../../src/api/livemap/livemap.document.identity-handle.ts";
import { acquire_livemap_projected_identity } from "../../src/api/livemap/livemap.projected.identity-handle.ts";

/** Internal test seam; deliberately absent from every public LiveMap façade. */
export function acquire_document_identity(
  document: object,
  target: LiveMapDocumentIdentityTargetInternal,
): LiveMapDocumentIdentityHandle {
  return acquire_livemap_document_identity(document, target);
}

/** Internal test seam; deliberately absent from every public LiveMap façade. */
export function acquire_projected_identity(
  map: object,
  path: LivePath,
): LiveMapProjectedIdentityHandle {
  return acquire_livemap_projected_identity(map, path);
}
