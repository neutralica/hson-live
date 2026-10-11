import type { HsonNode } from "../../../core/types.js";
import type { Tokens } from "../token.types.js";
import type { HsonSourceProvenanceBuilder } from "../../../internal/hson-source-provenance/hson-source-provenance.js";
import { assemble_hson_tokens, type ParseTokensOptions } from "./assemble-hson-tokens.js";
import { split_attrs_meta } from "../utils/hson-utils/split-attrs-meta.js";

export { make_leaf, type ParseTokensOptions } from "./assemble-hson-tokens.js";

/** General/document token receiver, including strict inline CSS attribute decoding. */
export function parse_tokens(
    tokens: Tokens[],
    options: ParseTokensOptions = {},
    provenance?: HsonSourceProvenanceBuilder,
): HsonNode {
    return assemble_hson_tokens(tokens, split_attrs_meta, options, provenance);
}
