import type { HsonNode } from "../../core/types.js";
import type { OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import type { HsonSchema } from "../transform/transform.types.js";

/** Opaque identity for one Hson-owned transactional state domain. @internal */
export type LiveMapSystemIdentity = object;

/** Canonical state outside the fixed application Library registry. @internal */
export type LiveMapSystemState = {
  readonly identity: LiveMapSystemIdentity;
  readonly key: string;
  readonly transportName: string;
  root: HsonNode;
  projectedValue: OrderedProjectedValue;
  readonly hsonSchema: HsonSchema;
};

/** Allocate the stable identity used by the authority's interaction-state slot. @internal */
export function make_livemap_system_identity(): LiveMapSystemIdentity {
  return Object.freeze(Object.create(null));
}
