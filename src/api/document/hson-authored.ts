import type { HsonNode } from "../../core/types.js";
import { assert_invariants } from "../../core/assert-invariants.js";
import { qualify_hson_document_root } from "./hson-document.js";
import { parse_hson_source, reject_portable_quid_tokens } from "../transform/parsers/parse-hson-source.js";
import { assemble_hson_tokens } from "../transform/parsers/assemble-hson-tokens.js";
import { split_attrs_meta } from "../transform/utils/hson-utils/split-attrs-meta.js";
import { scan_ingested_hson_node_quids } from "../transform/utils/hson-utils/quid-ingress.js";
import { serialize_hson_authored_document_content } from "../transform/serializers/serialize-hson.js";
import type { Tokens } from "../transform/token.types.js";
import type { HsonAuthored } from "../transform/transform.types.js";

/** @internal No owner or identity issuance: declarations belong to this one operation. */
export function qualify_authored_document_source(source: string, quads: Map<HsonNode, string>): HsonNode {
  const root = parse_hson_source(source, split_attrs_meta, { allowTopLevelDocumentText: true }, undefined, false,
    (node, declaration) => { quads.set(node, declaration.value); });
  return qualify_hson_document_root(root);
}

/** @internal Slots contain independently qualified document nodes and retain their associations. */
export function assemble_authored_document(tokens: Tokens[], values: readonly (readonly HsonNode[])[],
  quads: Map<HsonNode, string>,
): HsonNode {
  reject_portable_quid_tokens(tokens);
  const root = assemble_hson_tokens(tokens, split_attrs_meta,
    { allowTopLevelDocumentText: true, interpolation: { mode: "document", values } }, undefined,
    (node, declaration) => { quads.set(node, declaration.value); });
  scan_ingested_hson_node_quids(root, "Hson.document");
  assert_invariants(root, "authored document template");
  return qualify_hson_document_root(root);
}

/** @internal Brand only qualified authored output, never canonical output. */
export function serialize_authored_document(root: HsonNode, quads: ReadonlyMap<HsonNode, string>): HsonAuthored {
  return serialize_hson_authored_document_content(root, quads) as HsonAuthored;
}
