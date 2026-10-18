import type { LiveMap } from "../../types/livemap.types.js";
import type { Echo, EchoReplicaOptions, LocusActionPayloads } from "../../types/locus.types.js";
import { acquire_echo_map_management_internal } from "../../internal/echo-map-capability.js";
import { create_lazy_replica_echo_internal } from "./echo.lazy.js";
import { compose_client_projection_internal } from "./echo.projection.js";
import { authority_projection_state_fingerprint_internal, client_projection_identity_internal } from "../locus/locus.authority-projection-snapshot.js";
import { admit_locus_session_now } from "../locus/locus.local-initializer.js";
import { internal_livemap_aggregate_authority, type ReceivingDocumentHandoffOwner } from "../livemap/livemap.internal.js";

const receivingHandoffs = new WeakMap<object, ReceivingDocumentHandoffOwner>();

/** Initial Echo admission evidence for the continuation owner; no DOM or CSS mutation authority. @internal */
export function echo_receiving_document_handoff_internal(echo: object): ReceivingDocumentHandoffOwner {
  const capability = receivingHandoffs.get(echo);
  if (capability === undefined) throw new Error("Receiving handoff requires an admitted Echo replica.");
  return capability;
}

/** @internal A managed replica awaiting its first synchronization. */
export function prepare_echo_replica_internal<TActions extends LocusActionPayloads = LocusActionPayloads>(
  options: EchoReplicaOptions,
): Readonly<{
  echo: Echo<LiveMap, TActions>;
  map: LiveMap;
  attach: () => Promise<void>;
  detach: () => Promise<void>;
  complete: () => Promise<void>;
}> {
  if (typeof options !== "object" || options === null || typeof options.now !== "object" || options.now === null) {
    throw new TypeError("Echo replica creation requires retained-session now state.");
  }
  const now = admit_locus_session_now(options.now);
  const map = compose_client_projection_internal(now.libs, now.local, true);
  const management = acquire_echo_map_management_internal(map);
  try {
    const digest = client_projection_identity_internal(map);
    if (digest === undefined) throw new Error("Receiving handoff requires an admitted projection.");
    const handoff = internal_livemap_aggregate_authority(map).claimClientDocumentHandoff(management.owner, {
      digest,
      assertCurrent: () => {
        if (client_projection_identity_internal(map) !== digest) throw new Error("Receiving handoff projection changed.");
      },
    });
    const prepared = create_lazy_replica_echo_internal<LiveMap, TActions>({
      map,
      transport: options.transport,
      session: { credential: options.credential },
      initialStateFingerprint: authority_projection_state_fingerprint_internal(now.libs, true),
      initialInitializerDigest: now.initializerDigest,
      initialSessionBinding: now.sessionBinding,
      ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    }, management, handoff.release);
    receivingHandoffs.set(prepared.echo, handoff);
    return Object.freeze({
      echo: prepared.echo,
      map,
      async attach(): Promise<void> {
        prepared.echo.connect();
        await prepared.attach();
      },
      async complete(): Promise<void> { await prepared.complete(); },
      detach: prepared.detach,
    });
  } catch (cause) {
    management.release();
    throw cause;
  }
}
