import type { InternalLiveMapAggregateAuthority } from "../api/livemap/livemap.internal.js";
import type { LiveMapSystemIdentity } from "../api/livemap/livemap.system.js";
import type { OrderedProjectedValue } from "../core/ordered-projected-value.js";

export const INTERACTION_RESERVED_LIBRARY_KEY = "@hson/canonical-interactions";
export const INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME = INTERACTION_RESERVED_LIBRARY_KEY;

type InteractionDraftCapability = Readonly<{
  system: LiveMapSystemIdentity;
  update: (edit: (current: OrderedProjectedValue) => OrderedProjectedValue) => void;
}>;

const DRAFTS = new WeakMap<object, InteractionDraftCapability>();
/** Every constructed LiveMap owns this binding, including featureless Echo clients. */
export function require_interaction_system_internal(aggregate: InternalLiveMapAggregateAuthority): LiveMapSystemIdentity {
  const identity = aggregate.systemState(INTERACTION_RESERVED_LIBRARY_KEY);
  if (identity === undefined) throw new Error("LiveMap lacks the required canonical interaction binding.");
  return identity;
}

export function register_interaction_draft_internal(
  draft: object,
  system: LiveMapSystemIdentity,
  update: (edit: (current: OrderedProjectedValue) => OrderedProjectedValue) => void,
): void {
  DRAFTS.set(draft, Object.freeze({ system, update }));
}

export function interaction_draft_capability_internal(
  draft: object,
): InteractionDraftCapability | undefined {
  return DRAFTS.get(draft);
}
