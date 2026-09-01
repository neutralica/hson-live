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
  rejectIdentityDemand: true;
}>;

export function make_echo_document_authority(
  dispatch: (action: EchoDocumentAction) => Promise<Readonly<{ accepted: boolean; completionRev?: number }>>,
  revision: () => number,
  observe: (listener: () => void) => () => void,
): EchoDocumentAuthority {
  let tail = Promise.resolve();

  const wait_for_revision = (target: number): Promise<void> => {
    if (revision() >= target) return Promise.resolve();
    return new Promise((resolve) => {
      const off = observe(() => {
        if (revision() < target) return;
        off();
        resolve();
      });
    });
  };

  return Object.freeze({
    enqueue(lower): void {
      tail = tail.then(async () => {
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
