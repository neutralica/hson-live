import type { HsonDataInput } from "../api/data/hson-data.js";
import type { LiveMapDocumentPathInput } from "./livemap.types.js";
import type { DocumentCallbackListener } from "./native-listener.types.js";

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

/** Portable coordinate of a document subject in the authority registry. */
export type InteractionSubject = Readonly<{
  library: string;
  path: LiveMapDocumentPathInput;
}>;

export type BrowserInteractionDescriptor = Readonly<{
  id: string;
  subject: InteractionSubject;
  listener: InteractionListener;
  kind: "browser";
  key: string;
  args: InteractionDataInput;
}>;

export type LocusInteractionDescriptor = Readonly<{
  id: string;
  subject: InteractionSubject;
  listener: InteractionListener;
  kind: "locus";
  key: string;
  payload: InteractionDataInput;
}>;

export type InteractionDescriptor = BrowserInteractionDescriptor | LocusInteractionDescriptor;

/** Author one canonical click relationship and return its accepted Descriptor ID. */
export type DocumentListener<TResult> = Readonly<{
  local: Readonly<{ onClick: (key: string, input: HsonDataInput) => TResult }>;
  host: Readonly<{ onClick: (key: string, input: HsonDataInput) => TResult }>;
}>;

export type DocumentElementListener<TResult> = DocumentListener<TResult> & DocumentCallbackListener;
