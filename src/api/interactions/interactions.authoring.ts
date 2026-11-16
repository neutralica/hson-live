import { authored_interaction_descriptor } from "../../internal/document-events.js";
import { assert_no_pending_document_options } from "../livemap/livemap.document.native-listener.js";
import type { DocumentElementListener, DocumentListener, DocumentLibraryListener } from "../../types/interaction.descriptor.types.js";
import type { DocumentCallbackListener } from "../../types/native-listener.types.js";
import type { LiveMapDocumentLibrary } from "../../types/livemap.types.js";
import { admit_data_input, type HsonDataInput } from "../data/hson-data.js";
import { capture_livemap_document_element } from "../livemap/livemap.document.identity-handle.js";
import { DOCUMENT_CLICK_LISTENER } from "../../internal/listener-config.js";
import { interaction_descriptor, new_interaction_id } from "./interactions.descriptor.js";

type Destination = "local" | "host";
type AuthorClick<TResult> = (destination: Destination, key: string, input: HsonDataInput | undefined) => TResult;

/** A writable coordinate can carry element qualification in its runtime facade. @internal */
export type WritableDocumentLocation = ReturnType<LiveMapDocumentLibrary["at"]> & Readonly<{
  listen?: DocumentElementListener<string> | undefined;
}>;

export function document_listener<TResult>(author: AuthorClick<TResult>, event: (source: string) => TResult): DocumentListener<TResult> {
  return Object.freeze({
    event,
    local: Object.freeze({ onClick: (key: string, input?: HsonDataInput) => author("local", key, input) }),
    host: Object.freeze({ onClick: (key: string, input?: HsonDataInput) => author("host", key, input) }),
  });
}

const listenerGuards = new WeakMap<DocumentListener<string>, (guard: () => void) => DocumentElementListener<string>>();

/** Let the governing facade check its owner at the actual capture and commit boundaries. @internal */
export function synchronous_document_listener(
  author: (destination: Destination, key: string, input: HsonDataInput | undefined, assertReadable: () => void) => string,
  callbacks: (assertReadable: () => void) => DocumentCallbackListener,
  authorEvent: (source: string, assertReadable: () => void) => string,
): DocumentElementListener<string> {
  const bind = (guard: () => void): DocumentElementListener<string> => {
    const native = callbacks(guard);
    return Object.freeze(Object.assign(native, document_listener(
      (destination, key, input) => author(destination, key, input, guard),
      source => { assert_no_pending_document_options(native); return authorEvent(source, guard); },
    )));
  };
  const listener = bind(() => {});
  listenerGuards.set(listener, bind);
  return listener;
}

export function guard_document_listener(listener: DocumentElementListener<string>, guard: () => void): DocumentElementListener<string>;
export function guard_document_listener(listener: DocumentLibraryListener<string>, guard: () => void): DocumentLibraryListener<string>;
export function guard_document_listener(listener: DocumentListener<string>, guard: () => void): DocumentElementListener<string> {
  const bind = listenerGuards.get(listener);
  if (bind === undefined) throw new Error("Unknown Document listener capability.");
  return bind(guard);
}

/** Own the subject and Data before any queued submission. Only the lowered path enters the Descriptor. */
export function capture_document_click(owner: object, library: string, select: (() => readonly number[]) | undefined,
  destination: Destination, key: string, input: HsonDataInput | undefined, assertLifetime?: () => void) {
  assertLifetime?.();
  const path = select === undefined ? undefined : capture_livemap_document_element(owner, select, assertLifetime);
  if (typeof key !== "string" || key.length === 0) throw new TypeError("Document click requires an action name.");
  const data = input === undefined ? undefined : admit_data_input(input);
  const id = new_interaction_id();
  const kind = destination === "local" ? "browser" : "locus";
  return { id, descriptor: () => interaction_descriptor(id, path === undefined ? { library, kind: "document" } : { library, path: path() },
    path === undefined ? { ...DOCUMENT_CLICK_LISTENER, target: "document" } : DOCUMENT_CLICK_LISTENER, kind, key, data) };
}

export function capture_document_event(owner: object, library: string, select: (() => readonly number[]) | undefined,
  source: string, assertLifetime?: () => void) {
  assertLifetime?.();
  const path = select === undefined ? undefined : capture_livemap_document_element(owner, select, assertLifetime);
  const id = new_interaction_id();
  const captured = authored_interaction_descriptor(source,
    path === undefined ? { library, kind: "document" } : { library, path: path() }, id);
  return { id, descriptor: () => path === undefined ? captured : { ...captured, subject: { library, path: path() } } };
}
