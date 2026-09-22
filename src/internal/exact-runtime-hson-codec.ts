/**
 * Temporary identity-bearing Hson compatibility codec for hosted recovery.
 * Ordinary Transform never uses this path; same-runtime capture keeps graphs
 * and provenance directly. Remove this with the hosted identity migration.
 * @internal
 */
export {
  serialize_hson_exact_runtime,
  serialize_hson_owned_document_content_exact_runtime,
} from "../api/transform/serializers/serialize-hson.js";
export { parse_hson_exact_runtime } from "../api/transform/parsers/parse-hson.js";
