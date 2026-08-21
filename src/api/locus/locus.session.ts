import type {
  LocusConnectionEpoch,
  LocusConnectionContext,
  LocusDisposer,
  LocusResult,
  LocusSessionCredential,
  LocusSessionDiagnostic,
  LocusSessionDiagnostics,
  LocusSessionId,
  LocusSessionLifecycleEvent,
  LocusSessionOptions,
  LocusSessionRejectCode,
  LocusSessionState,
} from "../../types/locus.types.js";

const DEFAULT_GRACE_MS = 30_000;

type SessionAttachment = Readonly<{
  fence: (sessionId: LocusSessionId, epoch: LocusConnectionEpoch) => void;
}>;

type SessionRecord = {
  readonly sessionId: LocusSessionId;
  readonly credential?: LocusSessionCredential;
  readonly resumable: boolean;
  readonly principalId?: string;
  readonly disposeResources: LocusDisposer;
  readonly subscriptionCount: () => number;
  state: LocusSessionState;
  epoch: LocusConnectionEpoch;
  attachment?: SessionAttachment;
  stopExpiry?: LocusDisposer;
  disconnectedAt?: number;
  expiresAt?: number;
  reattachmentCount: number;
  fencingCount: number;
  expiryCount: number;
  resourcesDisposed: boolean;
};

type SessionSuccess = Readonly<{
  sessionId: LocusSessionId;
  epoch: LocusConnectionEpoch;
  resumable: boolean;
  credential?: LocusSessionCredential;
}>;

export type LocusSessionManager = Readonly<{
  create: (
    sessionId: LocusSessionId,
    resumable: boolean,
    attachment: SessionAttachment,
    disposeResources: LocusDisposer,
    subscriptionCount: () => number,
    context?: LocusConnectionContext,
  ) => LocusResult<SessionSuccess>;
  reattach: (
    credential: unknown,
    attachment: SessionAttachment,
    context?: LocusConnectionContext,
  ) => LocusResult<SessionSuccess>;
  detach: (sessionId: LocusSessionId, epoch: LocusConnectionEpoch) => boolean;
  goodbye: (sessionId: LocusSessionId, epoch: LocusConnectionEpoch) => LocusResult<void>;
  is_active: (sessionId: LocusSessionId, epoch: LocusConnectionEpoch) => boolean;
  debug: () => LocusSessionDiagnostics;
  on_change: (listener: (event: LocusSessionLifecycleEvent) => void) => LocusDisposer;
  dispose: LocusDisposer;
}>;

function ok<T>(value: T): LocusResult<T> {
  return { ok: true, value };
}

function fail(code: LocusSessionRejectCode, message: string): LocusResult<never> {
  return { ok: false, error: { code, message } };
}

function default_schedule(delayMs: number, callback: () => void): LocusDisposer {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

function random_credential(): LocusSessionCredential {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function valid_credential(value: unknown): value is LocusSessionCredential {
  return typeof value === "string" && value.length >= 16 && value.length <= 512;
}

export function make_locus_session_manager(options: LocusSessionOptions = {}): LocusSessionManager {
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error("Locus session graceMs must be non-negative and finite.");
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? default_schedule;
  const makeCredential = options.credential ?? random_credential;
  const sessions = new Map<LocusSessionId, SessionRecord>();
  const credentials = new Map<LocusSessionCredential, SessionRecord>();
  const listeners = new Set<(event: LocusSessionLifecycleEvent) => void>();
  const rejected = new Map<LocusSessionRejectCode, number>();
  let totalReattachments = 0;
  let totalFencing = 0;
  let totalExpiry = 0;
  let disposed = false;

  function emit(event: LocusSessionLifecycleEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // Lifecycle observers are isolated from session authority transitions.
      }
    }
  }

  function on_change(listener: (event: LocusSessionLifecycleEvent) => void): LocusDisposer {
    if (disposed) return () => {};
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  function reject(code: LocusSessionRejectCode, message: string): LocusResult<never> {
    rejected.set(code, (rejected.get(code) ?? 0) + 1);
    return fail(code, message);
  }

  function dispose_resources(record: SessionRecord): void {
    if (record.resourcesDisposed) return;
    record.resourcesDisposed = true;
    record.disposeResources();
  }

  function expire(record: SessionRecord): void {
    if (record.state !== "disconnected") return;
    record.stopExpiry?.();
    record.stopExpiry = undefined;
    record.state = "expired";
    record.expiresAt = undefined;
    record.expiryCount += 1;
    totalExpiry += 1;
    dispose_resources(record);
    emit(Object.freeze({ kind: "expired", session: diagnostic(record) }));
  }

  function schedule_expiry(record: SessionRecord): void {
    record.stopExpiry?.();
    const disconnectedAt = now();
    record.disconnectedAt = disconnectedAt;
    record.expiresAt = disconnectedAt + graceMs;
    record.stopExpiry = schedule(graceMs, () => expire(record));
  }

  function create(
    sessionId: LocusSessionId,
    resumable: boolean,
    attachment: SessionAttachment,
    disposeResources: LocusDisposer,
    subscriptionCount: () => number,
    context?: LocusConnectionContext,
  ): LocusResult<SessionSuccess> {
    if (disposed) return fail("LOCUS_SESSION_ALREADY_GONE", "Locus session manager is disposed.");
    if (sessions.has(sessionId)) return fail("LOCUS_SESSION_CREDENTIAL_UNKNOWN", `Locus session ID is already in use: ${sessionId}`);
    let credential: LocusSessionCredential | undefined;
    if (resumable) {
      credential = makeCredential();
      if (!valid_credential(credential)) throw new Error("Locus generated session credential is malformed.");
      if (credentials.has(credential)) throw new Error("Locus generated a duplicate session credential.");
    }
    const record: SessionRecord = {
      sessionId,
      ...(credential ? { credential } : {}),
      resumable,
      ...(context?.principalId === undefined ? {} : { principalId: context.principalId }),
      disposeResources,
      subscriptionCount,
      state: "attached",
      epoch: 1,
      attachment,
      reattachmentCount: 0,
      fencingCount: 0,
      expiryCount: 0,
      resourcesDisposed: false,
    };
    sessions.set(sessionId, record);
    if (credential) credentials.set(credential, record);
    emit(Object.freeze({ kind: "attached", session: diagnostic(record), attachment: "created" }));
    return ok({ sessionId, epoch: record.epoch, resumable, ...(credential ? { credential } : {}) });
  }

  function reattach(
    credential: unknown,
    attachment: SessionAttachment,
    context?: LocusConnectionContext,
  ): LocusResult<SessionSuccess> {
    if (disposed) return reject("LOCUS_SESSION_ALREADY_GONE", "Locus session manager is disposed.");
    if (credential === undefined || credential === null || credential === "") {
      return reject("LOCUS_SESSION_CREDENTIAL_MISSING", "Locus session credential is missing.");
    }
    if (!valid_credential(credential)) {
      return reject("LOCUS_SESSION_CREDENTIAL_MALFORMED", "Locus session credential is malformed.");
    }
    const record = credentials.get(credential);
    if (!record) return reject("LOCUS_SESSION_CREDENTIAL_UNKNOWN", "Locus session credential is unknown.");
    if (record.state === "expired") return reject("LOCUS_SESSION_CREDENTIAL_EXPIRED", "Locus session credential has expired.");
    if (record.state === "revoked") return reject("LOCUS_SESSION_CREDENTIAL_REVOKED", "Locus session credential has been revoked.");
    if (record.principalId !== context?.principalId) {
      return reject("LOCUS_SESSION_CREDENTIAL_UNKNOWN", "Locus session credential is unknown.");
    }

    const previous = record.attachment;
    const previousEpoch = record.epoch;
    if (previous) {
      previous.fence(record.sessionId, previousEpoch);
      record.fencingCount += 1;
      totalFencing += 1;
      emit(Object.freeze({ kind: "fenced", sessionId: record.sessionId, epoch: previousEpoch }));
    }
    record.stopExpiry?.();
    record.stopExpiry = undefined;
    record.disconnectedAt = undefined;
    record.expiresAt = undefined;
    record.epoch += 1;
    record.attachment = attachment;
    record.state = "attached";
    record.reattachmentCount += 1;
    totalReattachments += 1;
    emit(Object.freeze({ kind: "attached", session: diagnostic(record), attachment: "reattached" }));
    return ok({ sessionId: record.sessionId, epoch: record.epoch, resumable: record.resumable });
  }

  function detach(sessionId: LocusSessionId, epoch: LocusConnectionEpoch): boolean {
    const record = sessions.get(sessionId);
    if (!record || record.state !== "attached" || record.epoch !== epoch) return false;
    record.attachment = undefined;
    record.state = "disconnected";
    if (record.resumable) schedule_expiry(record);
    else record.disconnectedAt = now();
    emit(Object.freeze({ kind: "detached", session: diagnostic(record) }));
    if (!record.resumable) expire(record);
    return true;
  }

  function goodbye(sessionId: LocusSessionId, epoch: LocusConnectionEpoch): LocusResult<void> {
    const record = sessions.get(sessionId);
    if (!record || record.state === "expired" || record.state === "revoked") {
      return reject("LOCUS_SESSION_ALREADY_GONE", "Locus session is already gone.");
    }
    if (record.state !== "attached" || record.epoch !== epoch) {
      return reject("LOCUS_SESSION_ATTACHMENT_FENCED", "Locus session attachment is no longer authoritative.");
    }
    record.stopExpiry?.();
    record.stopExpiry = undefined;
    record.attachment = undefined;
    record.state = "revoked";
    record.disconnectedAt = undefined;
    record.expiresAt = undefined;
    dispose_resources(record);
    emit(Object.freeze({ kind: "revoked", session: diagnostic(record), reason: "goodbye" }));
    return ok(undefined);
  }

  function is_active(sessionId: LocusSessionId, epoch: LocusConnectionEpoch): boolean {
    const record = sessions.get(sessionId);
    return record?.state === "attached" && record.epoch === epoch && record.attachment !== undefined;
  }

  function diagnostic(record: SessionRecord): LocusSessionDiagnostic {
    return Object.freeze({
      sessionId: record.sessionId,
      state: record.state,
      resumable: record.resumable,
      activeConnectionEpoch: record.epoch,
      transportAttached: record.attachment !== undefined,
      subscriptionCount: record.resourcesDisposed ? 0 : record.subscriptionCount(),
      ...(record.disconnectedAt !== undefined ? { disconnectedAt: record.disconnectedAt } : {}),
      ...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {}),
      reattachmentCount: record.reattachmentCount,
      fencingCount: record.fencingCount,
      expiryCount: record.expiryCount,
    });
  }

  function debug(): LocusSessionDiagnostics {
    const records = [...sessions.values()];
    const sessionDiagnostics = Object.freeze(records.map(diagnostic));
    const rejectedCredentialCounts: Partial<Record<LocusSessionRejectCode, number>> = {};
    for (const [code, count] of rejected) rejectedCredentialCounts[code] = count;
    return Object.freeze({
      activeSessionCount: records.filter((record) => record.state === "attached" || record.state === "disconnected").length,
      attachedSessionCount: records.filter((record) => record.state === "attached").length,
      disconnectedSessionCount: records.filter((record) => record.state === "disconnected").length,
      expiredSessionCount: records.filter((record) => record.state === "expired").length,
      revokedSessionCount: records.filter((record) => record.state === "revoked").length,
      reattachmentCount: totalReattachments,
      fencingCount: totalFencing,
      expiryCount: totalExpiry,
      rejectedCredentialCounts: Object.freeze(rejectedCredentialCounts),
      sessions: sessionDiagnostics,
    });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const record of sessions.values()) {
      record.stopExpiry?.();
      record.stopExpiry = undefined;
      record.attachment = undefined;
      const revoke = record.state !== "expired" && record.state !== "revoked";
      if (revoke) record.state = "revoked";
      record.disconnectedAt = undefined;
      record.expiresAt = undefined;
      dispose_resources(record);
      if (revoke) emit(Object.freeze({ kind: "revoked", session: diagnostic(record), reason: "locus_disposed" }));
    }
    credentials.clear();
    listeners.clear();
  }

  return Object.freeze({ create, reattach, detach, goodbye, is_active, debug, on_change, dispose });
}
