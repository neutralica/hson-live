import { admit_hson } from "./api/transform/hson-admission.js";
import { validate_canonical_hson } from "./internal/schema-hson-validation/validate-canonical-hson.js";

/** Author canonical HSON and validate it against an actual Schema.
 * Validation returns the unchanged string; it does not certify future use.
 * This entrypoint intentionally has no dependency on the aggregate facade.
 */
export const HSON = Object.freeze(Object.assign(admit_hson, {
  validate: validate_canonical_hson,
}));

export type { HsonCanonical } from "./api/transform/transform.types.js";
export { TransformError, is_transform_error, read_transform_error_details } from "./core/errors.js";
export type { TransformErrorDetails, TransformErrorRelated, TransformErrorSource } from "./core/errors.js";
