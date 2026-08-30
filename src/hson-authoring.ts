import { admit_hson } from "./api/transform/hson-admission.js";
import { validate_canonical_hson } from "./internal/schema-hson-validation/validate-canonical-hson.js";

/** Author canonical Hson and certify it against an actual Schema.
 * Certification returns the unchanged string with Schema-bound type evidence.
 * This entrypoint intentionally has no dependency on the aggregate facade.
 */
export const Hson = Object.freeze(Object.assign(admit_hson, {
  certify: validate_canonical_hson,
}));

export type { HsonCanonical, HsonSchema } from "./api/transform/transform.types.js";
export { TransformError, is_transform_error, read_transform_error_details } from "./core/errors.js";
export type { TransformErrorDetails, TransformErrorRelated, TransformErrorSource } from "./core/errors.js";
