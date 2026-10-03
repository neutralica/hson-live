import type { LiveMap } from "../../src/types/livemap.types.ts";
import type { EchoReplicaTransport } from "../../src/types/echo.transport.types.ts";
import { acquire_echo_map_management_internal } from "../../src/internal/echo-map-capability.ts";
import { create_lazy_replica_echo_internal } from "../../src/api/echo/echo.lazy.ts";

/** Internal driver for focused wire/reconciliation tests. Public replica establishment uses hsonLiveMap.echo.create. */
export function create_recovery_test_driver<TMap extends LiveMap>(options: Readonly<{
  map: TMap;
  transport: EchoReplicaTransport;
  clientId?: string;
  session?: Readonly<{ credential?: string }>;
}>) {
  const management = acquire_echo_map_management_internal(options.map);
  let prepared: ReturnType<typeof create_lazy_replica_echo_internal<TMap>>;
  try { prepared = create_lazy_replica_echo_internal(options, management); }
  catch (cause) { management.release(); throw cause; }
  return Object.freeze({ ...prepared.echo, get rev() { return prepared.echo.rev; }, map: options.map,
    session: prepared.rawSession, completeRecovery: prepared.complete,
    awaitReconnect: () => prepared.echo.session.reattach() });
}
