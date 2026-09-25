import { inspect_echo_map_capability_internal } from "../../internal/echo-map-capability.js";
import type {
  LiveMapDocumentLibrary,
  LiveMap,
} from "../../types/livemap.types.js";

const ACTIVE_CONTINUATION_ROOTS = new WeakSet<Element>();

export type ResolvedContinuationDocument = Readonly<{
  selected: LiveMapDocumentLibrary;
  aggregate: LiveMap;
}>;

/** Select the public registry name of the exact continuation document. */
export function continuation_document_library_name(
  map: LiveMap,
  selected: LiveMapDocumentLibrary,
): string {
  for (const entry of map.capture().libraries) {
    if (entry.mode === "document" && map.lib(entry.name) === selected) return entry.name;
  }
  throw new Error("Continuation document is not in the fixed Library registry.");
}

export function validate_continuation_root(root: unknown): asserts root is Element {
  if (typeof root !== "object" || root === null
    || (root as { nodeType?: unknown }).nodeType !== 1
    || typeof (root as { getAttribute?: unknown }).getAttribute !== "function"
    || typeof (root as { ownerDocument?: unknown }).ownerDocument !== "object") {
    throw new TypeError("Document continuation root must be an explicit browser Element.");
  }
}

export function reserve_continuation_root(root: Element): () => void {
  if (ACTIVE_CONTINUATION_ROOTS.has(root)) {
    throw new Error("This DOM root already has an active document continuation.");
  }
  ACTIVE_CONTINUATION_ROOTS.add(root);
  let released = false;
  return (): void => {
    if (released) return;
    released = true;
    ACTIVE_CONTINUATION_ROOTS.delete(root);
  };
}

function is_document_library(value: unknown): value is LiveMapDocumentLibrary {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LiveMapDocumentLibrary>;
  return candidate.mode === "document"
    && typeof candidate.root === "function"
    && typeof candidate.rev === "number"
    && typeof candidate.document === "object"
    && candidate.document !== null;
}

function is_libraries_map(value: unknown): value is LiveMap {
  return typeof value === "object" && value !== null
    && typeof (value as { lib?: unknown }).lib === "function"
    && typeof (value as { rev?: unknown }).rev === "number";
}

/** Resolve only public document facades registered by the supplied canonical map. */
export function resolve_continuation_document(
  map: LiveMap,
  explicit: LiveMapDocumentLibrary | undefined,
): ResolvedContinuationDocument {
  if (!is_libraries_map(map)) {
    throw new Error("Document continuation requires a LiveMap registry.");
  }

  const capability = inspect_echo_map_capability_internal(map);
  const documents = capability.documentMaps.filter(is_document_library);
  if (explicit !== undefined) {
    if (!documents.includes(explicit)) {
      throw new Error("Explicit document selection does not belong to the supplied aggregate map.");
    }
    return Object.freeze({ selected: explicit, aggregate: map });
  }
  if (documents.length !== 1) {
    throw new Error(documents.length === 0
      ? "The supplied aggregate has no public document library."
      : "The supplied aggregate has multiple public document libraries; pass one stable document handle.");
  }
  return Object.freeze({ selected: documents[0]!, aggregate: map });
}

export function validate_interaction_shape(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Document continuation interactions must be an object.");
  }
}

/** Place runtime-manager effects strictly after public continuation publication. @internal */
export function schedule_continuation_runtime_activation(
  activate: () => void,
  publication: "synchronous-return" | "promise-resolution",
): void {
  if (publication === "synchronous-return") {
    queueMicrotask(activate);
    return;
  }
  // A task boundary follows settlement and all reactions to the published
  // continuation Promise. MessageChannel avoids assigning timing semantics to
  // an arbitrary timeout duration.
  const channel = new MessageChannel();
  channel.port1.onmessage = (): void => {
    channel.port1.close();
    channel.port2.close();
    activate();
  };
  channel.port2.postMessage(undefined);
}
