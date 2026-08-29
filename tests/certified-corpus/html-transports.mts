import type { AcceptedCorpusCase, RejectedCorpusCase } from "./corpus-types.mts";
import { elem, element, obj, str, val } from "./graph-expectations.mts";

function htmlGraphCase(
  id: string,
  claim: string,
  graph: AcceptedCorpusCase["expectedGraph"],
  html: string,
  expectedStringLeaves?: readonly string[],
  negativeZeroPaths?: readonly string[],
  htmlMode: "ordinary-html" | "structural-transport" = "structural-transport",
): AcceptedCorpusCase {
  return {
    id: "html.accept." + id, claim, classification: "structural-html-transport", ingress: "graph",
    escapedInput: JSON.stringify(graph), taxonomy: { shape: graph.$_tag, slot: "html-transport", variation: id },
    tags: ["html", "transport", htmlMode], origin: "transport-totality", rationale: claim,
    disposition: "accept", graphIngress: graph, expectedGraph: graph, expectedOutputs: { html },
    ...(expectedStringLeaves === undefined ? {} : { expectedStringLeaves }),
    ...(negativeZeroPaths === undefined ? {} : { negativeZeroPaths }), htmlMode,
  };
}

function htmlIngressCase(
  id: string,
  claim: string,
  html: string,
  expectedGraph: AcceptedCorpusCase["expectedGraph"],
  negativeZeroPaths?: readonly string[],
  expectedHtml: string = html,
  expectedStringLeaves?: readonly string[],
): AcceptedCorpusCase {
  return {
    id: "html.accept.ingress." + id, claim, classification: "structural-html-transport", ingress: "html",
    escapedInput: JSON.stringify(html), taxonomy: { shape: "structural-html", slot: "detached-semantic-boundary", variation: id },
    tags: ["html", "transport", "scalar-carrier"], origin: "mode-sensitive-scalar-normalization", rationale: claim,
    disposition: "accept", transportIngress: html, expectedGraph, expectedOutputs: { html: expectedHtml },
    ...(negativeZeroPaths === undefined ? {} : { negativeZeroPaths }),
    ...(expectedStringLeaves === undefined ? {} : { expectedStringLeaves }), htmlMode: "structural-transport",
  };
}

export const structuralHtmlScalarIngressCases: readonly AcceptedCorpusCase[] = [
  htmlIngressCase("object-string-ordinary", "An HTML Hson object carrier detaches an ordinary string.", "<_hson_obj><_hson_str>&quot;ordinary&quot;</_hson_str></_hson_obj>", str("ordinary"), undefined, undefined, ["ordinary"]),
  htmlIngressCase("object-string-empty", "An HTML Hson object carrier detaches an empty string.", "<_hson_obj><_hson_str>&quot;&quot;</_hson_str></_hson_obj>", str(""), undefined, undefined, [""]),
  htmlIngressCase("element-string-ordinary", "An HTML Hson element carrier detaches ordinary text.", "<_hson_elem><_hson_str>&quot;ordinary&quot;</_hson_str></_hson_elem>", str("ordinary"), undefined, "<_hson_obj><_hson_str>&quot;ordinary&quot;</_hson_str></_hson_obj>", ["ordinary"]),
  htmlIngressCase("element-string-empty", "An HTML Hson element carrier detaches empty text.", "<_hson_elem><_hson_str>&quot;&quot;</_hson_str></_hson_elem>", str(""), undefined, "<_hson_obj><_hson_str>&quot;&quot;</_hson_str></_hson_obj>", [""]),
  htmlIngressCase("object-true", "An HTML Hson object carrier detaches typed true.", "<_hson_obj><_hson_val>true</_hson_val></_hson_obj>", val(true)),
  htmlIngressCase("object-false", "An HTML Hson object carrier detaches typed false.", "<_hson_obj><_hson_val>false</_hson_val></_hson_obj>", val(false)),
  htmlIngressCase("object-null", "An HTML Hson object carrier detaches typed null.", "<_hson_obj><_hson_val>null</_hson_val></_hson_obj>", val(null)),
  htmlIngressCase("object-positive-number", "An HTML Hson object carrier detaches a positive finite number.", "<_hson_obj><_hson_val>12.5</_hson_val></_hson_obj>", val(12.5)),
  htmlIngressCase("object-negative-number", "An HTML Hson object carrier detaches a negative finite number.", "<_hson_obj><_hson_val>-12.5</_hson_val></_hson_obj>", val(-12.5)),
  htmlIngressCase("object-zero", "An HTML Hson object carrier detaches zero.", "<_hson_obj><_hson_val>0</_hson_val></_hson_obj>", val(0)),
  htmlIngressCase("object-negative-zero", "An HTML Hson object carrier detaches negative zero.", "<_hson_obj><_hson_val>-0</_hson_val></_hson_obj>", val(-0), ["$.$_content[0]"]),
] as const;

const explicitStringCases: readonly [string, string, string][] = [
  ["nul", "\u0000", "<_hson_obj><_hson_str>&quot;\\u0000&quot;</_hson_str></_hson_obj>"],
  ["backspace", "\b", "<_hson_obj><_hson_str>&quot;\\b&quot;</_hson_str></_hson_obj>"],
  ["form-feed", "\f", "<_hson_obj><_hson_str>&quot;\\f&quot;</_hson_str></_hson_obj>"],
  ["tab", "\t", "<_hson_obj><_hson_str>&quot;\\t&quot;</_hson_str></_hson_obj>"],
  ["line-feed", "\n", "<_hson_obj><_hson_str>&quot;\\n&quot;</_hson_str></_hson_obj>"],
  ["carriage-return", "\r", "<_hson_obj><_hson_str>&quot;\\r&quot;</_hson_str></_hson_obj>"],
  ["crlf", "\r\n", "<_hson_obj><_hson_str>&quot;\\r\\n&quot;</_hson_str></_hson_obj>"],
  ["quote", "\"", "<_hson_obj><_hson_str>&quot;\\&quot;&quot;</_hson_str></_hson_obj>"],
  ["backslash", "\\", "<_hson_obj><_hson_str>&quot;\\\\&quot;</_hson_str></_hson_obj>"],
  ["less-than", "<", "<_hson_obj><_hson_str>&quot;&lt;&quot;</_hson_str></_hson_obj>"],
  ["greater-than", ">", "<_hson_obj><_hson_str>&quot;&gt;&quot;</_hson_str></_hson_obj>"],
  ["ampersand", "&", "<_hson_obj><_hson_str>&quot;&amp;&quot;</_hson_str></_hson_obj>"],
  ["slash", "/", "<_hson_obj><_hson_str>&quot;/&quot;</_hson_str></_hson_obj>"],
  ["bmp-non-ascii", "λ漢", "<_hson_obj><_hson_str>&quot;\\u03bb\\u6f22&quot;</_hson_str></_hson_obj>"],
  ["supplementary-unicode", "😀", "<_hson_obj><_hson_str>&quot;\\ud83d\\ude00&quot;</_hson_str></_hson_obj>"],
  ["isolated-high-surrogate", "\ud800", "<_hson_obj><_hson_str>&quot;\\ud800&quot;</_hson_str></_hson_obj>"],
  ["isolated-low-surrogate", "\udc00", "<_hson_obj><_hson_str>&quot;\\udc00&quot;</_hson_str></_hson_obj>"],
] as const;

export const structuralHtmlControlStringCases: readonly AcceptedCorpusCase[] = explicitStringCases.map(
  ([id, value, html]) => htmlGraphCase("string-" + id, "Explicit string transport preserves " + id + " exactly.", str(value), html, [value]),
);

export const structuralHtmlSegmentationCases: readonly AcceptedCorpusCase[] = [
  htmlGraphCase("two-adjacent-strings", "Two adjacent strings remain two leaves.", elem(element("div", [str("a"), str("b")])), "<div><_hson_elem><_hson_str>&quot;a&quot;</_hson_str><_hson_str>&quot;b&quot;</_hson_str></_hson_elem></div>", ["a", "b"]),
  htmlGraphCase("three-adjacent-strings", "Three adjacent strings remain three leaves.", elem(element("div", [str("a"), str("b"), str("c")])), "<div><_hson_elem><_hson_str>&quot;a&quot;</_hson_str><_hson_str>&quot;b&quot;</_hson_str><_hson_str>&quot;c&quot;</_hson_str></_hson_elem></div>", ["a", "b", "c"]),
  htmlGraphCase("three-empty-strings", "Multiple empty strings retain their exact count.", elem(element("div", [str(""), str(""), str("")])), "<div><_hson_elem><_hson_str>&quot;&quot;</_hson_str><_hson_str>&quot;&quot;</_hson_str><_hson_str>&quot;&quot;</_hson_str></_hson_elem></div>", ["", "", ""]),
  htmlGraphCase("empty-nonempty-empty", "Empty/nonempty/empty string order survives.", elem(element("div", [str(""), str("x"), str("")])), "<div><_hson_elem><_hson_str>&quot;&quot;</_hson_str><_hson_str>&quot;x&quot;</_hson_str><_hson_str>&quot;&quot;</_hson_str></_hson_elem></div>", ["", "x", ""]),
  htmlGraphCase("identical-adjacent", "Identical adjacent strings do not merge.", elem(element("div", [str("same"), str("same")])), "<div><_hson_elem><_hson_str>&quot;same&quot;</_hson_str><_hson_str>&quot;same&quot;</_hson_str></_hson_elem></div>", ["same", "same"]),
  htmlGraphCase("control-empty-unicode-adjacent", "Ordinary, empty, control-bearing, and Unicode leaves remain separately ordered.", elem(element("div", [str("ordinary"), str(""), str("\u0000"), str("😀"), str("\r\n")])), "<div><_hson_elem><_hson_str>&quot;ordinary&quot;</_hson_str><_hson_str>&quot;&quot;</_hson_str><_hson_str>&quot;\\u0000&quot;</_hson_str><_hson_str>&quot;\\ud83d\\ude00&quot;</_hson_str><_hson_str>&quot;\\r\\n&quot;</_hson_str></_hson_elem></div>", ["ordinary", "", "\u0000", "😀", "\r\n"]),
  htmlGraphCase("ordinary-melted-text", "One unambiguous ordinary HTML text leaf may remain melted.", elem(element("div", [str("ordinary")])), "<div>ordinary</div>", ["ordinary"], undefined, "ordinary-html"),
] as const;

const styleRaw = "a{content:\"<>&/\"}/* // */{\"x\":1}<a/>«1,2»";
const scriptRaw = "const x={value:\"<>&/\",note:\"// /* */ <a/> «1,2»\"};";

export const structuralHtmlRawTextCases: readonly AcceptedCorpusCase[] = [
  htmlGraphCase("style-ordinary-raw-text", "Ordinary style raw text preserves braces, quotes, angle characters, ampersands, slashes, comments, JSON-looking text, and Hson-looking text.", elem(element("style", [str(styleRaw)])), "<style>" + styleRaw + "</style>", [styleRaw], undefined, "ordinary-html"),
  htmlGraphCase("script-ordinary-raw-text", "Ordinary script raw text preserves braces, quotes, angle characters, ampersands, slashes, comments, JSON-looking text, and Hson-looking text.", elem(element("script", [str(scriptRaw)])), "<script>" + scriptRaw + "</script>", [scriptRaw], undefined, "ordinary-html"),
  htmlGraphCase("style-line-ending-carrier", "Style text with CRLF uses an explicit structural carrier to preserve code units.", elem(element("style", [str("a{\r\nb:c\r\n}")])), "<style><_hson_elem><_hson_str>&quot;a{\\r\\nb:c\\r\\n}&quot;</_hson_str></_hson_elem></style>", ["a{\r\nb:c\r\n}"]),
  htmlGraphCase("script-line-ending-carrier", "Script text with LF uses an explicit structural carrier to preserve code units.", elem(element("script", [str("const x={\nvalue:\"<>&/\"\n};")])), "<script><_hson_elem><_hson_str>&quot;const x={\\nvalue:\\&quot;&lt;&gt;&amp;/\\&quot;\\n};&quot;</_hson_str></_hson_elem></script>", ["const x={\nvalue:\"<>&/\"\n};"]),
  htmlGraphCase("style-segmented-carrier", "Explicit structural carriers override style raw-text melting when segmentation matters.", elem(element("style", [str("a"), str(""), str("b")])), "<style><_hson_elem><_hson_str>&quot;a&quot;</_hson_str><_hson_str>&quot;&quot;</_hson_str><_hson_str>&quot;b&quot;</_hson_str></_hson_elem></style>", ["a", "", "b"]),
  htmlGraphCase("script-segmented-carrier", "Explicit structural carriers override script raw-text melting when segmentation matters.", elem(element("script", [str("a"), str(""), str("b")])), "<script><_hson_elem><_hson_str>&quot;a&quot;</_hson_str><_hson_str>&quot;&quot;</_hson_str><_hson_str>&quot;b&quot;</_hson_str></_hson_elem></script>", ["a", "", "b"]),
] as const;

function htmlRejection(id: string, claim: string, source: string, operation: string, code: string, stage?: string): RejectedCorpusCase {
  return {
    id: "html.reject." + id, claim, classification: "structural-html-transport", ingress: "html",
    escapedInput: JSON.stringify(source), taxonomy: { shape: "structural-html", slot: "element-content", defect: id },
    tags: ["html", "typed-value", "structural-mode", "rejection"], origin: "mode-sensitive-scalar-normalization",
    rationale: claim, disposition: "reject", transportIngress: source,
    expectedRejection: { operation, code, ...(stage === undefined ? {} : { stage }) }, htmlMode: "structural-transport",
  };
}

export const structuralHtmlRejectedCases: readonly RejectedCorpusCase[] = [
  htmlRejection("direct-element-value", "Structural HTML forbids a direct typed value beneath an Hson element carrier.", "<_hson_elem><_hson_val>1</_hson_val></_hson_elem>", "parse-html-string", "TRANSFORM_ERROR"),
  htmlRejection("direct-element-true", "Structural HTML forbids typed true beneath an Hson element carrier.", "<_hson_elem><_hson_val>true</_hson_val></_hson_elem>", "parse-html-string", "TRANSFORM_ERROR"),
  htmlRejection("direct-element-false", "Structural HTML forbids typed false beneath an Hson element carrier.", "<_hson_elem><_hson_val>false</_hson_val></_hson_elem>", "parse-html-string", "TRANSFORM_ERROR"),
  htmlRejection("direct-element-null", "Structural HTML forbids typed null beneath an Hson element carrier.", "<_hson_elem><_hson_val>null</_hson_val></_hson_elem>", "parse-html-string", "TRANSFORM_ERROR"),
  htmlRejection("direct-element-negative-number", "Structural HTML forbids a typed negative number beneath an Hson element carrier.", "<_hson_elem><_hson_val>-12.5</_hson_val></_hson_elem>", "parse-html-string", "TRANSFORM_ERROR"),
  htmlRejection("direct-element-zero", "Structural HTML forbids typed zero beneath an Hson element carrier.", "<_hson_elem><_hson_val>0</_hson_val></_hson_elem>", "parse-html-string", "TRANSFORM_ERROR"),
  htmlRejection("direct-element-negative-zero", "Structural HTML forbids typed negative zero beneath an Hson element carrier.", "<_hson_elem><_hson_val>-0</_hson_val></_hson_elem>", "parse-html-string", "TRANSFORM_ERROR"),
  htmlRejection("nested-element-value", "Structural HTML rejects a typed value beneath an ordinary element in element mode.", "<_hson_elem><div><_hson_val>true</_hson_val></div></_hson_elem>", "parse-html-string", "HSON_CANONICAL_INVARIANT_VIOLATION", "canonical-invariant-admission"),
] as const;

export const structuralHtmlAcceptedCases: readonly AcceptedCorpusCase[] = [
  ...structuralHtmlScalarIngressCases,
  ...structuralHtmlControlStringCases,
  ...structuralHtmlSegmentationCases,
  ...structuralHtmlRawTextCases,
] as const;
