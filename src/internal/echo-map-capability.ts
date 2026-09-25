/** @internal Minimal type-erased boundary between public Echo construction and LiveMap. */
/** @internal Synchronously-held exclusive management lease for a supplied Echo map. */
export type EchoMapManagementLease = Readonly<{
  owner: object;
  revision: number;
  runManaged: <T>(operation: () => T) => T;
  initialRecovery: Readonly<{ incarnationId?: string; lastAppliedRev?: number }>;
  documentMaps: readonly object[];
  release: () => void;
}>;

type EchoMapCapability = Readonly<{
  revision: () => number;
  documentMaps?: () => readonly object[];
  acquire: (owner: object) => Readonly<{
    runManaged: <T>(operation: () => T) => T;
    release: () => void;
    initialRecovery?: Readonly<{ incarnationId?: string; lastAppliedRev?: number }>;
  }>;
}>;

const capabilities = new WeakMap<object, EchoMapCapability>();

/** @internal Read-only topology evidence for orchestration that must not acquire map management. */
export function inspect_echo_map_capability_internal(value: unknown): Readonly<{
  revision: number;
  documentMaps: readonly object[];
}> {
  if (typeof value !== "object" || value === null) {
    throw new Error("LiveMap value is not a canonical map authority.");
  }
  const capability = capabilities.get(value);
  if (capability === undefined) throw new Error("LiveMap value is not a canonical map authority.");
  return Object.freeze({
    revision: capability.revision(),
    documentMaps: Object.freeze([...(capability.documentMaps?.() ?? [])]),
  });
}

/** @internal Register a completed LiveMap facade without adding a public property. */
export function register_echo_map_capability_internal(map: object, capability: EchoMapCapability): void {
  capabilities.set(map, capability);
}

/** @internal Validate a public map and acquire its exclusive Echo management synchronously. */
export function acquire_echo_map_management_internal(value: unknown): EchoMapManagementLease {
  if (typeof value !== "object" || value === null) {
    throw new Error("Echo map is not a LiveMap authority.");
  }
  const capability = capabilities.get(value);
  if (capability === undefined) throw new Error("Echo map is not a LiveMap authority.");
  const owner = Object.freeze({});
  const acquired = capability.acquire(owner);
  let released = false;
  return Object.freeze({
    owner,
    revision: capability.revision(),
    runManaged: acquired.runManaged,
    initialRecovery: Object.freeze({ ...(acquired.initialRecovery ?? {}) }),
    documentMaps: Object.freeze([...(capability.documentMaps?.() ?? [])]),
    release(): void {
      if (released) return;
      released = true;
      acquired.release();
    },
  });
}
