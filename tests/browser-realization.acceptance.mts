// @hson-live-external-test
import assert from "node:assert/strict";
import type { HsonNode, Primitive } from "../src/core/types.ts";
import { plan_browser_realization, BrowserRealizationIncompatibilityError } from "../src/internal/browser-realization/browser-realization-plan.ts";
import { serialize_browser_realization } from "../src/internal/browser-realization/browser-realization-serialize.ts";
import { materialize_browser_realization, match_browser_realization_root } from "../src/internal/browser-realization/browser-realization-dom.ts";
import { create_livetree_runtime } from "../src/api/livetree/runtime/livetree-runtime.ts";
import { project_livetree } from "../src/api/livetree/creation/project-live-tree.ts";
import { hsonTransform } from "../src/api/transform/index.ts";
import { get_dom_for_node } from "../src/api/livetree/utils/node-map-helpers.ts";
import { FakeElement, install_fake_document } from "./helpers/fake-document.mts";

assert.equal(typeof globalThis.document, "undefined");
assert.equal(
  serialize_browser_realization(plan_browser_realization({ $_tag: "main", $_content: [] })),
  "<main></main>",
);
install_fake_document();

const leaf = (value: string): HsonNode => ({ $_tag: "_hson_str", $_content: [value] });
const element = (tag: string, content: Array<HsonNode | Primitive> = [], attrs?: HsonNode["$_attrs"]): HsonNode => ({
  $_tag: tag,
  ...(attrs === undefined ? {} : { $_attrs: attrs }),
  $_content: content.length === 0 ? [] : [{ $_tag: "_hson_elem", $_content: content }],
});
const rejectsSsr = (node: HsonNode, reason: RegExp): BrowserRealizationIncompatibilityError => {
  let emitted = false;
  assert.throws(
    () => {
      const plan = plan_browser_realization(node);
      emitted = true;
      serialize_browser_realization(plan);
    },
    (cause) => cause instanceof BrowserRealizationIncompatibilityError
      && reason.test(cause.reason)
      && cause.canonicalPath.length !== 0,
  );
  assert.equal(emitted, false, "SSR incompatibility must originate before serialization");
  try {
    plan_browser_realization(node);
  } catch (cause) {
    if (cause instanceof BrowserRealizationIncompatibilityError) return cause;
  }
  throw new Error("expected browser realization incompatibility");
};

{
  const first = leaf("a");
  const empty = leaf("");
  const second = leaf("b");
  const trailingEmpty = leaf("");
  const canonical = element("p", [first, empty, second, trailingEmpty]);
  const before = structuredClone(canonical);
  const plan = plan_browser_realization(canonical);
  const html = serialize_browser_realization(plan);
  assert.equal(serialize_browser_realization(plan), html);
  assert.match(html, /^<p>a<!--hson-boundary:v1:/);
  assert.doesNotMatch(html, /_hson_(?:str|elem)/);
  assert.equal((html.match(/:boundary:/g) ?? []).length, 3);
  assert.equal((html.match(/:empty:/g) ?? []).length, 2);
  assert.deepEqual(canonical, before);
  const runtime = create_livetree_runtime();
  const root = materialize_browser_realization(plan, runtime, (globalThis.document), "linked") as Element;
  assert.equal(root.childNodes.length, 7);
  assert.equal(root.childNodes[0]?.nodeType, 3);
  assert.equal(root.childNodes[2]?.nodeType, 8);
  assert.equal(root.childNodes[4]?.nodeType, 3);
  assert.equal(get_dom_for_node(first), root.childNodes[0]);
  assert.equal(get_dom_for_node(empty), root.childNodes[2]);
  assert.equal(get_dom_for_node(second), root.childNodes[4]);
  assert.equal(get_dom_for_node(trailingEmpty), root.childNodes[6]);
  match_browser_realization_root(plan, root);
}

{
  const plain = element("p", [leaf("a"), leaf(""), leaf("a")]);
  const identified = structuredClone(plain);
  identified.$_meta = { quid: "000000601" };
  const otherRuntime = structuredClone(plain);
  otherRuntime.$_meta = { quid: "000000602" };
  const markers = (node: HsonNode): string[] => {
    const root = plan_browser_realization(node).roots[0];
    if (root?.kind !== "element") throw new Error("Expected planned element.");
    return root.children.filter((child) => child.kind === "marker").map((child) => child.value);
  };
  assert.deepEqual(markers(plain), markers(identified));
  assert.deepEqual(markers(identified), markers(otherRuntime));
}

{
  const plan = plan_browser_realization(element("table", [element("tr", [element("td", ["cell"])])]));
  const table = materialize_browser_realization(plan, create_livetree_runtime(), globalThis.document, "linked") as Element;
  const wrapper = table.childNodes[0];
  if (wrapper?.nodeType !== 1) throw new Error("Expected derived table wrapper.");
  (wrapper as Element).setAttribute("hson:quid", "000000603");
  assert.throws(() => match_browser_realization_root(plan, table), /unplanned attribute/);
}

{
  const attrs = {
    checked: true,
    disabled: "disabled",
    selected: false,
    multiple: true,
    required: null,
    readonly: "custom",
    tabindex: 0,
  };
  const plan = plan_browser_realization(element("input", [], attrs));
  const root = plan.roots[0];
  assert.equal(root?.kind, "element");
  if (root?.kind !== "element") throw new Error("expected element");
  assert.deepEqual(Object.fromEntries(root.attrs.map((attr) => [attr.name, attr.value])), {
    checked: "", disabled: "disabled", multiple: "", readonly: "custom", tabindex: "0",
  });
}

for (const [label, value, reason] of [
  ["NUL", "a\0b", /attribute value containing NUL/],
  ["lone high surrogate", "a\ud800b", /attribute value containing a lone surrogate/],
  ["lone low surrogate", "a\udc00b", /attribute value containing a lone surrogate/],
] as const) {
  for (const tag of ["main", "svg"] as const) {
    const canonical: HsonNode = { $_tag: "_hson_root", $_content: [element(tag, [], { "data-value": value })] };
    const admitted = hsonTransform.fromNode(canonical).toNode();
    const domPlan = plan_browser_realization(admitted, { capability: "dom" });
    assert.equal(domPlan.parserClosure, "not-required", `${label} ${tag} direct-DOM capability`);
    const projected = materialize_browser_realization(
      domPlan,
      create_livetree_runtime(),
      globalThis.document,
      "linked",
    ) as unknown as FakeElement;
    assert.equal(projected.getAttribute("data-value"), value, `${label} ${tag} direct-DOM value`);
    const failure = rejectsSsr(admitted, reason);
    assert.match(failure.canonicalPath, /\.a\["data-value"\]$/, `${label} ${tag} attribute path`);
  }
}

for (const value of [
  "",
  "ASCII",
  "<",
  ">",
  "&",
  "\"'",
  "\r",
  "\n",
  "\u2028\u2029",
  "caf\u00e9",
  "\ud83d\ude80",
]) {
  for (const tag of ["main", "svg"] as const) {
    const plan = plan_browser_realization(element(tag, [], { "data-value": value }));
    assert.equal(plan.parserClosure, "verified");
    assert.doesNotThrow(() => serialize_browser_realization(plan));
  }
}

{
  const table = element("table", [element("tr", [element("td", [leaf("x")])]), element("tr")]);
  const plan = plan_browser_realization(table);
  const root = plan.roots[0];
  assert.equal(root?.kind, "element");
  if (root?.kind !== "element") throw new Error("expected table");
  assert.equal(root.children[0]?.kind, "wrapper");
  assert.equal(root.children[0]?.kind === "wrapper" && root.children[0].localName, "tbody");
  assert.doesNotMatch(JSON.stringify(table), /tbody/);
  assert.match(serialize_browser_realization(plan), /^<table><tbody><tr>/);
}

{
  const template = plan_browser_realization(element("template", [element("span", [leaf("x")])]));
  assert.equal(template.roots[0]?.kind === "element" && template.roots[0].childTarget, "template-content");
  const projected = materialize_browser_realization(template, create_livetree_runtime(), globalThis.document, "linked") as unknown as FakeElement;
  assert.equal(projected.childNodes.length, 0);
  assert.equal(projected.content?.childNodes.length, 1);
}

{
  const svg = element("svg", [element("foreignobject", [element("div", [element("svg", [element("lineargradient")])])])], { viewbox: "0 0 1 1" });
  const plan = plan_browser_realization(svg);
  const html = serialize_browser_realization(plan);
  assert.doesNotMatch(html, /xmlns=/);
  assert.match(html, /viewBox="0 0 1 1"/);
  assert.match(html, /<foreignObject><div><svg><linearGradient>/);
}

{
  const pre = serialize_browser_realization(plan_browser_realization(element("pre", [leaf("\nX")])));
  assert.match(pre, /^<pre><!--hson-boundary:v1:.*:pre-lf:0-->\nX<\/pre>$/);
}

for (const tag of ["textarea", "title", "style", "script"]) {
  assert.throws(
    () => plan_browser_realization(element(tag, [leaf("a"), leaf("b")])),
    BrowserRealizationIncompatibilityError,
  );
  assert.throws(
    () => plan_browser_realization(element(tag, [leaf("")])),
    BrowserRealizationIncompatibilityError,
  );
  assert.equal(serialize_browser_realization(plan_browser_realization(element(tag))), `<${tag}></${tag}>`);
  assert.match(serialize_browser_realization(plan_browser_realization(element(tag, [leaf("a<&")]))), new RegExp(`^<${tag}>`));
}

assert.throws(() => plan_browser_realization(element("textarea", [leaf("\nA")])), /leading LF/);
assert.throws(() => plan_browser_realization(element("style", [leaf("a\r\nb")])), /RAWTEXT containing CR/);
assert.throws(() => plan_browser_realization(element("script", [leaf("x<\/ScRiPt >y")])), /closing sentinel/);
assert.throws(() => plan_browser_realization(element("style", [leaf("x<\/STYLE>y")])), /closing sentinel/);
assert.throws(() => plan_browser_realization(element("script", [leaf("a\0b")])), /NUL/);
assert.throws(() => plan_browser_realization(element("title", [leaf("a\ud800b")])), /lone surrogate/);
assert.throws(() => plan_browser_realization(element("table", [element("div")])), /foster-parented/);
assert.throws(() => plan_browser_realization(element("svg", [], { viewBox: "0", viewbox: "1" })), /duplicate browser name/);
assert.throws(() => plan_browser_realization(element("html", [element("body"), element("head")])), /ordered canonical/);
assert.throws(() => plan_browser_realization(element("html", [element("head", [element("div")]), element("body")])), /relocated/);

for (const tag of ["area", "base", "basefont", "bgsound", "br", "col", "command", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]) {
  const candidate = tag === "col"
    ? element("table", [element("colgroup", [element("col", [leaf("child")])])])
    : element(tag, [leaf("child")]);
  rejectsSsr(candidate, /void element/);
}

for (const [name, node, reason] of [
  ["p disruptive child", element("p", [element("div", [leaf("x")])]), /implicitly close.*<p>/],
  ["nested p", element("p", [element("p", [leaf("x")])]), /implicitly close.*<p>/],
  ["nested li", element("li", [element("li")]), /nested <li>/],
  ["dt to dd", element("dt", [element("dd")]), /<dt> or <dd>/],
  ["nested form", element("form", [element("form")]), /nested <form>/],
  ["nested button", element("button", [element("button")]), /nested <button>/],
  ["nested anchor", element("a", [element("a")]), /nested <a>/],
  ["nested nobr", element("nobr", [element("nobr")]), /nested <nobr>/],
  ["invalid select child", element("select", [element("div")]), /invalid in select/],
  ["option element child", element("select", [element("option", [element("span")])]), /option parser context/],
  ["row outside table", element("main", [element("tr", [element("td", [leaf("x")])])]), /parser-valid parent/],
  ["cell outside row", element("main", [element("td")]), /parser-valid parent/],
  ["table text", element("table", [leaf("x")]), /foster-parented|relocate/],
  ["section text", element("table", [element("tbody", [leaf("x")])]), /table-section insertion mode/],
  ["row text", element("table", [element("tbody", [element("tr", [leaf("x")])])]), /table-row insertion mode/],
  ["invalid head", element("html", [element("head", [element("main")]), element("body")]), /relocated/],
] as const) {
  const failure = rejectsSsr(node, reason);
  assert.match(failure.message, /Browser realization is incompatible at /, name);
}

for (const supported of [
  element("div", [element("span", [leaf("x")])]),
  element("form", [element("label", [leaf("name")]), element("input")]),
  element("ul", [element("li", [element("ul", [element("li", [leaf("nested")])])])]),
  element("p", [element("span", [leaf("phrasing")])]),
  element("table", [element("tr", [element("td", [leaf("x")])])]),
  element("select", [element("optgroup", [element("option", [leaf("x")])])]),
  element("template", [element("span", [leaf("x")])]),
  element("svg", [element("foreignobject", [element("div", [element("svg", [element("circle")])])])]),
  element("html", [element("head", [element("title", [leaf("x")])]), element("body", [element("main")])]),
]) {
  assert.doesNotThrow(() => serialize_browser_realization(plan_browser_realization(supported)));
}

{
  const parserUnstable = element("p", [element("div", [leaf("direct")])]);
  const canonical = { $_tag: "_hson_root", $_content: [structuredClone(parserUnstable)] };
  const admitted = hsonTransform.fromNode(canonical).toNode();
  assert.deepEqual(admitted, canonical);
  rejectsSsr(admitted, /implicitly close.*<p>/);
  const projected = project_livetree(structuredClone(parserUnstable), "html", create_livetree_runtime(), globalThis.document) as unknown as FakeElement;
  assert.equal(projected.localName, "p");
  assert.equal((projected.childNodes[0] as FakeElement | undefined)?.localName, "div");
  const domPlan = plan_browser_realization(structuredClone(parserUnstable), { capability: "dom" });
  assert.equal(domPlan.parserClosure, "not-required");
  assert.throws(() => serialize_browser_realization(domPlan), /requires a parser-closed/);
}

process.stdout.write("Browser realization plan acceptance passed.\n");
