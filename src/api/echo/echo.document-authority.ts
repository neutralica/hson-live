import type { JsonValue } from "../../core/types.js";
import type {
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentContent,
  LiveMapDocumentRequestTarget,
} from "../../types/livemap.types.js";
import type { EchoDocumentAuthority } from "./echo.document-authority-registry.js";
export {
  echo_document_authority_for,
  register_echo_document_authority,
  unregister_echo_document_authority,
} from "./echo.document-authority-registry.js";
export type { EchoDocumentAuthority } from "./echo.document-authority-registry.js";

export type EchoDocumentAction =
  | Readonly<{ name: "document.attrs.set"; payload: { target: LiveMapDocumentRequestTarget; name: string; value: LiveMapDocumentAttributeValue } }>
  | Readonly<{ name: "document.attrs.drop"; payload: { target: LiveMapDocumentRequestTarget; name: string } }>
  | Readonly<{ name: "document.attrs.setMany"; payload: { target: LiveMapDocumentRequestTarget; values: LiveMapDocumentAttrs } }>
  | Readonly<{ name: "document.attrs.dropMany"; payload: { target: LiveMapDocumentRequestTarget; names: readonly string[] } }>
  | Readonly<{ name: "document.attrs.clear"; payload: { target: LiveMapDocumentRequestTarget } }>
  | Readonly<{ name: "document.attrs.replace"; payload: { target: LiveMapDocumentRequestTarget; values: LiveMapDocumentAttrs } }>
  | Readonly<{ name: "document.content.replace"; payload: { target: LiveMapDocumentRequestTarget; index: number; replacement: LiveMapDocumentContent } }>
  | Readonly<{ name: "document.content.insert"; payload: { target: LiveMapDocumentRequestTarget; index: number; content: LiveMapDocumentContent } }>
  | Readonly<{ name: "document.content.remove"; payload: { target: LiveMapDocumentRequestTarget; index: number } }>
  | Readonly<{ name: "document.content.move"; payload: { target: LiveMapDocumentRequestTarget; from: number; to: number } }>;

type EchoDocumentStreamIdentity = Readonly<{
  logicalMapId: string;
  incarnationId: string;
}>;

type EchoDocumentDispatchResult = Readonly<{
  accepted: boolean;
  completionRev?: number;
  error?: Readonly<{ code?: string; message: string }>;
}>;

function valid_revision(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

export function make_echo_document_authority(
  dispatch: (action: EchoDocumentAction, identity: EchoDocumentStreamIdentity) => Promise<EchoDocumentDispatchResult>,
  revision: () => number,
  observe: (listener: () => void) => () => void,
  replicaReady: () => boolean = () => true,
  onReplicaDispose?: (listener: (reason: Error) => void) => () => void,
  waitUntilReplicaReady?: () => Promise<void>,
  streamIdentity?: () => Readonly<{ logicalMapId: string; incarnationId: string | undefined }>,
  onReplicaStateChange?: (listener: () => void) => () => void,
  replicaFailure?: () => unknown,
): EchoDocumentAuthority {
  let tail = Promise.resolve();
  let disposed = false;
  const revisionWaits = new Set<Readonly<{
    identity: EchoDocumentStreamIdentity;
    off: () => void;
    reject: (reason: Error) => void;
  }>>();
  const readinessWaits = new Set<(reason: Error) => void>();

  const terminalError = (): Error => new Error("Echo document authority is disposed.");

  const replica_failure_error = (): Error | undefined => {
    const failure = replicaFailure?.();
    if (failure === undefined) return undefined;
    if (failure instanceof Error) return failure;
    const message = typeof failure === "object" && failure !== null && typeof Reflect.get(failure, "message") === "string"
      ? String(Reflect.get(failure, "message"))
      : "Echo document replica recovery failed.";
    const error = new Error(message, { cause: failure });
    const code = typeof failure === "object" && failure !== null ? Reflect.get(failure, "code") : undefined;
    if (typeof code === "string") Object.defineProperty(error, "code", { value: code, enumerable: true });
    return error;
  };

  const cancel_revision_waits = (reason: Error): void => {
    for (const waiter of [...revisionWaits]) {
      revisionWaits.delete(waiter);
      waiter.off();
      waiter.reject(reason);
    }
  };

  const stopReplicaDispose = onReplicaDispose?.((reason) => {
    disposed = true;
    for (const reject of [...readinessWaits]) reject(reason);
    cancel_revision_waits(reason);
  });

  const stopReplicaStateChange = onReplicaStateChange?.(() => {
    const failure = replica_failure_error();
    if (failure !== undefined) {
      for (const reject of [...readinessWaits]) reject(failure);
    }
    for (const waiter of [...revisionWaits]) {
      if (failure === undefined && identity_matches(waiter.identity)) continue;
      if (!revisionWaits.delete(waiter)) continue;
      waiter.off();
      waiter.reject(failure ?? new Error("Echo document authority stream identity became incompatible."));
    }
  });

  const wait_for_replica_ready = (): Promise<void> => {
    const failure = replica_failure_error();
    if (failure !== undefined) return Promise.reject(failure);
    if (waitUntilReplicaReady === undefined) return Promise.reject(new Error("Echo document authority requires an exact replica."));
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (reason: Error): void => {
        if (settled) return;
        settled = true;
        readinessWaits.delete(fail);
        reject(reason);
      };
      readinessWaits.add(fail);
      waitUntilReplicaReady().then(() => {
        if (settled) return;
        settled = true;
        readinessWaits.delete(fail);
        resolve();
      }, fail);
    });
  };

  const exact_identity = (): EchoDocumentStreamIdentity => {
    const identity = streamIdentity?.();
    if (identity === undefined || identity.incarnationId === undefined) {
      throw new Error("Echo document authority requires exact logical-map and incarnation identity.");
    }
    return Object.freeze({ logicalMapId: identity.logicalMapId, incarnationId: identity.incarnationId });
  };

  const identity_matches = (expected: EchoDocumentStreamIdentity): boolean => {
    const current = streamIdentity?.();
    return current?.logicalMapId === expected.logicalMapId
      && current.incarnationId === expected.incarnationId;
  };

  const wait_for_revision = (target: number, identity: EchoDocumentStreamIdentity): Promise<void> => {
    if (disposed) return Promise.reject(terminalError());
    if (!identity_matches(identity)) return Promise.reject(new Error("Echo document authority stream identity became incompatible."));
    if (revision() >= target) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let off = (): void => {};
      const waiter = Object.freeze({ identity, off: () => off(), reject });
      revisionWaits.add(waiter);
      off = observe(() => {
        if (!identity_matches(identity)) {
          if (!revisionWaits.delete(waiter)) return;
          waiter.off();
          reject(new Error("Echo document authority stream identity became incompatible."));
          return;
        }
        if (revision() < target) return;
        if (!revisionWaits.delete(waiter)) return;
        waiter.off();
        resolve();
      });
      if (!identity_matches(identity) && revisionWaits.delete(waiter)) {
        waiter.off();
        reject(new Error("Echo document authority stream identity became incompatible."));
      } else if (revision() >= target && revisionWaits.delete(waiter)) {
        waiter.off();
        resolve();
      }
    });
  };

  return Object.freeze({
    enqueue(lower): Promise<void> {
      const operation = tail.then(async () => {
        if (disposed) throw terminalError();
        if (!replicaReady()) {
          await wait_for_replica_ready();
        }
        if (disposed || !replicaReady()) throw new Error("Echo document authority requires an exact replica.");
        const identity = exact_identity();
        const action = lower();
        if (action === undefined) return;
        const result = await dispatch(action, identity);
        if (!result.accepted) {
          const denial = new Error(result.error?.message ?? "Locus denied the document operation.");
          denial.name = "EchoDocumentAuthorityDenial";
          if (result.error?.code !== undefined) Object.defineProperty(denial, "code", { value: result.error.code, enumerable: true });
          if (result.error !== undefined) Object.defineProperty(denial, "cause", { value: result.error });
          throw denial;
        }
        const completionRev = result.completionRev;
        if (!valid_revision(completionRev)) {
          throw new Error("Accepted Echo document operation requires a valid completionRev.");
        }
        if (!identity_matches(identity)) throw new Error("Echo document authority stream identity became incompatible.");
        await wait_for_revision(completionRev, identity);
        if (!identity_matches(identity)) throw new Error("Echo document authority stream identity became incompatible.");
      });
      tail = operation.catch(() => {
        // Keep serialization failure-isolated while returning the actual
        // terminal outcome to the initiating async author.
      });
      return operation;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopReplicaDispose?.();
      stopReplicaStateChange?.();
      const reason = terminalError();
      for (const reject of [...readinessWaits]) reject(reason);
      cancel_revision_waits(reason);
    },
    pendingRevisionWaits: () => revisionWaits.size,
  });
}

export function document_action_payload_with_library(
  action: EchoDocumentAction,
  library: string,
): JsonValue {
  const target = Object.freeze({
    kind: "path" as const,
    path: [...action.payload.target.path],
  });
  return Object.freeze({ library, ...action.payload, target }) as JsonValue;
}
