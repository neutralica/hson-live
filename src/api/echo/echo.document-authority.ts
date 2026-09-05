import type { JsonValue } from "../../core/types.js";
import type {
  LiveMapDocumentAttributeValue,
  LiveMapDocumentAttrs,
  LiveMapDocumentContent,
  LiveMapDocumentRequestTarget,
} from "../../types/livemap.types.js";

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

export type EchoDocumentAuthority = Readonly<{
  enqueue: (lower: () => EchoDocumentAction | undefined) => void;
  dispose: () => void;
  /** @internal Deterministic lifecycle proof seam. */
  pendingRevisionWaits: () => number;
  rejectIdentityDemand: true;
}>;

export function make_echo_document_authority(
  dispatch: (action: EchoDocumentAction) => Promise<Readonly<{ accepted: boolean; completionRev?: number }>>,
  revision: () => number,
  observe: (listener: () => void) => () => void,
  replicaReady: () => boolean = () => true,
  onReplicaDispose?: (listener: (reason: Error) => void) => () => void,
  waitUntilReplicaReady?: () => Promise<void>,
): EchoDocumentAuthority {
  let tail = Promise.resolve();
  let disposed = false;
  const revisionWaits = new Set<Readonly<{ off: () => void; reject: (reason: Error) => void }>>();

  const terminalError = (): Error => new Error("Echo document authority is disposed.");

  const cancel_revision_waits = (reason: Error): void => {
    for (const waiter of [...revisionWaits]) {
      revisionWaits.delete(waiter);
      waiter.off();
      waiter.reject(reason);
    }
  };

  const stopReplicaDispose = onReplicaDispose?.((reason) => {
    disposed = true;
    cancel_revision_waits(reason);
  });

  const wait_for_revision = (target: number): Promise<void> => {
    if (disposed) return Promise.reject(terminalError());
    if (revision() >= target) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let off = (): void => {};
      const waiter = Object.freeze({ off: () => off(), reject });
      revisionWaits.add(waiter);
      off = observe(() => {
        if (revision() < target) return;
        if (!revisionWaits.delete(waiter)) return;
        waiter.off();
        resolve();
      });
      if (revision() >= target && revisionWaits.delete(waiter)) {
        waiter.off();
        resolve();
      }
    });
  };

  return Object.freeze({
    enqueue(lower): void {
      tail = tail.then(async () => {
        if (disposed) throw terminalError();
        if (!replicaReady()) {
          if (waitUntilReplicaReady === undefined) throw new Error("Echo document authority requires an exact replica.");
          await waitUntilReplicaReady();
        }
        if (disposed || !replicaReady()) throw new Error("Echo document authority requires an exact replica.");
        const action = lower();
        if (action === undefined) return;
        const result = await dispatch(action);
        if (!result.accepted) return;
        if (result.completionRev !== undefined) await wait_for_revision(result.completionRev);
      }).catch(() => {
        // Rejection settles this request only. Reflect remains healthy because
        // no accepted canonical evidence failed to project.
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopReplicaDispose?.();
      cancel_revision_waits(terminalError());
    },
    pendingRevisionWaits: () => revisionWaits.size,
    rejectIdentityDemand: true,
  });
}

const AUTHORITIES = new WeakMap<object, EchoDocumentAuthority>();

export function register_echo_document_authority(map: object, authority: EchoDocumentAuthority): void {
  AUTHORITIES.set(map, authority);
}

export function unregister_echo_document_authority(map: object, authority: EchoDocumentAuthority): void {
  if (AUTHORITIES.get(map) === authority) AUTHORITIES.delete(map);
}

export function echo_document_authority_for(map: object): EchoDocumentAuthority | undefined {
  return AUTHORITIES.get(map);
}

export function document_action_payload_with_library(
  action: EchoDocumentAction,
  library: string,
): JsonValue {
  return Object.freeze({ library, ...action.payload }) as JsonValue;
}
