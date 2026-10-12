import { assert_invariants } from "../../../core/assert-invariants.js";
import type { HsonNode } from "../../../core/types.js";
import { assemble_hson_tokens, type ParseTokensOptions, type HsonAttributeDecoder } from "./assemble-hson-tokens.js";
import { tokenize_hson, tokenize_authored_document_library } from "./tokenize-hson.js";
import type { Tokens, AuthoredQuadDeclaration } from "../token.types.js";
import { scan_ingested_hson_node_quids } from "../utils/hson-utils/quid-ingress.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";
import type { HsonSourceProvenanceBuilder } from "../../../internal/hson-source-provenance/hson-source-provenance.js";

/** Shared lexical, portable-identity and structural admission pipeline. */
export function parse_hson_source(
    str: string,
    decodeAttributes: HsonAttributeDecoder,
    options: ParseTokensOptions,
    provenance: HsonSourceProvenanceBuilder | undefined,
    exactRuntimeIdentity: boolean,
    onQuad?: (node: HsonNode, declaration: AuthoredQuadDeclaration) => void,
): HsonNode {
    const newTokens = onQuad === undefined ? tokenize_hson(str, 0, provenance) : tokenize_authored_document_library(str, provenance);
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
    const newNode = assemble_hson_tokens(newTokens, decodeAttributes, options, provenance, onQuad)
    scan_ingested_hson_node_quids(newNode, "parse_hson");
    assert_invariants(newNode, 'parse hson');
    return newNode;
}

export function reject_portable_quid_tokens(tokens: readonly Tokens[]): void {
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
