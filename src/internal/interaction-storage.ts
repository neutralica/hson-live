import type { LiveMapSystemIdentity } from "../api/livemap/livemap.system.js";
import type { OrderedProjectedValue } from "../core/ordered-projected-value.js";

export const INTERACTION_RESERVED_LIBRARY_KEY = "@hson/canonical-interactions/v1";
export const INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME = INTERACTION_RESERVED_LIBRARY_KEY;

type InteractionDraftCapability = Readonly<{
  system: LiveMapSystemIdentity;
  read: () => OrderedProjectedValue;
  replace: (value: OrderedProjectedValue) => void;
}>;

const DRAFTS = new WeakMap<object, InteractionDraftCapability>();

export function register_interaction_draft_internal(
  draft: object,
  system: LiveMapSystemIdentity,
  read: () => OrderedProjectedValue,
  replace: (value: OrderedProjectedValue) => void,
): void {
  DRAFTS.set(draft, Object.freeze({ system, read, replace }));
}

export function interaction_draft_capability_internal(
  draft: object,
): InteractionDraftCapability | undefined {
  return DRAFTS.get(draft);
}
