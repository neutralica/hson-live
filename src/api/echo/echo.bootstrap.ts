import type { ClassifiedLiveMap, LiveMapAuthority } from "../../types/livemap.types.js";
import type { Echo, EchoOptions } from "../../types/locus.types.js";
import type { LocusBootstrap, LocusBootstrapInstall } from "../locus/locus.bootstrap.js";
import { create_echo } from "./echo.js";

export type LocusBootstrapEcho<TMap extends LiveMapAuthority = ClassifiedLiveMap> = Readonly<{
  bootstrap: LocusBootstrap;
  map: TMap;
  readonly status: "installed" | "socket-connecting" | "recovering" | "live" | "failed" | "disposed";
  readonly failure: unknown;
  echo: Echo<TMap>;
  connectAndRecover(): Promise<Readonly<{
    status: "live";
    strategy: "current" | "replay" | "snapshot";
    headRev: number;
  }>>;
  dispose(): void;
}>;

/** Continue one installed authoritative Locus bootstrap through an active Echo. */
export function create_locus_bootstrap_echo<TMap extends LiveMapAuthority>(
  install: LocusBootstrapInstall & Readonly<{ map: TMap }>,
  options: Omit<EchoOptions<TMap>, "map" | "recovery">,
): LocusBootstrapEcho<TMap> {
  const echo = create_echo({ ...options, map: install.map, recovery: install.recovery });
  let disposed = false;
  let connected = false;
  let status: LocusBootstrapEcho<TMap>["status"] = "installed";
  let failure: unknown;
  return Object.freeze({
    bootstrap: install.bootstrap,
    map: install.map,
    get status() { return status; },
    get failure() { return failure; },
    echo,
    async connectAndRecover() {
      if (disposed) throw new Error("Locus bootstrap Echo is disposed.");
      try {
        if (!connected) {
          status = "socket-connecting";
          echo.connect();
          connected = true;
        }
        status = "recovering";
        const recovered = await echo.recovery.recover();
        status = "live";
        return Object.freeze({ status: "live" as const, strategy: recovered.strategy, headRev: recovered.headRev });
      } catch (cause) {
        failure = cause;
        status = "failed";
        throw cause;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      status = "disposed";
      echo.recovery.dispose();
      echo.session.dispose();
      echo.disconnect();
      options.socket.close(1000, "Locus bootstrap Echo disposed.");
    },
  });
}
