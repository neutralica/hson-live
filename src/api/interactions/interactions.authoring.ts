import type { DocumentListener } from "../../types/interaction.descriptor.types.js";
import type { LiveMapDocumentLibrary } from "../../types/livemap.types.js";
import { admit_data_input, type HsonDataInput } from "../data/hson-data.js";
import { capture_livemap_document_element } from "../livemap/livemap.document.identity-handle.js";
import { DOCUMENT_CLICK_LISTENER, interaction_descriptor, new_interaction_id } from "./interactions.descriptor.js";

type Destination = keyof DocumentListener<unknown>;
type AuthorClick<TResult> = (destination: Destination, key: string, input: HsonDataInput) => TResult;

/** A writable coordinate can carry element qualification in its runtime facade. @internal */
export type WritableDocumentLocation = ReturnType<LiveMapDocumentLibrary["at"]> & Readonly<{
  listen?: DocumentListener<string> | undefined;
}>;

export function document_listener<TResult>(author: AuthorClick<TResult>): DocumentListener<TResult> {
  return Object.freeze({
    local: Object.freeze({ onClick: (key: string, input: HsonDataInput) => author("local", key, input) }),
    host: Object.freeze({ onClick: (key: string, input: HsonDataInput) => author("host", key, input) }),
  });
}

const listenerGuards = new WeakMap<DocumentListener<string>, (guard: () => void) => DocumentListener<string>>();

/** Let the governing facade check its owner at the actual capture and commit boundaries. @internal */
export function synchronous_document_listener(
  author: (destination: Destination, key: string, input: HsonDataInput, assertReadable: () => void) => string,
): DocumentListener<string> {
  const bind = (guard: () => void) => document_listener((destination, key, input) => author(destination, key, input, guard));
  const listener = bind(() => {});
  listenerGuards.set(listener, bind);
  return listener;
}

export function guard_document_listener(listener: DocumentListener<string>, guard: () => void): DocumentListener<string> {
  const bind = listenerGuards.get(listener);
  if (bind === undefined) throw new Error("Unknown Document listener capability.");
  return bind(guard);
}

/** Own the subject and Data before any queued submission. Only the lowered path enters the Descriptor. */
export function capture_document_click(owner: object, library: string, select: () => readonly number[],
  destination: Destination, key: string, input: HsonDataInput, assertLifetime?: () => void) {
  const path = capture_livemap_document_element(owner, select, assertLifetime);
  if (typeof key !== "string" || key.length === 0) throw new TypeError("Document click requires a behavior name.");
  const data = admit_data_input(input);
  const id = new_interaction_id();
  const kind = destination === "local" ? "browser" : "locus";
  return { id, descriptor: () => interaction_descriptor(id, { library, path: path() }, DOCUMENT_CLICK_LISTENER, kind, key, data) };
}
