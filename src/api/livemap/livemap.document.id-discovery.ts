import type { HsonNode } from "../../core/types.js";
import type { DocumentLiveMapMode } from "../../types/livemap.types.js";
import {
  find_internal_document_id_path,
  InternalDocumentTraversalError,
  type InternalDocumentLogicalEdge,
} from "./livemap.document.logical.js";

type InternalDocumentLocation = Readonly<{
  path: () => readonly number[];
}>;

type InternalDocumentLocationMap<TLocation extends InternalDocumentLocation> = Readonly<{
  mode: DocumentLiveMapMode;
  root: () => HsonNode;
  at: (path: readonly number[]) => TLocation;
}>;

/**
 * Find the first exact canonical HTML `id` below one logical document scope.
 *
 * This is deliberately internal and one-shot. The returned value is the map's
 * existing interned passive location, so discovery adds no continuity or cache.
 */
export function find_internal_document_id<TLocation extends InternalDocumentLocation>(
  map: InternalDocumentLocationMap<TLocation>,
  scope: InternalDocumentLocation,
  id: string,
): TLocation | undefined {
  const scopePath = scope.path();
  const root = map.root();
  const edges: readonly InternalDocumentLogicalEdge[] = scopePath.map((index) => ({
    kind: "content",
    index,
  }));
  try {
    const foundPath = find_internal_document_id_path(root, map.mode, edges, scopePath, id);
    return foundPath === undefined ? undefined : map.at(foundPath);
  } catch (error) {
    if (error instanceof InternalDocumentTraversalError
      && (error.code === "CONTENT_INDEX_OUT_OF_RANGE"
        || error.code === "PRIMITIVE_DESCENT"
        || error.code === "FACET_UNAVAILABLE")) {
      return undefined;
    }
    throw error;
  }
}
