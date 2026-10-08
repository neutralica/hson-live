import type { AcceptedCorpusCase, RejectedCorpusCase } from "./corpus-types.mts";
import { elem, element, obj, str, val } from "./graph-expectations.mts";

function detachedStringHtml(value: string): string {
  let hex = "";
  for (let index = 0; index < value.length; index += 1) {
    hex += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return "<_hson_obj><!--hson-text:" + hex + "-->" + value + "</_hson_obj>";
}

function acceptedValue(
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
    tags: ["graph-ingress", "universal-primitive", "transport"], origin: "exact-node-admission",
    rationale: claim, disposition: "accept", graphIngress: carrier, expectedGraph,
    expectedOutputs: { hson, json, html },
    ...(negativeZeroPaths === undefined ? {} : { negativeZeroPaths }),
  };
}

export const graphAcceptedTransportCases: readonly AcceptedCorpusCase[] = [
  acceptedValue("string-ordinary", "A complete string is a context-free STR.", str("ordinary"), str("ordinary"), "\"ordinary\"", "\"ordinary\"", detachedStringHtml("ordinary")),
  acceptedValue("string-empty", "A complete empty string is a real STR.", str(""), str(""), "\"\"", "\"\"", detachedStringHtml("")),
  acceptedValue("true", "A complete true value is VAL.", val(true), val(true), "true", "true", "<_hson_obj><_hson_val>true</_hson_val></_hson_obj>"),
  acceptedValue("false", "A complete false value is VAL.", val(false), val(false), "false", "false", "<_hson_obj><_hson_val>false</_hson_val></_hson_obj>"),
  acceptedValue("null", "A complete null value is VAL.", val(null), val(null), "null", "null", "<_hson_obj><_hson_val>null</_hson_val></_hson_obj>"),
  acceptedValue("positive-number", "A complete positive finite number is VAL.", val(12.5), val(12.5), "12.5", "12.5", "<_hson_obj><_hson_val>12.5</_hson_val></_hson_obj>"),
  acceptedValue("negative-number", "A complete negative finite number is VAL.", val(-12.5), val(-12.5), "-12.5", "-12.5", "<_hson_obj><_hson_val>-12.5</_hson_val></_hson_obj>"),
  acceptedValue("zero", "A complete zero value is VAL.", val(0), val(0), "0", "0", "<_hson_obj><_hson_val>0</_hson_val></_hson_obj>"),
  acceptedValue("negative-zero", "A complete negative-zero value retains its sign.", val(-0), val(-0), "-0", "-0", "<_hson_obj><_hson_val>-0</_hson_val></_hson_obj>", ["$.$_content[0]"]),
] as const;

const canonicalInvariantRejection = {
  operation: "fromNode",
  stage: "source-admission",
  code: "HSON_CANONICAL_INVARIANT_VIOLATION",
} as const;

function rejectedCarrier(id: string, claim: string, graphIngress: RejectedCorpusCase["graphIngress"], path = '$["$_content"][0]'): RejectedCorpusCase {
  if (graphIngress === undefined) throw new Error("graph required");
  return {
    id: "graph.reject." + id, claim, classification: "graph-ingress-rejected-transport", ingress: "graph",
    escapedInput: JSON.stringify(graphIngress), taxonomy: { shape: graphIngress.$_tag, slot: "element-content", defect: id },
    tags: ["graph-ingress", "typed-value", "structural-mode", "rejection"], origin: "mode-sensitive-scalar-normalization",
    rationale: claim, disposition: "reject", graphIngress, expectedRejection: { ...canonicalInvariantRejection, path },
  };
}

export const graphRejectedTransportCases: readonly RejectedCorpusCase[] = [
  // B: preserve every retired forgiving candidate as eager rejection evidence.
  rejectedCarrier("object-string-ordinary", "A complete OBJ/STR carrier is forbidden.", obj(str("ordinary")), "$"),
  rejectedCarrier("object-string-empty", "An empty STR does not legalize a complete OBJ carrier.", obj(str("")), "$"),
  rejectedCarrier("element-string-ordinary", "A complete ELEM/STR alias is forbidden.", elem(str("ordinary")), "$"),
  rejectedCarrier("element-string-empty", "An empty STR does not legalize a complete ELEM carrier.", elem(str("")), "$"),
  ...[true, false, null, 12.5, -12.5, 0, -0].map((value, index) => rejectedCarrier(
    "object-value-" + index, "A complete OBJ/VAL carrier is forbidden.", obj(val(value)), "$",
  )),
  rejectedCarrier("direct-element-true", "A detached Hson element carrier may not contain a typed true leaf.", elem(val(true))),
  rejectedCarrier("direct-element-false", "A detached Hson element carrier may not contain a typed false leaf.", elem(val(false))),
  rejectedCarrier("direct-element-null", "A detached Hson element carrier may not contain a typed null leaf.", elem(val(null))),
  rejectedCarrier("direct-element-positive-number", "A detached Hson element carrier may not contain a typed positive numeric leaf.", elem(val(12.5))),
  rejectedCarrier("direct-element-negative-number", "A detached Hson element carrier may not contain a typed negative numeric leaf.", elem(val(-12.5))),
  rejectedCarrier("direct-element-zero", "A detached Hson element carrier may not contain a typed zero leaf.", elem(val(0))),
  rejectedCarrier("direct-element-negative-zero", "A detached Hson element carrier may not contain a typed negative-zero leaf.", elem(val(-0))),
  rejectedCarrier("nested-element-number", "An ordinary element may not retain a typed numeric leaf beneath its element content.", elem(element("div", [val(1)])), '$["$_content"][0]["$_content"][0]["$_content"][0]'),
  rejectedCarrier("element-carrier-child", "An element content carrier containing one typed child rejects as a whole.", elem(element("a"), val(false)), '$["$_content"][1]'),
] as const;
