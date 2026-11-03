import { observe_echo_terminal_internal } from "../echo/echo.terminal.internal.js";
import { decode_ignition, ignition_path, SCOUT_LOADER_ATTRIBUTE } from "./scout.ignition.js";
import { create_echo_http_transport } from "../echo/echo.http.js";
import type { HostedDocumentContinuation } from "../continuation/continuation.types.js";
import type { ScoutProvision } from "./scout.runtime.js";

// One deferred module owns decoding, transport and the existing hosted controller.
// Re-export the original error constructor and reservation helpers, never copies.
/** @internal */
export { prepare_hosted_document_internal } from "../continuation/continue-hosted-document.js";
/** @internal */
export { ContinuationRootReservedError, continuation_root_is_active } from "../continuation/continuation.common.js";

/** @internal */
export function provision_automatic_scout(payload: string | undefined, doc: Document,
  signal: AbortSignal, moduleUrl: string): ScoutProvision {
  if (signal.aborted) throw new Error("Scout startup was cancelled.");
  const state = decode_ignition(payload);
  const view = doc.defaultView;
  if (view === null || !/^https?:$/.test(view.location.protocol)) throw new Error("Scout requires an HTTP document.");
  // Resolve against location, never a possibly foreign HTML base element.
  const endpoint = new URL(state.endpoint, view.location.origin).href;
  const transport = create_echo_http_transport({ endpoint });
  let continuation: HostedDocumentContinuation | undefined;
  let terminal = false;
  let suspended = false;
  let stopTerminal: (() => void) | undefined;
  const dispose = (): void => {
    if (terminal) return;
    terminal = true;
    stopTerminal?.();
    signal.removeEventListener("abort", dispose);
    view.removeEventListener("pagehide", hide);
    view.removeEventListener("pageshow", show);
    try { continuation?.dispose(); } finally {
      try { continuation?.echo.dispose(); } finally { transport.dispose(); continuation = undefined; }
    }
  };
  const hide = (event: PageTransitionEvent): void => {
    if (!event.persisted || continuation === undefined) { dispose(); return; }
    suspended = true;
    continuation.echo.disconnect();
  };
  const show = (event: PageTransitionEvent): void => {
    if (event.persisted && suspended && !terminal) { suspended = false; continuation?.echo.connect(); }
  };
  signal.addEventListener("abort", dispose, { once: true });
  view.addEventListener("pagehide", hide);
  view.addEventListener("pageshow", show);
  if (signal.aborted) dispose();
  return {
    options: { ...state, root: doc.documentElement, transport },
    handoff() {
      if (terminal) throw new Error("Scout startup was cancelled.");
      const loaders = doc.querySelectorAll(`script[${SCOUT_LOADER_ATTRIBUTE}]`);
      if (loaders.length !== 1) throw new Error("Scout delivery loader is missing or ambiguous.");
      const loader = loaders[0];
      if (loader.attributes.length !== 3 || loader.getAttribute("type") !== "module"
        || loader.getAttribute(SCOUT_LOADER_ATTRIBUTE) !== "1" || loader.textContent !== ""
        || loader.getAttribute("src") === null) throw new Error("Malformed Scout delivery loader.");
      const source = ignition_path(loader.getAttribute("src"));
      if (new URL(source, view.location.origin).href !== moduleUrl) throw new Error("Scout loader does not identify this module.");
      loader.remove();
    },
    accept(result) {
      signal.removeEventListener("abort", dispose);
      continuation = result;
      if (terminal) {
        try { result.dispose(); } finally { try { result.echo.dispose(); } finally { transport.dispose(); continuation = undefined; } }
      } else stopTerminal = observe_echo_terminal_internal(result.echo, dispose);
    },
    dispose,
  };
}
