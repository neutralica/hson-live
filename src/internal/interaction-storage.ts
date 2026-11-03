import type { LiveMapSystemIdentity } from "../api/livemap/livemap.system.js";
import type { OrderedProjectedValue } from "../core/ordered-projected-value.js";

export const INTERACTION_RESERVED_LIBRARY_KEY = "@hson/canonical-interactions";
export const INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME = INTERACTION_RESERVED_LIBRARY_KEY;

type InteractionDraftCapability = Readonly<{
  system: LiveMapSystemIdentity;
  read: () => OrderedProjectedValue;
  replace: (value: OrderedProjectedValue) => void;
}>;

const DRAFTS = new WeakMap<object, InteractionDraftCapability>();
const DISABLED_DRAFTS = new WeakMap<object, () => void>();

export function interaction_storage_not_enabled_internal(): never {
  throw new Error("Canonical interaction storage is not enabled. Enable it during initial LiveMap/Locus configuration before interaction mutation: call enable_interactions(map) before the first transition, or pass interactions: [] when creating or resuming Locus.");
}

/** Remember authentic writers whose owner has no interaction storage. */
export function register_disabled_interaction_draft_internal(draft: object, assertOpen: () => void): void {
  DISABLED_DRAFTS.set(draft, assertOpen);
}

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
  const assertOpen = DISABLED_DRAFTS.get(draft);
  if (assertOpen !== undefined) {
    assertOpen();
    interaction_storage_not_enabled_internal();
  }
  return DRAFTS.get(draft);
}
