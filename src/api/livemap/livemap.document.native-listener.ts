import type { DocumentCallbackListener } from "../../types/native-listener.types.js";
import { capture_livemap_document_element } from "./livemap.document.identity-handle.js";
import { livemap_document_callback_realization } from "./livemap.document.registration.js";

/** Resolve only at registration, so a retained builder retains its selection semantics. @internal */
export function document_callback_listener(
  owner: object,
  select: () => readonly number[],
  assertReadable: () => void = () => {},
): DocumentCallbackListener {
  type Configure = (builder: DocumentCallbackListener) => DocumentCallbackListener;
  let configuration: Configure[] = [];
  const configure = (apply: Configure): DocumentCallbackListener => {
    configuration.push(apply);
    return api;
  };
  const api: DocumentCallbackListener = {
    onClick(callback) {
      const pending = configuration;
      configuration = [];
      assertReadable();
      if (typeof callback !== "function") throw new TypeError("Document native click requires a callback function.");
      const attach = livemap_document_callback_realization(owner);
      if (attach === undefined) throw new Error("Document native listener requires an active browser realization.");
      const path = capture_livemap_document_element(owner, select)();
      return attach(path, builder => pending.reduce((current, apply) => apply(current), builder).onClick(callback));
    },
    get document() { return configure(builder => builder.document); },
    get window() { return configure(builder => builder.window); },
    get element() { return configure(builder => builder.element); },
    once: () => configure(builder => builder.once()),
    passive: () => configure(builder => builder.passive()),
    capture: () => configure(builder => builder.capture()),
    toWindow: () => configure(builder => builder.toWindow()),
    toDocument: () => configure(builder => builder.toDocument()),
    strict: policy => configure(builder => builder.strict(policy)),
    preventDefault: () => configure(builder => builder.preventDefault()),
    stopProp: () => configure(builder => builder.stopProp()),
    stopImmediateProp: () => configure(builder => builder.stopImmediateProp()),
    stopAll: () => configure(builder => builder.stopAll()),
    clearStops: () => configure(builder => builder.clearStops()),
  };
  return api;
}
