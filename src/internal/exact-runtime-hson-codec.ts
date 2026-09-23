/**
 * Identity-bearing Hson compatibility codec for exact authority history and
 * persistence until Phase 5. Current client replication projects QUID-free
 * content before crossing the Locus/Echo boundary. Ordinary Transform never
 * admits generated runtime identity from this format.
 * @internal
 */
export {
  serialize_hson_exact_runtime,
  serialize_hson_owned_document_content_exact_runtime,
} from "../api/transform/serializers/serialize-hson.js";
export { parse_hson_exact_runtime } from "../api/transform/parsers/parse-hson.js";
