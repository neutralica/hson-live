import type { LiveMapLibraryIdentity } from "../api/livemap/livemap.library.js";
import type { OrderedProjectedValue } from "../core/ordered-projected-value.js";

export const INTERACTION_RESERVED_LIBRARY_KEY = "@hson/canonical-interactions/v1";
export const INTERACTION_RESERVED_LIBRARY_TRANSPORT_NAME = INTERACTION_RESERVED_LIBRARY_KEY;

type InteractionDraftCapability = Readonly<{
  library: LiveMapLibraryIdentity;
  read: () => OrderedProjectedValue;
  replace: (value: OrderedProjectedValue) => void;
}>;

const DRAFTS = new WeakMap<object, InteractionDraftCapability>();

export function register_interaction_draft_internal(
  draft: object,
  library: LiveMapLibraryIdentity,
  read: () => OrderedProjectedValue,
  replace: (value: OrderedProjectedValue) => void,
): void {
  DRAFTS.set(draft, Object.freeze({ library, read, replace }));
}

export function interaction_draft_capability_internal(
  draft: object,
): InteractionDraftCapability | undefined {
  return DRAFTS.get(draft);
}
