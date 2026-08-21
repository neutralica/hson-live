import type {
  Locus,
  LocusActivity,
  LocusActivityKind,
  LocusActivitySnapshot,
} from "../../../types/locus.core.types.js";
import type {
  LiveHostLocusAcquisition,
  LiveHostLocusEvictionResult,
  LiveHostLocusRegistry,
  LiveHostLocusRegistryOptions,
  LiveHostLocusRegistryResult,
} from "../../../types/livehost.types.js";
import type { LocusDisposer } from "../../../types/locus.shared.types.js";

// Application-owned coalescing, residency, release, and eviction key.
type AcquisitionResidencyKey = string;
type RegistryBlocker = LocusActivityKind | "acquisition" | "loading" | "disposing";
type RegistryEvent = Readonly<{
  type:
    | "creation-started"
    | "creation-completed"
    | "creation-failed"
    | "became-active"
    | "became-idle"
    | "eviction-requested"
    | "eviction-blocked"
    | "eviction-completed"
    | "eviction-failed"
    | "capacity-rejected"
    | "disposal-started"
    | "disposal-completed"
    | "disposal-failed";
  key?: string;
  code?: string;
  blockers?: readonly RegistryBlocker[];
}>;
type RegistryRuntime = Readonly<{
  now?: () => number;
  schedule?: (delayMs: number, callback: () => void) => LocusDisposer;
  event?: (event: RegistryEvent) => void;
}>;
type ManagedLocus = Readonly<{ activity: LocusActivity; dispose(): void }>;
type RegistryDiagnostics = Readonly<{
  state: "accepting" | "disposing" | "disposed";
  entryCount: number;
  loadingCount: number;
  activeCount: number;
  idleCount: number;
  disposingCount: number;
  acquisitionCount: number;
}>;
type InternalRegistry<TLocus extends ManagedLocus> = LiveHostLocusRegistry<TLocus> & Readonly<{
  sweep(): Promise<number>;
  diagnostics(): RegistryDiagnostics;
}>;

type PendingEntry<TAuthority extends ManagedLocus> = {
  readonly state: "loading";
  readonly promise: Promise<TAuthority>;
  acquisitions: number;
};

type ReadyEntry<TAuthority extends ManagedLocus> = {
  state: "ready" | "disposing";
  readonly authority: TAuthority;
  acquisitions: number;
  generation: number;
  lastUsedAt: number;
  idleSince?: number;
  stopActivity: LocusDisposer;
  disposal?: Promise<LiveHostLocusEvictionResult>;
};

type Entry<TAuthority extends ManagedLocus> =
  | PendingEntry<TAuthority>
  | ReadyEntry<TAuthority>;

function ok<T>(value: T): LiveHostLocusRegistryResult<T> {
  return Object.freeze({ ok: true, value });
}

function fail<T>(code: string, message: string, cause?: unknown): LiveHostLocusRegistryResult<T> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, ...(cause === undefined ? {} : { cause }) }),
  });
}

function default_schedule(delayMs: number, callback: () => void): LocusDisposer {
  const timer = setTimeout(callback, delayMs);
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    const unref = Reflect.get(timer, "unref");
    if (typeof unref === "function") Reflect.apply(unref, timer, []);
  }
  return () => clearTimeout(timer);
}

function positive_integer(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`LiveHost Locus registry ${name} must be a positive integer.`);
  }
  return value;
}

function nonnegative_finite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`LiveHost Locus registry ${name} must be finite and non-negative.`);
  }
  return value;
}

/** Application-owned, activity-aware registry for finite Locus lifetimes. */
export function create_livehost_locus_registry<
  TAuthority extends ManagedLocus = Locus,
>(
  options: LiveHostLocusRegistryOptions<TAuthority>,
): LiveHostLocusRegistry<TAuthority> {
  return create_livehost_locus_registry_internal(options);
}

/** @internal Deterministic runtime seam; not part of the public LiveHost contract. */
export function create_livehost_locus_registry_internal<
  TAuthority extends ManagedLocus = Locus,
>(
  options: LiveHostLocusRegistryOptions<TAuthority>,
  runtime: RegistryRuntime = {},
): InternalRegistry<TAuthority> {
  const maxAuthorities = positive_integer(options.maxLoci, "maxLoci");
  const idleMs = nonnegative_finite(options.idleMs, "idleMs");
  const automaticSweep = options.automaticSweep ?? true;
  if (typeof automaticSweep !== "boolean") {
    throw new Error("LiveHost Locus registry automaticSweep must be boolean.");
  }
  if (!automaticSweep && options.sweepIntervalMs !== undefined) {
    throw new Error("LiveHost Locus registry automaticSweep false cannot specify sweepIntervalMs.");
  }
  const sweepIntervalMs = automaticSweep
    ? positive_integer(
      options.sweepIntervalMs ?? Math.max(1, Math.min(30_000, idleMs || 1_000)),
      "sweepIntervalMs",
    )
    : undefined;
  const now = runtime.now ?? (() => performance.now());
  const schedule = runtime.schedule ?? default_schedule;
  const event = (value: RegistryEvent): void => {
    try {
      runtime.event?.(Object.freeze(value));
    } catch {
      // Lifecycle policy cannot be changed by an operational observer.
    }
  };
  const entries = new Map<AcquisitionResidencyKey, Entry<TAuthority>>();
  let state: "accepting" | "disposing" | "disposed" = "accepting";
  let stopSweep: LocusDisposer | undefined;
  let sweepRunning: Promise<number> | undefined;
  let disposal: Promise<void> | undefined;
  let admissionTail = Promise.resolve();
  let queuedAdmissions = 0;

  async function with_admission<T>(run: () => T | Promise<T>): Promise<T> {
    queuedAdmissions += 1;
    const previous = admissionTail;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    admissionTail = previous.then(() => current);
    await previous;
    try {
      return await run();
    } finally {
      queuedAdmissions = Math.max(0, queuedAdmissions - 1);
      release();
    }
  }

  function dispose_authority(authority: TAuthority): void | Promise<void> {
    return options.dispose === undefined ? authority.dispose() : options.dispose(authority);
  }

  function schedule_sweep(): void {
    if (!automaticSweep || sweepIntervalMs === undefined || state !== "accepting" || stopSweep !== undefined) return;
    stopSweep = schedule(sweepIntervalMs, () => {
      stopSweep = undefined;
      void sweep().finally(schedule_sweep);
    });
  }

  function entry_snapshot(entry: ReadyEntry<TAuthority>): LocusActivitySnapshot {
    return entry.authority.activity.snapshot();
  }

  function blockers(entry: ReadyEntry<TAuthority>): readonly RegistryBlocker[] {
    const values: RegistryBlocker[] = [];
    if (entry.acquisitions > 0) values.push("acquisition");
    values.push(...entry_snapshot(entry).blockers);
    return Object.freeze(values);
  }

  function update_idle(
    key: AcquisitionResidencyKey,
    entry: ReadyEntry<TAuthority>,
    snapshot = entry_snapshot(entry),
  ): void {
    if (entry.state !== "ready") return;
    const active = entry.acquisitions > 0 || snapshot.state === "active";
    if (active) {
      if (entry.idleSince !== undefined) {
        entry.idleSince = undefined;
        entry.generation += 1;
        event({ type: "became-active", key });
      }
      return;
    }
    if (entry.idleSince === undefined) {
      entry.idleSince = now();
      entry.generation += 1;
      event({ type: "became-idle", key });
    }
  }

  function install_ready(
    key: AcquisitionResidencyKey,
    authority: TAuthority,
    acquisitions = 0,
  ): ReadyEntry<TAuthority> {
    const entry: ReadyEntry<TAuthority> = {
      state: "ready",
      authority,
      acquisitions,
      generation: 0,
      lastUsedAt: now(),
      stopActivity: () => {},
    };
    entry.stopActivity = authority.activity.on_change((snapshot) => update_idle(key, entry, snapshot));
    update_idle(key, entry);
    return entry;
  }

  function reserve_loading(key: AcquisitionResidencyKey): PendingEntry<TAuthority> {
    event({ type: "creation-started", key });
    let entry!: PendingEntry<TAuthority>;
    let loading!: Promise<TAuthority>;
    loading = Promise.resolve().then(() => options.create(key)).then(async (authority) => {
      if (state !== "accepting" || entries.get(key)?.state !== "loading") {
        await dispose_authority(authority);
        throw new Error("LiveHost Locus registry stopped during creation.");
      }
      entries.set(key, install_ready(key, authority, entry.acquisitions));
      event({ type: "creation-completed", key });
      return authority;
    }, (cause) => {
      if (entries.get(key)?.state === "loading") entries.delete(key);
      event({ type: "creation-failed", key, code: "LIVEHOST_LOCUS_CREATION_FAILED" });
      throw cause;
    });
    entry = { state: "loading", promise: loading, acquisitions: 0 };
    entries.set(key, entry);
    return entry;
  }

  async function acquire_loading(
    key: AcquisitionResidencyKey,
    entry: PendingEntry<TAuthority>,
  ): Promise<LiveHostLocusRegistryResult<LiveHostLocusAcquisition<TAuthority>>> {
    entry.acquisitions += 1;
    try {
      const authority = await entry.promise;
      const ready = entries.get(key);
      return ready?.state === "ready" && ready.authority === authority
        ? acquire_ready(key, ready, true)
        : fail("LIVEHOST_LOCUS_REGISTRY_UNAVAILABLE", "LiveHost Locus is unavailable.");
    } catch (cause) {
      if (entries.get(key)?.state === "loading") entries.delete(key);
      return fail(
        "LIVEHOST_LOCUS_CREATION_FAILED",
        cause instanceof Error ? cause.message : "LiveHost Locus creation failed.",
        cause,
      );
    }
  }

  function acquire_ready(
    key: AcquisitionResidencyKey,
    entry: ReadyEntry<TAuthority>,
    reserved = false,
  ): LiveHostLocusRegistryResult<LiveHostLocusAcquisition<TAuthority>> {
    if (state !== "accepting" || entry.state !== "ready") {
      if (reserved) entry.acquisitions = Math.max(0, entry.acquisitions - 1);
      return fail("LIVEHOST_LOCUS_REGISTRY_UNAVAILABLE", "LiveHost Locus registry is unavailable.");
    }
    if (!reserved) entry.acquisitions += 1;
    entry.lastUsedAt = now();
    entry.generation += 1;
    update_idle(key, entry);
    let held = true;
    return ok(Object.freeze({
      locus: entry.authority,
      release() {
        if (!held) return;
        held = false;
        entry.acquisitions = Math.max(0, entry.acquisitions - 1);
        entry.lastUsedAt = now();
        entry.generation += 1;
        update_idle(key, entry);
      },
    }));
  }

  function idle_candidates(ignoreIdleDuration: boolean): readonly [AcquisitionResidencyKey, ReadyEntry<TAuthority>][] {
    return [...entries.entries()]
      .filter((item): item is [AcquisitionResidencyKey, ReadyEntry<TAuthority>] => {
        const entry = item[1];
        return entry.state === "ready"
          && blockers(entry).length === 0
          && entry.idleSince !== undefined
          && (ignoreIdleDuration || now() - entry.idleSince >= idleMs);
      })
      .sort((left, right) => {
        const idleDifference = (left[1].idleSince ?? 0) - (right[1].idleSince ?? 0);
        return idleDifference || left[1].lastUsedAt - right[1].lastUsedAt || left[0].localeCompare(right[0]);
      });
  }

  async function evict_entry(
    key: AcquisitionResidencyKey,
    expectedGeneration?: number,
  ): Promise<LiveHostLocusEvictionResult> {
    event({ type: "eviction-requested", key });
    const current = entries.get(key);
    if (current === undefined) return Object.freeze({ status: "not-found" });
    if (current.state === "loading") {
      const result = Object.freeze({ status: "busy" as const, blockers: Object.freeze(["loading" as const]) });
      event({ type: "eviction-blocked", key, blockers: result.blockers });
      return result;
    }
    if (current.state === "disposing") return Object.freeze({ status: "disposing" });
    if (expectedGeneration !== undefined && current.generation !== expectedGeneration) {
      const result = Object.freeze({ status: "busy" as const, blockers: blockers(current) });
      event({ type: "eviction-blocked", key, blockers: result.blockers });
      return result;
    }
    const activeBlockers = blockers(current);
    if (activeBlockers.length > 0) {
      const result = Object.freeze({ status: "busy" as const, blockers: activeBlockers });
      event({ type: "eviction-blocked", key, blockers: activeBlockers });
      return result;
    }

    current.state = "disposing";
    current.generation += 1;
    current.stopActivity();
    const operation = (async (): Promise<LiveHostLocusEvictionResult> => {
      try {
        await dispose_authority(current.authority);
        if (entries.get(key) === current) entries.delete(key);
        event({ type: "eviction-completed", key });
        return Object.freeze({ status: "evicted" });
      } catch (cause) {
        current.state = "ready";
        current.generation += 1;
        current.stopActivity = current.authority.activity.on_change((snapshot) => update_idle(key, current, snapshot));
        update_idle(key, current);
        const error = Object.freeze({
          code: "LIVEHOST_LOCUS_EVICTION_FAILED",
          message: cause instanceof Error ? cause.message : "LiveHost Locus eviction failed.",
          cause,
        });
        event({ type: "eviction-failed", key, code: error.code });
        return Object.freeze({ status: "failed", error });
      } finally {
        current.disposal = undefined;
      }
    })();
    current.disposal = operation;
    return operation;
  }

  async function ensure_capacity(): Promise<boolean> {
    while (entries.size >= maxAuthorities) {
      const candidate = idle_candidates(true)[0];
      if (candidate === undefined) return false;
      const outcome = await evict_entry(candidate[0], candidate[1].generation);
      if (outcome.status !== "evicted" && entries.size >= maxAuthorities) return false;
    }
    return true;
  }

  async function acquire(
    key: AcquisitionResidencyKey,
  ): Promise<LiveHostLocusRegistryResult<LiveHostLocusAcquisition<TAuthority>>> {
    if (state !== "accepting") {
      return fail("LIVEHOST_LOCUS_REGISTRY_DISPOSED", "LiveHost Locus registry is disposed.");
    }
    const existing = entries.get(key);
    if (existing?.state === "ready") return acquire_ready(key, existing);
    if (existing?.state === "disposing") {
      return fail("LIVEHOST_LOCUS_DISPOSING", "LiveHost Locus is disposing.");
    }
    if (existing?.state === "loading") {
      return acquire_loading(key, existing);
    }
    if (queuedAdmissions === 0 && entries.size < maxAuthorities) {
      return acquire_loading(key, reserve_loading(key));
    }
    const admitted = await with_admission(async () => {
      if (state !== "accepting") {
        return Object.freeze({
          kind: "failure" as const,
          result: fail<LiveHostLocusAcquisition<TAuthority>>(
            "LIVEHOST_LOCUS_REGISTRY_DISPOSED",
            "LiveHost Locus registry is disposed.",
          ),
        });
      }
      const raced = entries.get(key);
      if (raced !== undefined) return Object.freeze({ kind: "entry" as const, entry: raced });
      if (!(await ensure_capacity())) {
        event({ type: "capacity-rejected", key, code: "LIVEHOST_LOCUS_CAPACITY_EXHAUSTED" });
        return Object.freeze({
          kind: "failure" as const,
          result: fail<LiveHostLocusAcquisition<TAuthority>>(
            "LIVEHOST_LOCUS_CAPACITY_EXHAUSTED",
            "LiveHost Locus capacity is exhausted and no idle Locus can be evicted.",
          ),
        });
      }
      if (state !== "accepting") {
        return Object.freeze({
          kind: "failure" as const,
          result: fail<LiveHostLocusAcquisition<TAuthority>>(
            "LIVEHOST_LOCUS_REGISTRY_DISPOSED",
            "LiveHost Locus registry is disposed.",
          ),
        });
      }
      const capacityRace = entries.get(key);
      if (capacityRace !== undefined) return Object.freeze({ kind: "entry" as const, entry: capacityRace });

      const entry = reserve_loading(key);
      return Object.freeze({ kind: "entry" as const, entry });
    });
    if (admitted.kind === "failure") return admitted.result;
    if ("promise" in admitted.entry) {
      return acquire_loading(key, admitted.entry);
    }
    if (admitted.entry.state === "ready") return acquire_ready(key, admitted.entry);
    return fail("LIVEHOST_LOCUS_DISPOSING", "LiveHost Locus is disposing.");
  }

  async function sweep(): Promise<number> {
    if (state !== "accepting") return 0;
    if (sweepRunning !== undefined) return sweepRunning;
    sweepRunning = (async () => {
      let removed = 0;
      for (const [key, entry] of idle_candidates(false)) {
        if (state !== "accepting") break;
        const result = await evict_entry(key, entry.generation);
        if (result.status === "evicted") removed += 1;
      }
      return removed;
    })();
    try {
      return await sweepRunning;
    } finally {
      sweepRunning = undefined;
    }
  }

  async function dispose(): Promise<void> {
    if (disposal !== undefined) return disposal;
    if (state === "disposed") return;
    state = "disposing";
    stopSweep?.();
    stopSweep = undefined;
    event({ type: "disposal-started" });
    disposal = (async () => {
      const failures: unknown[] = [];
      const pending = [...entries.values()]
        .filter((entry): entry is PendingEntry<TAuthority> => entry.state === "loading")
        .map((entry) => entry.promise.catch((cause) => {
          failures.push(cause);
          return undefined;
        }));
      await Promise.all(pending);
      for (const [key, entry] of [...entries]) {
        if (entry.state === "loading") {
          entries.delete(key);
          continue;
        }
        if (entry.state === "disposing") {
          const outcome = await entry.disposal;
          if (outcome?.status === "failed") failures.push(outcome.error.cause ?? outcome.error);
          continue;
        }
        entry.state = "disposing";
        entry.stopActivity();
        try {
          await dispose_authority(entry.authority);
          entries.delete(key);
        } catch (cause) {
          failures.push(cause);
        }
      }
      state = "disposed";
      if (failures.length > 0) {
        event({ type: "disposal-failed", code: "LIVEHOST_LOCUS_REGISTRY_DISPOSAL_FAILED" });
        throw new AggregateError(failures, "LiveHost Locus registry disposal failed.");
      }
      event({ type: "disposal-completed" });
    })();
    return disposal;
  }

  schedule_sweep();

  return Object.freeze({
    acquire,
    evict: evict_entry,
    sweep,
    has: (key: AcquisitionResidencyKey) => entries.has(key),
    diagnostics() {
      const values = [...entries.values()];
      const ready = values.filter((entry): entry is ReadyEntry<TAuthority> => entry.state !== "loading");
      return Object.freeze({
        state,
        entryCount: entries.size,
        loadingCount: values.filter((entry) => entry.state === "loading").length,
        activeCount: ready.filter((entry) => entry.state === "ready" && blockers(entry).length > 0).length,
        idleCount: ready.filter((entry) => entry.state === "ready" && blockers(entry).length === 0).length,
        disposingCount: ready.filter((entry) => entry.state === "disposing").length,
        acquisitionCount: ready.reduce((total, entry) => total + entry.acquisitions, 0),
      });
    },
    dispose,
  });
}
