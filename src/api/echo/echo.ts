import type { LiveMap } from "../../types/livemap.types.js";
import type {
  Echo,
  EchoOptions,
  EchoReplicaOptions,
  LocusActionPayloads,
} from "../../types/locus.types.js";
import { create_endpoint_echo_internal, replica_transport_internal } from "./echo.client.js";

const claimedTransports = new WeakSet<object>();

function claimTransport(transport: unknown, replica: boolean): void {
  if (typeof transport !== "object" || transport === null
    || !Reflect.has(transport, "operations") || !Reflect.has(transport, "attachment")) {
    throw new TypeError("Echo requires finite operations and attachment observation.");
  }
  const operations = Reflect.get(transport, "operations");
  const attachment = Reflect.get(transport, "attachment");
  if (typeof operations !== "object" || operations === null || typeof Reflect.get(operations, "submit") !== "function"
    || typeof attachment !== "object" || attachment === null || typeof Reflect.get(attachment, "observe") !== "function") {
    throw new TypeError("Echo requires finite operations and attachment observation.");
  }
  if (replica) replica_transport_internal(transport as EchoOptions["transport"]);
  if (claimedTransports.has(transport)) throw new TypeError("One semantic transport instance belongs to one Echo for its lifetime.");
  claimedTransports.add(transport);
}

/** Create an endpoint immediately or a caught-up replica from retained-session state. */
export function create_echo<TActions extends LocusActionPayloads = LocusActionPayloads>(options: EchoOptions): Echo<undefined, TActions>;
export function create_echo<TActions extends LocusActionPayloads = LocusActionPayloads>(options: EchoReplicaOptions): Promise<Echo<LiveMap, TActions>>;
export function create_echo<TActions extends LocusActionPayloads = LocusActionPayloads>(
  options: EchoOptions | EchoReplicaOptions,
): Echo<undefined, TActions> | Promise<Echo<LiveMap, TActions>> {
  if (typeof options !== "object" || options === null) throw new TypeError("Echo.create requires options.");
  const replica = "now" in options || "credential" in options;
  if (replica) {
    if (!("now" in options) || !("credential" in options)
      || options.now === undefined || typeof options.credential !== "string" || options.credential.length === 0) {
      throw new TypeError("Echo replica creation requires now and credential.");
    }
    claimTransport(options.transport, true);
    return createReplica<TActions>(options as EchoReplicaOptions);
  }
  if ("map" in options || "recovery" in options) throw new TypeError("Echo endpoint creation received replica state.");
  claimTransport(options.transport, false);
  return create_endpoint_echo_internal<TActions>(options);
}

/** Admit, attach, and synchronize one authorized current session composition. */
async function createReplica<TActions extends LocusActionPayloads = LocusActionPayloads>(
  options: EchoReplicaOptions,
): Promise<Echo<LiveMap, TActions>> {
  let prepared: ReturnType<typeof import("./echo.replica-preparation.js").prepare_echo_replica_internal<TActions>>;
  try {
    const { prepare_echo_replica_internal } = await import("./echo.replica-preparation.js");
    prepared = prepare_echo_replica_internal<TActions>(options);
  } catch (cause) {
    claimedTransports.delete(options.transport);
    throw cause;
  }
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
