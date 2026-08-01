// parse-hson.ts


import { assert_invariants } from "../../../core/assert-invariants.js";
import { HsonNode } from "../../../core/types.js";
import { parse_tokens, type ParseTokensOptions } from "./parse-tokens.js";
import { tokenize_hson } from "./tokenize-hson.js";
import { scan_ingested_hson_node_quids } from "../utils/hson-utils/quid-ingress.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";


/**
 * Parse a HSON source string into a validated `HsonNode` tree.
 *
 * Pipeline:
 * 1. Tokenize the input via `tokenize_hson`.
 * 2. Build a node tree from the tokens via `parse_tokens`.
 * 3. Validate canonical QUID placement, values, and graph-wide uniqueness.
 * 4. Run `assert_invariants` to ensure the resulting tree satisfies all
 *    structural invariants for HSON.
 *
 * If invariants fail, a transform error is thrown.
 *
 * @param str - Raw HSON source text.
 * @returns A fully-parsed and validated `HsonNode` root.
 * @see tokenize_hson
 * @see parse_tokens
 * @see assert_invariants
 */
export function parse_hson(str: string, options: ParseTokensOptions = {}): HsonNode {
    const newTokens = tokenize_hson(str);
    if (newTokens.length === 0) {
        _throw_transform_err(
            "empty, whitespace-only, or comment-only HSON source has no semantic value",
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
    const newNode = parse_tokens(newTokens, options)
    scan_ingested_hson_node_quids(newNode, "parse_hson");
    assert_invariants(newNode, 'parse hson');
    return newNode;
}
