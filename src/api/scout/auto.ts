import { configure_scout_internal, load_scout_hosted_internal } from "./scout.runtime.js";
import type { ScoutProvision } from "./scout.runtime.js";

async function provision(payload: string | undefined, target: WeakRef<Document>, signal: AbortSignal): Promise<ScoutProvision> {
  const runtime = await load_scout_hosted_internal();
  const doc = target.deref();
  if (signal.aborted || doc === undefined) throw new Error("Scout startup was cancelled.");
  return runtime.provision_automatic_scout(payload, doc, signal, import.meta.url);
}

if (typeof document !== "undefined" && typeof customElements !== "undefined") {
  void configure_scout_internal("standard", (payload, doc, signal) => provision(payload, new WeakRef(doc), signal))
    .catch(() => { /* Progressive enhancement: failed ignition leaves captured content usable. */ });
}
