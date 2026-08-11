import type { HsonNode, Primitive } from "../../core/types.js";
import { STR_TAG } from "../../core/constants.js";
import type { DocumentLiveMapMode } from "../../types/livemap.types.js";
import {
  InternalDocumentTraversalError,
  resolve_internal_document_location,
  type InternalDocumentLogicalEdge,
} from "./livemap.document.logical.js";

type DocumentLocationOwner = Readonly<{
  readonly rev: number;
  root: () => HsonNode;
}>;

type DocumentLocation = Readonly<{
  readonly rev: number;
  path: () => readonly number[];
  snap: () => HsonNode | Primitive | undefined;
  at: (path: readonly number[]) => DocumentLocation;
}>;

/** Build passive, fixed-coordinate locations over logical document content. */
export function make_livemap_document_location_factory(
  owner: DocumentLocationOwner,
  mode: DocumentLiveMapMode,
): (path: readonly number[]) => DocumentLocation {
  const locations = new Map<string, DocumentLocation>();

  const at = (path: readonly number[]): DocumentLocation => {
    const logicalPath = must_document_logical_path(path);
    const key = logicalPath.join("/");
    const existing = locations.get(key);
    if (existing !== undefined) return existing;

    const location: DocumentLocation = Object.freeze({
      get rev() {
        return owner.rev;
      },
      path: () => Object.freeze([...logicalPath]),
      snap: () => read_document_logical_location(owner.root(), mode, logicalPath),
      at: (relativePath) => at([...logicalPath, ...must_document_logical_path(relativePath)]),
    });
    locations.set(key, location);
    return location;
  };

  return at;
}

function must_document_logical_path(path: unknown): readonly number[] {
  if (!Array.isArray(path)) throw new Error("LiveMap document logical path is not an array");
  return Object.freeze(path.map((part, index) => {
    if (typeof part === "number" && Number.isSafeInteger(part) && part >= 0) return part;
    throw new Error(`LiveMap document logical path part is not valid at index ${index}`);
  }));
}

function read_document_logical_location(
  root: HsonNode,
  mode: DocumentLiveMapMode,
  path: readonly number[],
): HsonNode | Primitive | undefined {
  const edges: readonly InternalDocumentLogicalEdge[] = path.map((index) => ({ kind: "content", index }));
  try {
    const resolution = resolve_internal_document_location(root, mode, edges);
    if (resolution.kind === "primitive") return resolution.value;
    if (resolution.kind === "node") {
      if (resolution.value.$_tag === STR_TAG && resolution.value.$_content.length === 1) {
        const payload = resolution.value.$_content[0];
        if (typeof payload !== "object" || payload === null) return payload;
      }
      return resolution.value;
    }
    if (resolution.kind === "content" && path.length === 0) return root;
    return undefined;
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
