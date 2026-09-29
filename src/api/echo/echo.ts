import type { LiveMap } from "../../types/livemap.types.js";
import type {
  Echo,
  EchoOptions,
  EchoReplicateOptions,
  LocusActionPayloads,
} from "../../types/locus.types.js";
import { create_endpoint_echo_internal } from "./echo.client.js";

/** Endpoint-only transport, session, and action composition. */
export function create_echo<TActions extends LocusActionPayloads = LocusActionPayloads>(
  options: EchoOptions,
): Echo<undefined, TActions> {
  if (typeof options !== "object" || options === null || "map" in options || "recovery" in options) {
    throw new TypeError("Echo.create is endpoint-only; use Echo.replicate for a state replica.");
  }
  return create_endpoint_echo_internal<TActions>(options);
}

/** Admit, attach, and synchronize one authorized session cut. */
export async function replicate_echo_internal<TActions extends LocusActionPayloads = LocusActionPayloads>(
  options: EchoReplicateOptions,
): Promise<Echo<LiveMap, TActions>> {
  const { prepare_echo_replica_internal } = await import("./echo.replica-preparation.js");
  const prepared = prepare_echo_replica_internal<TActions>(options);
  try {
    await prepared.attach();
    await prepared.complete();
    return prepared.echo;
  } catch (cause) {
    try { await prepared.detach(); } catch { /* Preserve establishment failure. */ }
    prepared.echo.dispose();
    throw cause;
  }
}
