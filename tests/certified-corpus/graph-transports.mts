import type { AcceptedCorpusCase, RejectedCorpusCase } from "./corpus-types.mts";
import { elem, element, obj, str, val } from "./graph-expectations.mts";

function acceptedCarrier(
  id: string,
  claim: string,
  carrier: AcceptedCorpusCase["graphIngress"],
  expectedGraph: AcceptedCorpusCase["expectedGraph"],
  hson: string,
  json: string,
  html: string,
  negativeZeroPaths?: readonly string[],
): AcceptedCorpusCase {
  if (carrier === undefined) throw new Error("carrier required");
  return {
    id: "graph.accept." + id, claim, classification: "graph-ingress-accepted-transport", ingress: "graph",
    escapedInput: JSON.stringify(carrier), taxonomy: { shape: carrier.$_tag, slot: "detached-semantic-boundary", variation: id },
    tags: ["graph-ingress", "scalar-carrier", "transport"], origin: "transport-totality",
    rationale: claim, disposition: "accept", graphIngress: carrier, expectedGraph,
    expectedOutputs: { hson, json, html },
    ...(negativeZeroPaths === undefined ? {} : { negativeZeroPaths }),
  };
}

export const graphAcceptedTransportCases: readonly AcceptedCorpusCase[] = [
  acceptedCarrier("object-string-ordinary", "A detached Hson object string carrier normalizes to its ordinary string leaf.", obj(str("ordinary")), str("ordinary"), "\"ordinary\"", "\"ordinary\"", "<_hson_obj><_hson_str>&quot;ordinary&quot;</_hson_str></_hson_obj>"),
  acceptedCarrier("object-string-empty", "A detached Hson object string carrier normalizes to its empty string leaf.", obj(str("")), str(""), "\"\"", "\"\"", "<_hson_obj><_hson_str>&quot;&quot;</_hson_str></_hson_obj>"),
  acceptedCarrier("element-string-ordinary", "A detached Hson element string carrier normalizes to its ordinary text leaf.", elem(str("ordinary")), str("ordinary"), "\"ordinary\"", "\"ordinary\"", "<_hson_obj><_hson_str>&quot;ordinary&quot;</_hson_str></_hson_obj>"),
  acceptedCarrier("element-string-empty", "A detached Hson element string carrier normalizes to its empty text leaf.", elem(str("")), str(""), "\"\"", "\"\"", "<_hson_obj><_hson_str>&quot;&quot;</_hson_str></_hson_obj>"),
  acceptedCarrier("object-true", "A detached Hson object carrier transports true.", obj(val(true)), val(true), "true", "true", "<_hson_obj><_hson_val>true</_hson_val></_hson_obj>"),
  acceptedCarrier("object-false", "A detached Hson object carrier transports false.", obj(val(false)), val(false), "false", "false", "<_hson_obj><_hson_val>false</_hson_val></_hson_obj>"),
  acceptedCarrier("object-null", "A detached Hson object carrier transports null.", obj(val(null)), val(null), "null", "null", "<_hson_obj><_hson_val>null</_hson_val></_hson_obj>"),
  acceptedCarrier("object-positive-number", "A detached Hson object carrier transports a positive finite number.", obj(val(12.5)), val(12.5), "12.5", "12.5", "<_hson_obj><_hson_val>12.5</_hson_val></_hson_obj>"),
  acceptedCarrier("object-negative-number", "A detached Hson object carrier transports a negative finite number.", obj(val(-12.5)), val(-12.5), "-12.5", "-12.5", "<_hson_obj><_hson_val>-12.5</_hson_val></_hson_obj>"),
  acceptedCarrier("object-zero", "A detached Hson object carrier transports zero.", obj(val(0)), val(0), "0", "0", "<_hson_obj><_hson_val>0</_hson_val></_hson_obj>"),
  acceptedCarrier("object-negative-zero", "A detached Hson object carrier transports negative zero.", obj(val(-0)), val(-0), "-0", "-0", "<_hson_obj><_hson_val>-0</_hson_val></_hson_obj>", ["$.$_content[0]"]),
] as const;

const canonicalInvariantRejection = {
  operation: "fromNode",
  stage: "canonical-invariant-admission",
  code: "HSON_CANONICAL_INVARIANT_VIOLATION",
} as const;

function rejectedCarrier(id: string, claim: string, graphIngress: RejectedCorpusCase["graphIngress"]): RejectedCorpusCase {
  if (graphIngress === undefined) throw new Error("graph required");
  return {
    id: "graph.reject." + id, claim, classification: "graph-ingress-rejected-transport", ingress: "graph",
    escapedInput: JSON.stringify(graphIngress), taxonomy: { shape: graphIngress.$_tag, slot: "element-content", defect: id },
    tags: ["graph-ingress", "typed-value", "structural-mode", "rejection"], origin: "mode-sensitive-scalar-normalization",
    rationale: claim, disposition: "reject", graphIngress, expectedRejection: canonicalInvariantRejection,
  };
}

export const graphRejectedTransportCases: readonly RejectedCorpusCase[] = [
  rejectedCarrier("direct-element-true", "A detached Hson element carrier may not contain a typed true leaf.", elem(val(true))),
  rejectedCarrier("direct-element-false", "A detached Hson element carrier may not contain a typed false leaf.", elem(val(false))),
  rejectedCarrier("direct-element-null", "A detached Hson element carrier may not contain a typed null leaf.", elem(val(null))),
  rejectedCarrier("direct-element-positive-number", "A detached Hson element carrier may not contain a typed positive numeric leaf.", elem(val(12.5))),
  rejectedCarrier("direct-element-negative-number", "A detached Hson element carrier may not contain a typed negative numeric leaf.", elem(val(-12.5))),
  rejectedCarrier("direct-element-zero", "A detached Hson element carrier may not contain a typed zero leaf.", elem(val(0))),
  rejectedCarrier("direct-element-negative-zero", "A detached Hson element carrier may not contain a typed negative-zero leaf.", elem(val(-0))),
  rejectedCarrier("nested-element-number", "An ordinary element may not retain a typed numeric leaf beneath its element content.", elem(element("div", [val(1)]))),
  rejectedCarrier("fragment-typed-child", "An element fragment containing one typed child rejects as a whole.", elem(element("a"), val(false))),
] as const;
