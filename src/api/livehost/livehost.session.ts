import type {
  LiveHostConnectionEpoch,
  LiveHostDisposer,
  LiveHostResult,
  LiveHostSessionCredential,
  LiveHostSessionDiagnostic,
  LiveHostSessionDiagnostics,
  LiveHostSessionId,
  LiveHostSessionOptions,
  LiveHostSessionRejectCode,
  LiveHostSessionState,
} from "../../types/livehost.types.js";

const DEFAULT_GRACE_MS = 30_000;

type SessionAttachment = Readonly<{
  fence: (sessionId: LiveHostSessionId, epoch: LiveHostConnectionEpoch) => void;
}>;

type SessionRecord = {
  readonly sessionId: LiveHostSessionId;
  readonly credential?: LiveHostSessionCredential;
  readonly resumable: boolean;
  readonly disposeResources: LiveHostDisposer;
  readonly subscriptionCount: () => number;
  state: LiveHostSessionState;
  epoch: LiveHostConnectionEpoch;
  attachment?: SessionAttachment;
  stopExpiry?: LiveHostDisposer;
  disconnectedAt?: number;
  expiresAt?: number;
  reattachmentCount: number;
  fencingCount: number;
  expiryCount: number;
  resourcesDisposed: boolean;
};

type SessionSuccess = Readonly<{
  sessionId: LiveHostSessionId;
  epoch: LiveHostConnectionEpoch;
  credential?: LiveHostSessionCredential;
}>;

export type LiveHostSessionManager = Readonly<{
  create: (
    sessionId: LiveHostSessionId,
    resumable: boolean,
    attachment: SessionAttachment,
    disposeResources: LiveHostDisposer,
    subscriptionCount: () => number,
  ) => LiveHostResult<SessionSuccess>;
  reattach: (credential: unknown, attachment: SessionAttachment) => LiveHostResult<SessionSuccess>;
  detach: (sessionId: LiveHostSessionId, epoch: LiveHostConnectionEpoch) => boolean;
  goodbye: (sessionId: LiveHostSessionId, epoch: LiveHostConnectionEpoch) => LiveHostResult<void>;
  is_active: (sessionId: LiveHostSessionId, epoch: LiveHostConnectionEpoch) => boolean;
  debug: () => LiveHostSessionDiagnostics;
  dispose: LiveHostDisposer;
}>;

function ok<T>(value: T): LiveHostResult<T> {
  return { ok: true, value };
}

function fail(code: LiveHostSessionRejectCode, message: string): LiveHostResult<never> {
  return { ok: false, error: { code, message } };
}

function default_schedule(delayMs: number, callback: () => void): LiveHostDisposer {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

function random_credential(): LiveHostSessionCredential {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function valid_credential(value: unknown): value is LiveHostSessionCredential {
  return typeof value === "string" && value.length >= 16 && value.length <= 512;
}

export function make_livehost_session_manager(options: LiveHostSessionOptions = {}): LiveHostSessionManager {
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error("LiveHost session graceMs must be non-negative and finite.");
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? default_schedule;
  const makeCredential = options.credential ?? random_credential;
  const sessions = new Map<LiveHostSessionId, SessionRecord>();
  const credentials = new Map<LiveHostSessionCredential, SessionRecord>();
  const rejected = new Map<LiveHostSessionRejectCode, number>();
  let totalReattachments = 0;
  let totalFencing = 0;
  let totalExpiry = 0;
  let disposed = false;

  function reject(code: LiveHostSessionRejectCode, message: string): LiveHostResult<never> {
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
  }

  function schedule_expiry(record: SessionRecord): void {
    record.stopExpiry?.();
    const disconnectedAt = now();
    record.disconnectedAt = disconnectedAt;
    record.expiresAt = disconnectedAt + graceMs;
    record.stopExpiry = schedule(graceMs, () => expire(record));
  }

  function create(
    sessionId: LiveHostSessionId,
    resumable: boolean,
    attachment: SessionAttachment,
    disposeResources: LiveHostDisposer,
    subscriptionCount: () => number,
  ): LiveHostResult<SessionSuccess> {
    if (disposed) return fail("LIVEHOST_SESSION_ALREADY_GONE", "LiveHost session manager is disposed.");
    if (sessions.has(sessionId)) return fail("LIVEHOST_SESSION_CREDENTIAL_UNKNOWN", `LiveHost session ID is already in use: ${sessionId}`);
    let credential: LiveHostSessionCredential | undefined;
    if (resumable) {
      credential = makeCredential();
      if (!valid_credential(credential)) throw new Error("LiveHost generated session credential is malformed.");
      if (credentials.has(credential)) throw new Error("LiveHost generated a duplicate session credential.");
    }
    const record: SessionRecord = {
      sessionId,
      ...(credential ? { credential } : {}),
      resumable,
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
    return ok({ sessionId, epoch: record.epoch, ...(credential ? { credential } : {}) });
  }

  function reattach(credential: unknown, attachment: SessionAttachment): LiveHostResult<SessionSuccess> {
    if (disposed) return reject("LIVEHOST_SESSION_ALREADY_GONE", "LiveHost session manager is disposed.");
    if (credential === undefined || credential === null || credential === "") {
      return reject("LIVEHOST_SESSION_CREDENTIAL_MISSING", "LiveHost session credential is missing.");
    }
    if (!valid_credential(credential)) {
      return reject("LIVEHOST_SESSION_CREDENTIAL_MALFORMED", "LiveHost session credential is malformed.");
    }
    const record = credentials.get(credential);
    if (!record) return reject("LIVEHOST_SESSION_CREDENTIAL_UNKNOWN", "LiveHost session credential is unknown.");
    if (record.state === "expired") return reject("LIVEHOST_SESSION_CREDENTIAL_EXPIRED", "LiveHost session credential has expired.");
    if (record.state === "revoked") return reject("LIVEHOST_SESSION_CREDENTIAL_REVOKED", "LiveHost session credential has been revoked.");

    const previous = record.attachment;
    const previousEpoch = record.epoch;
    if (previous) {
      previous.fence(record.sessionId, previousEpoch);
      record.fencingCount += 1;
      totalFencing += 1;
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
    return ok({ sessionId: record.sessionId, epoch: record.epoch });
  }

  function detach(sessionId: LiveHostSessionId, epoch: LiveHostConnectionEpoch): boolean {
    const record = sessions.get(sessionId);
    if (!record || record.state !== "attached" || record.epoch !== epoch) return false;
    record.attachment = undefined;
    record.state = "disconnected";
    if (record.resumable) schedule_expiry(record);
    else expire(record);
    return true;
  }

  function goodbye(sessionId: LiveHostSessionId, epoch: LiveHostConnectionEpoch): LiveHostResult<void> {
    const record = sessions.get(sessionId);
    if (!record || record.state === "expired" || record.state === "revoked") {
      return reject("LIVEHOST_SESSION_ALREADY_GONE", "LiveHost session is already gone.");
    }
    if (record.state !== "attached" || record.epoch !== epoch) {
      return reject("LIVEHOST_SESSION_ATTACHMENT_FENCED", "LiveHost session attachment is no longer authoritative.");
    }
    record.stopExpiry?.();
    record.stopExpiry = undefined;
    record.attachment = undefined;
    record.state = "revoked";
    record.disconnectedAt = undefined;
    record.expiresAt = undefined;
    dispose_resources(record);
    return ok(undefined);
  }

  function is_active(sessionId: LiveHostSessionId, epoch: LiveHostConnectionEpoch): boolean {
    const record = sessions.get(sessionId);
    return record?.state === "attached" && record.epoch === epoch && record.attachment !== undefined;
  }

  function diagnostic(record: SessionRecord): LiveHostSessionDiagnostic {
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

  function debug(): LiveHostSessionDiagnostics {
    const records = [...sessions.values()];
    const sessionDiagnostics = Object.freeze(records.map(diagnostic));
    const rejectedCredentialCounts: Partial<Record<LiveHostSessionRejectCode, number>> = {};
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
      if (record.state !== "expired") record.state = "revoked";
      record.disconnectedAt = undefined;
      record.expiresAt = undefined;
      dispose_resources(record);
    }
    credentials.clear();
  }

  return Object.freeze({ create, reattach, detach, goodbye, is_active, debug, dispose });
}
