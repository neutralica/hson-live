import type { EchoDocumentAction } from "./echo.document-authority.js";

/** @internal Minimal registry shape shared with Reflect without loading recovery implementation. */
export type EchoDocumentAuthority = Readonly<{
  enqueue: (lower: () => EchoDocumentAction | undefined) => void;
  dispose: () => void;
  pendingRevisionWaits: () => number;
  rejectIdentityDemand: true;
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

/** @internal Queue pre-load document requests and reject non-authoritative identity minting. */
export function create_deferred_echo_document_authority_internal(): Readonly<{
  authority: EchoDocumentAuthority;
  dispose: () => void;
}> {
  const pending: Array<() => EchoDocumentAction | undefined> = [];
  let attached: EchoDocumentAuthority | undefined;
  let disposed = false;
  const authority: EchoDocumentAuthority = Object.freeze({
    enqueue(lower): void {
      if (disposed) return;
      if (attached !== undefined) attached.enqueue(lower);
      else pending.push(lower);
    },
    dispose(): void {
      disposed = true;
      pending.length = 0;
    },
    pendingRevisionWaits: () => attached?.pendingRevisionWaits() ?? 0,
    rejectIdentityDemand: true,
  });
  deferredAttachments.set(authority, (next) => {
    if (disposed || attached !== undefined) return;
    attached = next;
    for (const lower of pending.splice(0)) next.enqueue(lower);
  });
  return Object.freeze({
    authority,
    dispose: authority.dispose,
  });
}
