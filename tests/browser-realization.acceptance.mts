// @hson-live-external-test
import assert from "node:assert/strict";
import type { HsonNode, Primitive } from "../src/core/types.ts";
import { plan_browser_realization, BrowserRealizationIncompatibilityError } from "../src/internal/browser-realization/browser-realization-plan.ts";
import { serialize_browser_realization } from "../src/internal/browser-realization/browser-realization-serialize.ts";
import { materialize_browser_realization, match_browser_realization_root } from "../src/internal/browser-realization/browser-realization-dom.ts";
import { create_livetree_runtime } from "../src/api/livetree/runtime/livetree-runtime.ts";
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
  const attrs = { checked: true, disabled: "disabled", selected: false, multiple: true, required: null, readonly: "custom" };
  const plan = plan_browser_realization(element("input", [], attrs));
  const root = plan.roots[0];
  assert.equal(root?.kind, "element");
  if (root?.kind !== "element") throw new Error("expected element");
  assert.deepEqual(Object.fromEntries(root.attrs.map((attr) => [attr.name, attr.value])), {
    checked: "", disabled: "disabled", multiple: "", readonly: "custom",
  });
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

process.stdout.write("Browser realization plan acceptance passed.\n");
