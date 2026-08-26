import type { ParseTokensOptions } from "../../api/transform/parsers/parse-tokens.js";
import { parse_hson_attached } from "../../api/transform/parsers/parse-hson.js";
import { detach_hson_root_value } from "../../api/transform/utils/node-utils/detach-hson-root-value.js";
import {
  HsonSourceProvenanceBuilder,
  type ParsedHsonWithProvenance,
} from "./hson-source-provenance.js";

/** Parse valid authored HSON and bind a private source sidecar to its exact detached value. */
export function parse_hson_with_provenance(
  source: string,
  options: ParseTokensOptions = {},
): ParsedHsonWithProvenance {
  const builder = new HsonSourceProvenanceBuilder();
  const attached = parse_hson_attached(source, options, builder);
  const value = detach_hson_root_value(attached);
  return Object.freeze({
    value,
    provenance: builder.finalize(value, source.length),
  });
}
