import type { EchoDocumentAction } from "./echo.document-authority.js";

/** @internal Minimal registry shape shared with Reflect without loading recovery implementation. */
export type EchoDocumentAuthority = Readonly<{
  enqueue: (lower: () => EchoDocumentAction | undefined) => Promise<void>;
  dispose: () => void;
  pendingRevisionWaits: () => number;
}>;

const authorities = new WeakMap<object, EchoDocumentAuthority>();
const deferredAttachments = new WeakMap<EchoDocumentAuthority, (authority: EchoDocumentAuthority) => void>();

export function register_echo_document_authority(map: object, authority: EchoDocumentAuthority): void {
  const current = authorities.get(map);
  if (current !== undefined) deferredAttachments.get(current)?.(authority);
  authorities.set(map, authority);
}

export function unregister_echo_document_authority(map: object, authority: EchoDocumentAuthority): void {
  if (authorities.get(map) === authority) authorities.delete(map);
}

export function echo_document_authority_for(map: object): EchoDocumentAuthority | undefined {
  return authorities.get(map);
}

/** @internal Queue pre-load document application requests. */
export function create_deferred_echo_document_authority_internal(): Readonly<{
  authority: EchoDocumentAuthority;
  dispose: () => void;
}> {
  const pending: Array<Readonly<{
    lower: () => EchoDocumentAction | undefined;
    resolve: () => void;
    reject: (reason: unknown) => void;
  }>> = [];
  let attached: EchoDocumentAuthority | undefined;
  let disposed = false;
  const authority: EchoDocumentAuthority = Object.freeze({
    enqueue(lower): Promise<void> {
      if (disposed) return Promise.reject(new Error("Deferred Echo document authority is disposed."));
      if (attached !== undefined) return attached.enqueue(lower);
      return new Promise((resolve, reject) => pending.push(Object.freeze({ lower, resolve, reject })));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const reason = new Error("Deferred Echo document authority is disposed.");
      for (const request of pending.splice(0)) request.reject(reason);
    },
    pendingRevisionWaits: () => attached?.pendingRevisionWaits() ?? 0,
  });
  deferredAttachments.set(authority, (next) => {
    if (disposed || attached !== undefined) return;
    attached = next;
    for (const request of pending.splice(0)) next.enqueue(request.lower).then(request.resolve, request.reject);
  });
  return Object.freeze({
    authority,
    dispose: authority.dispose,
  });
}
