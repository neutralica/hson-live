import type { JsonObj, JsonValue } from "../core/types.js";
import type { HsonData } from "../api/transform/transform.types.js";
import type { LiveMapDocumentPathInput, LiveMapLibraries } from "./livemap.types.js";
import type { LiveTree } from "../api/livetree/livetree.js";
import type { MissingPolicy } from "./listen.types.js";

/** Complete normalized portable semantics of one LiveTree listener registration. */
export type InteractionListener = Readonly<{
  event: string;
  target: "element" | "document" | "window";
  capture: boolean;
  once: boolean;
  passive: boolean;
  missingTarget: MissingPolicy;
  preventDefault: boolean;
  stopPropagation: boolean;
  stopImmediatePropagation: boolean;
}>;

type InteractionDataInput = HsonData | number | boolean | null | JsonObj | JsonValue[];

/** Portable coordinate of a document subject in the fixed application registry. */
export type InteractionSubject = Readonly<{
  library: string;
  path: LiveMapDocumentPathInput;
}>;

export type LocalInteractionDescriptor = Readonly<{
  id: string;
  subject: InteractionSubject;
  listener: InteractionListener;
  kind: "browser-local";
  key: string;
  args: InteractionDataInput;
}>;

export type AuthoritativeInteractionDescriptor = Readonly<{
  id: string;
  subject: InteractionSubject;
  listener: InteractionListener;
  kind: "locus-authoritative";
  key: string;
  payload: InteractionDataInput;
}>;

export type InteractionDescriptor =
  | LocalInteractionDescriptor
  | AuthoritativeInteractionDescriptor;

export type InteractionLocalBehavior = (
  event: Event,
  subject: LiveTree,
  args: HsonData,
) => void | Promise<void>;

export type InteractionLocalBehaviors = Readonly<Record<string, InteractionLocalBehavior>>;

export type InteractionActionDispatcher = (
  actionKey: string,
  payload: HsonData,
) => Promise<void>;

export type InteractionFailure = Readonly<{
  descriptor: InteractionDescriptor;
  phase:
    | "subject-resolution"
    | "local-capability-resolution"
    | "authoritative-capability-resolution"
    | "listener-installation"
    | "local-invocation"
    | "authoritative-invocation";
  cause: unknown;
}>;

export type InteractionActivationOptions = Readonly<{
  map: LiveMapLibraries;
  tree: LiveTree;
  /** Name of the selected document Library; inferred only for a single document Library. */
  document?: string;
  local: InteractionLocalBehaviors;
  dispatch?: InteractionActionDispatcher;
  onFailure?: (failure: InteractionFailure) => void;
}>;
