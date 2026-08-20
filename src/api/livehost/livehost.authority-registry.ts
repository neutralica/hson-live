import type {
  LiveHostActivitySnapshot,
  LiveHostAuthorityAcquisition,
  LiveHostAuthorityEvictionResult,
  LiveHostAuthorityRegistry,
  LiveHostAuthorityRegistryBlocker,
  LiveHostAuthorityRegistryEvent,
  LiveHostAuthorityRegistryOptions,
  LiveHostDisposer,
  LiveHostLifecycleAuthority,
  LiveHostResult,
  LiveHostStoreId,
} from "../../types/livehost.types.js";

// Application-owned coalescing, residency, release, and eviction key.
type AcquisitionResidencyKey = LiveHostStoreId;

type PendingEntry<TAuthority extends LiveHostLifecycleAuthority> = {
  readonly state: "loading";
  readonly promise: Promise<TAuthority>;
};

type ReadyEntry<TAuthority extends LiveHostLifecycleAuthority> = {
  state: "ready" | "disposing";
  readonly authority: TAuthority;
  acquisitions: number;
  generation: number;
  lastUsedAt: number;
  idleSince?: number;
  stopActivity: LiveHostDisposer;
  disposal?: Promise<LiveHostAuthorityEvictionResult>;
};

type Entry<TAuthority extends LiveHostLifecycleAuthority> =
  | PendingEntry<TAuthority>
  | ReadyEntry<TAuthority>;

function ok<T>(value: T): LiveHostResult<T> {
  return Object.freeze({ ok: true, value });
}

function fail<T>(code: string, message: string): LiveHostResult<T> {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) });
}

function default_schedule(delayMs: number, callback: () => void): LiveHostDisposer {
  const timer = setTimeout(callback, delayMs);
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as ReturnType<typeof setTimeout> & { unref(): void }).unref();
  }
  return () => clearTimeout(timer);
}

function positive_integer(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`LiveHost authority registry ${name} must be a positive integer.`);
  }
  return value;
}

function nonnegative_finite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`LiveHost authority registry ${name} must be finite and non-negative.`);
  }
  return value;
}

/** Application-owned, activity-aware registry for finite authority lifetimes. */
export function create_livehost_authority_registry<
  TAuthority extends LiveHostLifecycleAuthority,
>(
  options: LiveHostAuthorityRegistryOptions<TAuthority>,
): LiveHostAuthorityRegistry<TAuthority> {
  const maxAuthorities = positive_integer(options.maxAuthorities, "maxAuthorities");
  const idleMs = nonnegative_finite(options.idleMs, "idleMs");
  const sweepIntervalMs = positive_integer(
    options.sweepIntervalMs ?? Math.max(1, Math.min(30_000, idleMs || 1_000)),
    "sweepIntervalMs",
  );
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? default_schedule;
  const event = (value: LiveHostAuthorityRegistryEvent): void => {
    try {
      options.event?.(Object.freeze(value));
    } catch {
      // Lifecycle policy cannot be changed by an operational observer.
    }
  };
  const entries = new Map<AcquisitionResidencyKey, Entry<TAuthority>>();
  let state: "accepting" | "disposing" | "disposed" = "accepting";
  let stopSweep: LiveHostDisposer | undefined;
  let sweepRunning: Promise<number> | undefined;
  let disposal: Promise<void> | undefined;

  function dispose_authority(authority: TAuthority): void | Promise<void> {
    return options.dispose === undefined ? authority.dispose() : options.dispose(authority);
  }

  function schedule_sweep(): void {
    if (state !== "accepting" || stopSweep !== undefined) return;
    stopSweep = schedule(sweepIntervalMs, () => {
      stopSweep = undefined;
      void sweep().finally(schedule_sweep);
    });
  }

  function entry_snapshot(entry: ReadyEntry<TAuthority>): LiveHostActivitySnapshot {
    return entry.authority.activity.snapshot();
  }

  function blockers(entry: ReadyEntry<TAuthority>): readonly LiveHostAuthorityRegistryBlocker[] {
    const values: LiveHostAuthorityRegistryBlocker[] = [];
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

  function install_ready(key: AcquisitionResidencyKey, authority: TAuthority): ReadyEntry<TAuthority> {
    const entry: ReadyEntry<TAuthority> = {
      state: "ready",
      authority,
      acquisitions: 0,
      generation: 0,
      lastUsedAt: now(),
      stopActivity: () => {},
    };
    entry.stopActivity = authority.activity.on_change((snapshot) => update_idle(key, entry, snapshot));
    update_idle(key, entry);
    return entry;
  }

  function acquire_ready(
    key: AcquisitionResidencyKey,
    entry: ReadyEntry<TAuthority>,
  ): LiveHostResult<LiveHostAuthorityAcquisition<TAuthority>> {
    if (state !== "accepting" || entry.state !== "ready") {
      return fail("LIVEHOST_AUTHORITY_REGISTRY_UNAVAILABLE", "LiveHost authority registry is unavailable.");
    }
    entry.acquisitions += 1;
    entry.lastUsedAt = now();
    entry.generation += 1;
    update_idle(key, entry);
    let held = true;
    return ok(Object.freeze({
      authority: entry.authority,
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
  ): Promise<LiveHostAuthorityEvictionResult> {
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
    const operation = (async (): Promise<LiveHostAuthorityEvictionResult> => {
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
          code: "LIVEHOST_AUTHORITY_EVICTION_FAILED",
          message: cause instanceof Error ? cause.message : "LiveHost authority eviction failed.",
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
  ): Promise<LiveHostResult<LiveHostAuthorityAcquisition<TAuthority>>> {
    if (state !== "accepting") {
      return fail("LIVEHOST_AUTHORITY_REGISTRY_DISPOSED", "LiveHost authority registry is disposed.");
    }
    const existing = entries.get(key);
    if (existing?.state === "ready") return acquire_ready(key, existing);
    if (existing?.state === "disposing") {
      return fail("LIVEHOST_AUTHORITY_DISPOSING", "LiveHost authority is disposing.");
    }
    if (existing?.state === "loading") {
      try {
        const authority = await existing.promise;
        const ready = entries.get(key);
        return ready?.state === "ready" && ready.authority === authority
          ? acquire_ready(key, ready)
          : fail("LIVEHOST_AUTHORITY_REGISTRY_UNAVAILABLE", "LiveHost authority is unavailable.");
      } catch (cause) {
        return fail(
          "LIVEHOST_AUTHORITY_CREATION_FAILED",
          cause instanceof Error ? cause.message : "LiveHost authority creation failed.",
        );
      }
    }
    if (!(await ensure_capacity())) {
      event({ type: "capacity-rejected", key, code: "LIVEHOST_AUTHORITY_CAPACITY_EXHAUSTED" });
      return fail(
        "LIVEHOST_AUTHORITY_CAPACITY_EXHAUSTED",
        "LiveHost authority capacity is exhausted and no idle authority can be evicted.",
      );
    }
    if (state !== "accepting") {
      return fail("LIVEHOST_AUTHORITY_REGISTRY_DISPOSED", "LiveHost authority registry is disposed.");
    }
    const raced = entries.get(key);
    if (raced !== undefined) return acquire(key);

    event({ type: "creation-started", key });
    let loading!: Promise<TAuthority>;
    loading = Promise.resolve().then(() => options.create(key)).then(async (authority) => {
      if (state !== "accepting" || entries.get(key)?.state !== "loading") {
        await dispose_authority(authority);
        throw new Error("LiveHost authority registry stopped during creation.");
      }
      entries.set(key, install_ready(key, authority));
      event({ type: "creation-completed", key });
      return authority;
    }, (cause) => {
      if (entries.get(key)?.state === "loading") entries.delete(key);
      event({ type: "creation-failed", key, code: "LIVEHOST_AUTHORITY_CREATION_FAILED" });
      throw cause;
    });
    entries.set(key, { state: "loading", promise: loading });
    try {
      const authority = await loading;
      const ready = entries.get(key);
      return ready?.state === "ready" && ready.authority === authority
        ? acquire_ready(key, ready)
        : fail("LIVEHOST_AUTHORITY_REGISTRY_UNAVAILABLE", "LiveHost authority is unavailable.");
    } catch (cause) {
      if (entries.get(key)?.state === "loading") entries.delete(key);
      return fail(
        "LIVEHOST_AUTHORITY_CREATION_FAILED",
        cause instanceof Error ? cause.message : "LiveHost authority creation failed.",
      );
    }
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
        event({ type: "disposal-failed", code: "LIVEHOST_AUTHORITY_REGISTRY_DISPOSAL_FAILED" });
        throw new AggregateError(failures, "LiveHost authority registry disposal failed.");
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
