// parse-hson.ts


import { assert_invariants } from "../../../core/assert-invariants.js";
import { HsonNode } from "../../../core/types.js";
import { parse_tokens, type ParseTokensOptions } from "./parse-tokens.js";
import { tokenize_hson } from "./tokenize-hson.js";
import { scan_ingested_hson_node_quids } from "../utils/hson-utils/quid-ingress.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";
import type { HsonSourceProvenanceBuilder } from "../../../internal/hson-source-provenance/hson-source-provenance.js";


/**
 * Parse a Hson source string into a validated `HsonNode` tree.
 *
 * Pipeline:
 * 1. Tokenize the input via `tokenize_hson`.
 * 2. Build a node tree from the tokens via `parse_tokens`.
 * 3. Validate canonical QUID placement, values, and graph-wide uniqueness.
 * 4. Run `assert_invariants` to ensure the resulting tree satisfies all
 *    structural invariants for Hson.
 *
 * If invariants fail, a transform error is thrown.
 *
 * @param str - Raw Hson source text.
 * @returns A fully-parsed and validated `HsonNode` root.
 * @see tokenize_hson
 * @see parse_tokens
 * @see assert_invariants
 */
export function parse_hson(str: string, options: ParseTokensOptions = {}): HsonNode {
    return parse_hson_attached(str, options);
}

/** Shared private pipeline used by authored parsing and provenance capture. */
export function parse_hson_attached(
    str: string,
    options: ParseTokensOptions = {},
    provenance?: HsonSourceProvenanceBuilder,
): HsonNode {
    const newTokens = tokenize_hson(str, 0, provenance);
    if (newTokens.length === 0) {
        _throw_transform_err(
            "empty, whitespace-only, or comment-only Hson source has no semantic value",
            "parse_hson",
            undefined,
            undefined,
            {
                code: "HSON_SOURCE_EMPTY",
                stage: "source-admission",
                source: { index: 0, line: 1, column: 1 },
            },
        );
    }
    const newNode = parse_tokens(newTokens, options, provenance)
    scan_ingested_hson_node_quids(newNode, "parse_hson");
    assert_invariants(newNode, 'parse hson');
    return newNode;
}
