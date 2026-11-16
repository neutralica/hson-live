import type { HsonDataInput } from "../api/data/hson-data.js";
import type { LiveMapDocumentPathInput } from "./livemap.types.js";
import type { DocumentCallbackListener, DocumentLibraryCallbackListener } from "./native-listener.types.js";

/** Complete normalized portable semantics of one LiveTree listener registration. */
export type InteractionListener = Readonly<{
  event: string;
  target: "element" | "document" | "window";
  capture: boolean;
  once: boolean;
  passive: boolean;
  missingTarget: "ignore" | "warn" | "throw";
  preventDefault: boolean;
  stopPropagation: boolean;
  stopImmediatePropagation: boolean;
}>;

type InteractionDataInput = HsonDataInput;

/** Portable element coordinate or explicit Document Library ownership. */
export type InteractionSubject = Readonly<{
  library: string;
  path: LiveMapDocumentPathInput;
  kind?: never;
}> | Readonly<{
  library: string;
  kind: "document";
  path?: never;
}>;

export type BrowserInteractionDescriptor = Readonly<{
  id: string;
  subject: InteractionSubject;
  listener: InteractionListener;
  kind: "browser";
  key: string;
  args?: InteractionDataInput | undefined;
  /** Portable authored argument plan. @internal */
  eventArgs?: InteractionDataInput | undefined;
}>;

export type LocusInteractionDescriptor = Readonly<{
  id: string;
  subject: InteractionSubject;
  listener: InteractionListener;
  kind: "locus";
  key: string;
  payload?: InteractionDataInput | undefined;
  /** Portable authored argument plan. @internal */
  eventArgs?: InteractionDataInput | undefined;
}>;

export type InteractionDescriptor = BrowserInteractionDescriptor | LocusInteractionDescriptor;

/** Author canonical Events or click conveniences with receiver-specific acceptance. */
export type DocumentListener<TResult> = Readonly<{
  event: (source: string) => TResult;
  local: Readonly<{ onClick: (key: string, input?: HsonDataInput) => TResult }>;
  host: Readonly<{ onClick: (key: string, input?: HsonDataInput) => TResult }>;
}>;

export type DocumentElementListener<TResult> = DocumentListener<TResult> & DocumentCallbackListener;

export type DocumentLibraryListener<TResult> = DocumentListener<TResult> & DocumentLibraryCallbackListener;
