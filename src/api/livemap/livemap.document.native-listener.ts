import { listener_conveniences } from "../../internal/listener-conveniences.js";
import type { DocumentCallbackListener } from "../../types/native-listener.types.js";
import { capture_livemap_document_element } from "./livemap.document.identity-handle.js";
import { livemap_document_callback_realization } from "./livemap.document.registration.js";

/** Resolve only at registration, so a retained builder retains its selection semantics. @internal */
export function document_callback_listener(
  owner: object,
  select: (() => readonly number[]) | undefined,
  assertReadable: () => void = () => {},
): DocumentCallbackListener {
  type Configure = (builder: DocumentCallbackListener) => DocumentCallbackListener;
  let configuration: Configure[] = [];
  const configure = (apply: Configure): DocumentCallbackListener => {
    configuration.push(apply);
    return api;
  };
  const attach = (callback: unknown, install: (builder: DocumentCallbackListener) => import("../../types/native-listener.types.js").NativeListenerSub) => {
    const pending = configuration;
    configuration = [];
    assertReadable();
    if (typeof callback !== "function") throw new TypeError("Document native listener requires a callback function.");
    const realization = livemap_document_callback_realization(owner);
    if (realization === undefined) throw new Error("Document native listener requires an active browser realization.");
    const subject = select === undefined ? { kind: "document" as const } : capture_livemap_document_element(owner, select)();
    return realization(subject, builder => install(pending.reduce((current, apply) => apply(current), builder)));
  };
  const api: DocumentCallbackListener = {
    on: (type, callback) => attach(callback, builder => builder.on(type, callback)),
    onCustom: (type, callback) => attach(callback, builder => builder.onCustom(type, callback)),
    onCustomDetail: (type, callback) => attach(callback, builder => builder.onCustomDetail(type, callback)),
    ...listener_conveniences((event, callback) => attach(callback, builder => builder.onCustom(event, callback))),
    get document() { return configure(builder => builder.document); },
    get window() { return configure(builder => builder.window); },
    get element() {
      if (select === undefined) { configuration = []; throw new TypeError("A Document Library cannot use element listener placement."); }
      return configure(builder => builder.element);
    },
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
  pendingOptions.set(api, () => {
    const pending = configuration.length > 0;
    configuration = [];
    if (pending) throw new TypeError("listen.event() cannot combine fluent listener options with an authored declaration.");
  });
  return api;
}

const pendingOptions = new WeakMap<object, () => void>();
export function assert_no_pending_document_options(builder: DocumentCallbackListener): void {
  pendingOptions.get(builder)?.();
}
