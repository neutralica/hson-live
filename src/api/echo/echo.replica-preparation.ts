import type { LiveMap } from "../../types/livemap.types.js";
import type { Echo, EchoInitOptions, LocusActionPayloads } from "../../types/locus.types.js";
import { acquire_echo_map_management_internal } from "../../internal/echo-map-capability.js";
import { create_lazy_replica_echo_internal } from "./echo.lazy.js";
import { compose_client_projection_internal } from "./echo.projection.js";
import { authority_projection_state_fingerprint_internal } from "../locus/locus.authority-projection-snapshot.js";
import { admit_locus_session_now } from "../locus/locus.local-initializer.js";

/** @internal A managed replica awaiting its first synchronization. */
export function prepare_echo_replica_internal<TActions extends LocusActionPayloads = LocusActionPayloads>(
  options: EchoInitOptions,
): Readonly<{
  echo: Echo<LiveMap, TActions>;
  attach: () => Promise<void>;
  detach: () => Promise<void>;
  complete: () => Promise<void>;
}> {
  if (typeof options !== "object" || options === null || typeof options.now !== "object" || options.now === null) {
    throw new TypeError("Echo initialization requires retained-session now state.");
  }
  const now = admit_locus_session_now(options.now);
  const map = compose_client_projection_internal(now.libs, now.local);
  const management = acquire_echo_map_management_internal(map);
  try {
    const prepared = create_lazy_replica_echo_internal<LiveMap, TActions>({
      map,
      socket: options.socket,
      session: { credential: options.credential },
      initialStateFingerprint: authority_projection_state_fingerprint_internal(now.libs),
      initialInitializerDigest: now.initializerDigest,
      ...(options.clientId === undefined ? {} : { clientId: options.clientId }),
    }, management);
    return Object.freeze({
      echo: prepared.echo,
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
