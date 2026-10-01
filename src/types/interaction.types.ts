import type { HsonData } from "../api/transform/transform.types.js";
import type { LiveMap } from "./livemap.types.js";
import type { LiveTree } from "../api/livetree/livetree.js";
import type { InteractionDescriptor } from "./interaction.descriptor.types.js";
export type {
  InteractionListener,
  InteractionSubject,
  BrowserInteractionDescriptor,
  LocusInteractionDescriptor,
  InteractionDescriptor,
} from "./interaction.descriptor.types.js";

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
    | "browser-capability-resolution"
    | "locus-capability-resolution"
    | "listener-installation"
    | "browser-invocation"
    | "locus-invocation";
  cause: unknown;
}>;

export type InteractionActivationOptions = Readonly<{
  map: LiveMap;
  tree: LiveTree;
  /** Name of the selected document Library; inferred only for a single document Library. */
  document?: string;
  local: InteractionLocalBehaviors;
  dispatch?: InteractionActionDispatcher;
  onFailure?: (failure: InteractionFailure) => void;
}>;
