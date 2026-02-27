
import { assert_invariants } from "../../diagnostics/assert-invariants.test.js";
import { HsonNode } from "../../types/node.types.js";
import { parse_tokens } from "./parse-tokens.js";
import { tokenize_hson } from "./tokenize-hson.js";


/**
 * Parse a HSON source string into a validated `HsonNode` tree.
 *
 * Pipeline:
 * 1. Tokenize the input via `tokenize_hson`.
 * 2. Build a node tree from the tokens via `parse_tokens`.
 * 3. Run `assert_invariants` to ensure the resulting tree satisfies all
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
export function parse_hson(str: string): HsonNode {
    const newTokens = tokenize_hson(str);
    const newNode = parse_tokens(newTokens)
    assert_invariants(newNode, 'parse hson');
    return newNode;
}