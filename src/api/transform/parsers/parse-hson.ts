// parse-hson.ts


import { assert_invariants } from "../../../core/assert-invariants.js";
import { ROOT_TAG } from "../../../core/constants.js";
import { CREATE_NODE } from "../../../core/factories.js";
import { HsonNode } from "../../../core/types.js";
import { parse_tokens, type ParseTokensOptions } from "./parse-tokens.js";
import { tokenize_hson } from "./tokenize-hson.js";
import type { Tokens } from "../token.types.js";
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

/** @internal Temporary exact-runtime Hson ingress for hosted recovery only. */
export function parse_hson_exact_runtime(str: string, options: ParseTokensOptions = {}): HsonNode {
    return parse_hson_attached_internal(str, options, undefined, true);
}

/** Private tagged-template path: slot content is resolved before validation. */
export function parse_hson_interpolated_template(
    source: string,
    mode: "document" | "data",
    values: readonly (readonly HsonNode[])[],
    tokens: Tokens[],
): HsonNode {
    if (tokens.length === 0) {
        _throw_transform_err("interpolated template has no semantic value", "parse_hson",
            undefined, undefined, { code: "HSON_SOURCE_EMPTY", stage: "source-admission" });
    }
    reject_portable_quid_tokens(tokens);
    const root = parse_tokens(tokens, {
        allowTopLevelDocumentText: mode === "document",
        interpolation: { mode, values },
    });
    scan_ingested_hson_node_quids(root, "parse_hson");
    assert_invariants(root, "parse hson interpolated template");
    return root;
}

/** Shared private pipeline used by authored parsing and provenance capture. */
export function parse_hson_attached(
    str: string,
    options: ParseTokensOptions = {},
    provenance?: HsonSourceProvenanceBuilder,
): HsonNode {
    return parse_hson_attached_internal(str, options, provenance, false);
}

function parse_hson_attached_internal(
    str: string,
    options: ParseTokensOptions,
    provenance: HsonSourceProvenanceBuilder | undefined,
    exactRuntimeIdentity: boolean,
): HsonNode {
    if (str.length === 0 && options.allowTopLevelDocumentText) {
        const emptyRoot = CREATE_NODE({ $_tag: ROOT_TAG, $_content: [] });
        scan_ingested_hson_node_quids(emptyRoot, "parse_hson");
        assert_invariants(emptyRoot, "parse hson");
        return emptyRoot;
    }
    const newTokens = tokenize_hson(str, 0, provenance);
    if (!exactRuntimeIdentity) reject_portable_quid_tokens(newTokens);
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

function reject_portable_quid_tokens(tokens: readonly Tokens[]): void {
    for (const token of tokens) {
        if ((token.kind === "OPEN" || token.kind === "ARR_OPEN") && token.quid !== undefined) {
            const { start } = token.quid;
            _throw_transform_err(
                "generated runtime QUID metadata is invalid in portable Transform input",
                "parse_hson",
                undefined,
                undefined,
                {
                    code: "PORTABLE_RUNTIME_QUID_FORBIDDEN",
                    stage: "source-admission",
                    source: { index: start.index, line: start.line, column: start.col },
                },
            );
        }
    }
}
