import type { JsonValue } from "../core/types.js";
import type { HsonData } from "../api/data/hson-data.js";
import type { LiveMapLibraries } from "./livemap.types.js";
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

type InteractionDataInput = HsonData | JsonValue;

export type LocalInteractionDescriptor = Readonly<{
  id: string;
  subjectQuid: string;
  listener: InteractionListener;
  kind: "browser-local";
  key: string;
  args: InteractionDataInput;
}>;

export type AuthoritativeInteractionDescriptor = Readonly<{
  id: string;
  subjectQuid: string;
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
  local: InteractionLocalBehaviors;
  dispatch?: InteractionActionDispatcher;
  onFailure?: (failure: InteractionFailure) => void;
}>;
