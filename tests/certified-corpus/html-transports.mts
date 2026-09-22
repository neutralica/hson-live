import type { AcceptedCorpusCase, RejectedCorpusCase } from "./corpus-types.mts";
import { elem, element, obj, str, val } from "./graph-expectations.mts";

function hex16(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    result += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return result;
}

function textWire(value: string): string {
  let display = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x0d) display += "\r";
    else if (code >= 0xd800 && code <= 0xdbff
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      display += value[index] + value[index + 1];
      index += 1;
    } else if ((code < 0x20 && code !== 0x09 && code !== 0x0a)
      || (code >= 0xd800 && code <= 0xdfff) || code >= 0xfffe) display += "\ufffd";
    else display += value[index];
  }
  return "<!--hson-text:" + hex16(value) + "-->"
    + display.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;").replaceAll("\r", "&#13;");
}

function rawWire(values: readonly string[]): string {
  return "/*hson-raw:" + (values.length === 1 ? hex16(values[0]) : "a:" + hex16(JSON.stringify(values))) + "*/";
}

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
  htmlIngressCase("object-string-ordinary", "An HTML Hson object carrier detaches an ordinary string.", "<_hson_obj>" + textWire("ordinary") + "</_hson_obj>", str("ordinary"), undefined, undefined, ["ordinary"]),
  htmlIngressCase("object-string-empty", "An HTML Hson object carrier detaches an empty string.", "<_hson_obj>" + textWire("") + "</_hson_obj>", str(""), undefined, undefined, [""]),
  htmlIngressCase("object-true", "An HTML Hson object carrier detaches typed true.", "<_hson_obj><_hson_val>true</_hson_val></_hson_obj>", val(true)),
  htmlIngressCase("object-false", "An HTML Hson object carrier detaches typed false.", "<_hson_obj><_hson_val>false</_hson_val></_hson_obj>", val(false)),
  htmlIngressCase("object-null", "An HTML Hson object carrier detaches typed null.", "<_hson_obj><_hson_val>null</_hson_val></_hson_obj>", val(null)),
  htmlIngressCase("object-positive-number", "An HTML Hson object carrier detaches a positive finite number.", "<_hson_obj><_hson_val>12.5</_hson_val></_hson_obj>", val(12.5)),
  htmlIngressCase("object-negative-number", "An HTML Hson object carrier detaches a negative finite number.", "<_hson_obj><_hson_val>-12.5</_hson_val></_hson_obj>", val(-12.5)),
  htmlIngressCase("object-zero", "An HTML Hson object carrier detaches zero.", "<_hson_obj><_hson_val>0</_hson_val></_hson_obj>", val(0)),
  htmlIngressCase("object-negative-zero", "An HTML Hson object carrier detaches negative zero.", "<_hson_obj><_hson_val>-0</_hson_val></_hson_obj>", val(-0), ["$.$_content[0]"]),
] as const;

const explicitStringCases: readonly [string, string][] = [
  ["nul", "\u0000"], ["backspace", "\b"], ["form-feed", "\f"],
  ["tab", "\t"], ["line-feed", "\n"], ["carriage-return", "\r"], ["crlf", "\r\n"],
  ["quote", "\""], ["backslash", "\\"], ["less-than", "<"], ["greater-than", ">"],
  ["ampersand", "&"], ["slash", "/"], ["bmp-non-ascii", "λ漢"],
  ["supplementary-unicode", "😀"], ["isolated-high-surrogate", "\ud800"],
  ["isolated-low-surrogate", "\udc00"],
] as const;

export const structuralHtmlControlStringCases: readonly AcceptedCorpusCase[] = explicitStringCases.map(
  ([id, value]) => htmlGraphCase("string-" + id, "Reserved text boundary preserves " + id + " exactly.", str(value), "<_hson_obj>" + textWire(value) + "</_hson_obj>", [value]),
);

export const structuralHtmlSegmentationCases: readonly AcceptedCorpusCase[] = [
  htmlGraphCase("two-adjacent-strings", "Two adjacent strings remain two leaves.", elem(element("div", [str("a"), str("b")])), "<div>" + textWire("a") + textWire("b") + "</div>", ["a", "b"]),
  htmlGraphCase("three-adjacent-strings", "Three adjacent strings remain three leaves.", elem(element("div", [str("a"), str("b"), str("c")])), "<div>" + textWire("a") + textWire("b") + textWire("c") + "</div>", ["a", "b", "c"]),
  htmlGraphCase("three-empty-strings", "Multiple empty strings retain their exact count.", elem(element("div", [str(""), str(""), str("")])), "<div>" + textWire("") + textWire("") + textWire("") + "</div>", ["", "", ""]),
  htmlGraphCase("empty-nonempty-empty", "Empty/nonempty/empty string order survives.", elem(element("div", [str(""), str("x"), str("")])), "<div>" + textWire("") + textWire("x") + textWire("") + "</div>", ["", "x", ""]),
  htmlGraphCase("identical-adjacent", "Identical adjacent strings do not merge.", elem(element("div", [str("same"), str("same")])), "<div>" + textWire("same") + textWire("same") + "</div>", ["same", "same"]),
  htmlGraphCase("control-empty-unicode-adjacent", "Ordinary, empty, control-bearing, and Unicode leaves remain separately ordered.", elem(element("div", [str("ordinary"), str(""), str("\u0000"), str("😀"), str("\r\n")])), "<div>" + textWire("ordinary") + textWire("") + textWire("\u0000") + textWire("😀") + textWire("\r\n") + "</div>", ["ordinary", "", "\u0000", "😀", "\r\n"]),
  htmlGraphCase("ordinary-melted-text", "One unambiguous ordinary HTML text leaf may remain melted.", elem(element("div", [str("ordinary")])), "<div>ordinary</div>", ["ordinary"], undefined, "ordinary-html"),
] as const;

const styleRaw = "a{content:\"<>&/\"}/* // */{\"x\":1}<a/>«1,2»";
const scriptRaw = "const x={value:\"<>&/\",note:\"// /* */ <a/> «1,2»\"};";

export const structuralHtmlRawTextCases: readonly AcceptedCorpusCase[] = [
  htmlGraphCase("style-ordinary-raw-text", "Style raw text preserves parser-sensitive code units.", elem(element("style", [str(styleRaw)])), "<style>" + rawWire([styleRaw]) + "</style>", [styleRaw]),
  htmlGraphCase("script-ordinary-raw-text", "Generic Transform script raw text remains exact outside HsonDocument.", elem(element("script", [str(scriptRaw)])), "<script>" + rawWire([scriptRaw]) + "</script>", [scriptRaw]),
  htmlGraphCase("style-line-ending-carrier", "Style text with CRLF uses reserved raw lexical transport.", elem(element("style", [str("a{\r\nb:c\r\n}")])), "<style>" + rawWire(["a{\r\nb:c\r\n}"]) + "</style>", ["a{\r\nb:c\r\n}"]),
  htmlGraphCase("script-line-ending-raw-text", "Generic script text with LF and less-than uses reserved raw lexical transport.", elem(element("script", [str("const x={\nvalue:\"<>&/\"\n};")])), "<script>" + rawWire(["const x={\nvalue:\"<>&/\"\n};"]) + "</script>", ["const x={\nvalue:\"<>&/\"\n};"]),
  htmlGraphCase("style-segmented-carrier", "Generic Transform retains segmented style text outside HsonDocument.", elem(element("style", [str("a"), str(""), str("b")])), "<style>" + rawWire(["a", "", "b"]) + "</style>", ["a", "", "b"]),
  htmlGraphCase("script-segmented-carrier", "Generic Transform retains segmented script text outside HsonDocument.", elem(element("script", [str("a"), str(""), str("b")])), "<script>" + rawWire(["a", "", "b"]) + "</script>", ["a", "", "b"]),
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
  htmlRejection("nested-element-value", "Obsolete element carriers reject before nested content is interpreted.", "<_hson_elem><div><_hson_val>true</_hson_val></div></_hson_elem>", "parse-html-string", "TRANSFORM_ERROR"),
] as const;

export const structuralHtmlAcceptedCases: readonly AcceptedCorpusCase[] = [
  ...structuralHtmlScalarIngressCases,
  ...structuralHtmlControlStringCases,
  ...structuralHtmlSegmentationCases,
  ...structuralHtmlRawTextCases,
] as const;
