// @hson-live-external-test
import assert from "node:assert/strict";
import { hsonTransform } from "../src/api/transform/transform.facade.ts";
import { UNSAFE_TRANSFORM_SOURCE, SAFE_TRANSFORM_SOURCE } from "../src/api/transform/transform.browser.ts";
import { parse_html } from "../src/api/transform/parsers/parse-html.ts";
import { parse_html_string } from "../src/api/transform/parsers/parse-html-string.ts";
import { node_from_svg, is_svg_markup, SVG_NS } from "../src/api/transform/utils/node-utils/node-from-svg.ts";
import { hsonLiveTree } from "../src/api/livetree/livetree.facade.ts";
import { canonical_hson_graph_equal } from "../src/core/canonical-hson-equal.ts";
import { is_Node } from "../src/core/node-guards.ts";
import { TransformError } from "../src/core/errors.ts";
import type { HsonNode } from "../src/core/types.ts";
import type { TransformOutput } from "../src/api/transform/transform.types.ts";
import { create_test_event_emitter } from "./test-events.mjs";
import { with_browser_parser } from "./circuit-test-helpers.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { scalarHtmlFixtures, memberHtmlFixtures, arrayHtmlFixtures, mixedSvgFixtures, invalidHtmlFixtures, invalidSvgFixtures, svgSourceFixtures, root, obj, arr, elem, str, val, named } from "./fixtures/html-source-producer-fixtures.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.html-source-producer",
  title: "HTML relationships and generic SVG source ownership",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["html", "svg", "producer", "snapshot", "worker", "externally-discoverable"]),
});
const events = create_test_event_emitter("transform.html-source-producer");
let checks = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  events.case_begin(name, name);
  try { await run(); events.case_end(name, "pass"); checks++; console.log(`ok ${checks} - ${name}`); }
  catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; }
}
function complete(graph: HsonNode): HsonNode {
  assert.equal(graph.$_tag, "_hson_root"); assert.equal(graph.$_content.length, 1);
  const child = graph.$_content[0]; assert.ok(is_Node(child)); return child;
}
function same(actual: HsonNode, expected: HsonNode): void {
  assert.equal(canonical_hson_graph_equal(actual, expected), true);
}
function element(source: string): Element {
  const input = new DOMParser().parseFromString(source, "application/xml").documentElement;
  Object.defineProperty(input, "outerHTML", { configurable: true, value: source });
  return input;
}
function sources(source: string): TransformOutput[] {
  return [hsonTransform.fromTrustedHtml(source), ...with_browser_parser(() => [
    UNSAFE_TRANSFORM_SOURCE.fromHtml(source), UNSAFE_TRANSFORM_SOURCE.fromHtml(element(source)),
  ])];
}

await check("both HTML producers construct exact object relationships before terminals", () => {
  for (const fixture of [...memberHtmlFixtures, ...arrayHtmlFixtures]) {
    assert.deepEqual(parse_html_string(fixture.source, false), fixture.graph, fixture.id);
    with_browser_parser(() => {
      assert.deepEqual(parse_html(fixture.source), fixture.graph, fixture.id);
      assert.deepEqual(parse_html(element(fixture.source)), fixture.graph, fixture.id);
    });
    for (const source of sources(fixture.source)) {
      same(source.toNode(), fixture.graph);
      same(hsonTransform.fromHson(source.toHson().serialize()).toNode(), complete(fixture.graph));
      same(hsonTransform.fromBinary(source.toBinary().serialize()).toNode(), complete(fixture.graph));
    }
  }
  assert.throws(() => hsonTransform.fromNode(obj(named("a", val(1)))));
});
await check("HTML complete scalar carriers lower to direct primitives with independent observations", () => {
  for (const fixture of scalarHtmlFixtures) {
    assert.deepEqual(parse_html_string(fixture.source, false), fixture.graph, fixture.id);
    with_browser_parser(() => assert.deepEqual(parse_html(fixture.source), fixture.graph, fixture.id));
    for (const source of sources(fixture.source)) {
      same(source.toNode(), fixture.graph);
      const first = source.toNode(); const second = source.toNode();
      assert.notEqual(first, second); complete(first).$_content[0] = "changed";
      same(second, fixture.graph); same(source.toNode(), fixture.graph);
      same(hsonTransform.fromHson(source.toHson().serialize()).toNode(), complete(fixture.graph));
      same(hsonTransform.fromBinary(source.toBinary().serialize()).toNode(), complete(fixture.graph));
    }
    assert.throws(() => hsonTransform.fromNode(obj(complete(fixture.graph))));
    const owned = `<_hson_root>${fixture.source}</_hson_root>`;
    assert.deepEqual(parse_html_string(owned, false), fixture.graph);
    with_browser_parser(() => assert.deepEqual(parse_html(owned), fixture.graph));
  }
});
await check("contradictory carriers and member crossings reject at source construction", () => {
  for (const source of invalidHtmlFixtures) {
    assert.throws(() => parse_html_string(source, false), TransformError);
    assert.throws(() => hsonTransform.fromTrustedHtml(source), TransformError);
    with_browser_parser(() => {
      assert.throws(() => parse_html(source), TransformError);
      assert.throws(() => parse_html(element(source)), TransformError);
      assert.throws(() => UNSAFE_TRANSFORM_SOURCE.fromHtml(source), TransformError);
    });
  }
});
await check("authorized empty source ROOT ownership is retained", () => {
  assert.deepEqual(parse_html_string("", false), root());
  for (const source of sources("<_hson_root/>")) same(source.toNode(), root());
  assert.throws(() => hsonTransform.fromNode(root()));
});
await check('full HTML source routing preserves SVG siblings and surrounding content', () => {
  for (const fixture of mixedSvgFixtures) {
    assert.deepEqual(parse_html_string(fixture.source, false), fixture.graph, fixture.id);
    with_browser_parser(() => assert.deepEqual(parse_html(fixture.source), fixture.graph, fixture.id));
    // A single Element is not equivalent to a multi-sibling source string.
    for (const source of [hsonTransform.fromTrustedHtml(fixture.source),
      with_browser_parser(() => UNSAFE_TRANSFORM_SOURCE.fromHtml(fixture.source))]) {
      same(source.toNode(), fixture.graph);
      same(hsonTransform.fromHson(source.toHson().serialize()).toNode(), complete(fixture.graph));
      same(hsonTransform.fromBinary(source.toBinary().serialize()).toNode(), complete(fixture.graph));
    }
  }
  const attack = '<svg/><p hson:quid="000000001"/>';
  const forbiddenQuid = (error: unknown): boolean => error instanceof TransformError
    && error.code === 'PORTABLE_RUNTIME_QUID_FORBIDDEN' && error.stage === 'source-admission';
  assert.throws(() => hsonTransform.fromTrustedHtml(attack), forbiddenQuid);
  assert.throws(() => hsonTransform.fromUntrustedHtml(attack), forbiddenQuid);
  with_browser_parser(() => assert.throws(() => UNSAFE_TRANSFORM_SOURCE.fromHtml(attack), forbiddenQuid));
  same(hsonTransform.fromUntrustedHtml('<svg/><p/>').toNode(), root(elem(named('p'))));
  same(hsonTransform.fromUntrustedHtml('<p/><svg/>').toNode(), root(elem(named('p'))));
  same(hsonTransform.fromUntrustedHtml('<svg/>tail').toNode(), root(str('tail')));
  same(hsonTransform.fromUntrustedHtml('lead<svg/>').toNode(), root(str('lead')));
  same(hsonTransform.fromUntrustedHtml('<svg/><p></p><span></span>').toNode(), root(elem(named('p'), named('span'))));
});
await check('generic SVG rejects branches incompatible with its ELEM receiver', () => {
  for (const markup of invalidSvgFixtures) {
    assert.throws(() => hsonTransform.fromTrustedHtml(markup), error => error instanceof TransformError
      && error.code === 'HSON_CANONICAL_INVARIANT_VIOLATION' && error.stage === 'source-admission');
    with_browser_parser(() => {
      const input = element(markup);
      // The branch-positive API keeps its existing independently owned role.
      assert.deepEqual(node_from_svg(input), named('svg', markup.includes('_hson_obj') ? obj() : arr()));
      for (const source of [markup, input]) {
        assert.throws(() => UNSAFE_TRANSFORM_SOURCE.fromHtml(source), error => error instanceof TransformError
          && error.code === 'HSON_CANONICAL_INVARIANT_VIOLATION' && error.stage === 'source-admission');
      }
    });
  }
});
await check("SVG strings and synthetic SVG Elements publish complete source ownership", () => {
  assert.equal(is_svg_markup("<svg/>"), true); assert.equal(is_svg_markup("<svg />"), true);
  assert.equal(is_svg_markup("<svg-other/>"), false);
  for (const fixture of svgSourceFixtures) {
    assert.deepEqual(parse_html_string(fixture.source, false), fixture.graph, fixture.id);
    const browserSources = with_browser_parser(() => {
      const input = element(fixture.source);
      assert.equal(input.namespaceURI, SVG_NS);
      const branch = node_from_svg(input);
      const expectedBranch = complete(fixture.graph).$_content[0]; assert.ok(is_Node(expectedBranch));
      assert.deepEqual(branch, expectedBranch, fixture.id);
      assert.throws(() => hsonTransform.fromNode(branch));
      return [UNSAFE_TRANSFORM_SOURCE.fromHtml(fixture.source), UNSAFE_TRANSFORM_SOURCE.fromHtml(input)];
    });
    for (const source of [hsonTransform.fromTrustedHtml(fixture.source), ...browserSources]) {
      same(source.toNode(), fixture.graph);
      const hson = source.toHson().serialize();
      // Raw SVG style and Hson style notation have deferred storage closure.
      if (fixture.id !== "SVG attributes, order and nesting") {
        same(hsonTransform.fromHson(hson).toNode(), complete(fixture.graph));
      }
      same(hsonTransform.fromBinary(source.toBinary().serialize()).toNode(), complete(fixture.graph));
    }
  }
});
await check("LiveTree continues consuming lower-level SVG branches", () => {
  with_browser_parser(() => {
    for (const markup of ["<svg><g/></svg>", "<svg/>"]) {
      const tree = hsonLiveTree.fromTrustedHtml(markup);
      assert.equal(tree.node.$_tag, "svg"); assert.equal(typeof tree.quid, "string");
      assert.equal(tree.node.$_content.length, markup === "<svg/>" ? 0 : 1);
    }
  });
});
await check("HTML text boundaries, UTF-16 and existing attribute/style construction remain exact", () => {
  const completeValue = elem(named("p", elem(str(""), str("a"), str(""), str("\ud800\u0000\udfff"), str("b"))));
  const source = hsonTransform.fromNode(completeValue).toHtml().serialize();
  // Reserved annotations belong to string transport, not literal Element text.
  same(hsonTransform.fromTrustedHtml(source).toNode(), root(completeValue));
  with_browser_parser(() => same(UNSAFE_TRANSFORM_SOURCE.fromHtml(source).toNode(), root(completeValue)));
  const markup = '<p title="  kept  " style="color:red">x</p>';
  const expected = root(elem({ ...named("p", elem(str("x"))), $_attrs: { title: "kept", style: { color: "red" } } }));
  for (const admitted of sources(markup)) same(admitted.toNode(), expected);
});
await check("public HTML/SVG QUID claims and unsafe SVG on the safe pipeline remain rejected", () => {
  for (const markup of ['<p hson:quid="000000001"/>', '<svg hson:quid="000000001"/>', '<svg><g hson:quid="000000001"/></svg>']) {
    assert.throws(() => hsonTransform.fromTrustedHtml(markup), error => error instanceof TransformError && error.code === "PORTABLE_RUNTIME_QUID_FORBIDDEN");
    with_browser_parser(() => assert.throws(() => UNSAFE_TRANSFORM_SOURCE.fromHtml(markup), error => error instanceof TransformError && error.code === "PORTABLE_RUNTIME_QUID_FORBIDDEN"));
  }
  with_browser_parser(() => {
    assert.throws(() => SAFE_TRANSFORM_SOURCE.fromHtml("<svg/>"), /external SVG is only allowed/);
    assert.throws(() => SAFE_TRANSFORM_SOURCE.fromHtml("<svg><g/></svg>"), /external SVG is only allowed/);
  });
});

await check("repaired HTML and SVG snapshots isolate all terminal observations", async () => {
  for (const fixture of [memberHtmlFixtures[8], svgSourceFixtures[0], arrayHtmlFixtures[0],
    { ...mixedSvgFixtures[0], source: `<_hson_root>${mixedSvgFixtures[0].source}</_hson_root>` }]) {
    for (const reverse of [false, true]) {
      const input = with_browser_parser(() => element(fixture.source));
      const source = with_browser_parser(() => UNSAFE_TRANSFORM_SOURCE.fromHtml(input));
      const jsonFirst = reverse ? source.toJson() : undefined;
      const html = source.toHtml(); const binary = source.toBinary(); const hson = source.toHson().noBreak();
      const json = jsonFirst ?? source.toJson();
      const before = { node: source.toNode(), hson: hson.serialize(), json: json.serialize(), html: html.serialize(), bytes: binary.serialize() };
      const hashes = await Promise.all([hson.sha256(), json.sha256(), html.sha256(), binary.sha256()]);
      // The browser test complements these synthetic caller-Element mutations.
      assert.equal(Reflect.set(input.childNodes, "length", 0), true);
      source.toNode().$_content.length = 0;
      const jsonCopy = json.value();
      if (typeof jsonCopy === "object" && jsonCopy !== null) Reflect.set(jsonCopy, "changed", true);
      binary.serialize().fill(0);
      same(source.toNode(), before.node);
      assert.equal(source.toHson().noBreak().serialize(), before.hson); assert.equal(hson.serialize(), before.hson);
      assert.equal(source.toJson().serialize(), before.json); assert.equal(json.serialize(), before.json);
      assert.equal(source.toHtml().serialize(), before.html); assert.equal(html.serialize(), before.html);
      assert.deepEqual(source.toBinary().serialize(), before.bytes); assert.deepEqual(binary.serialize(), before.bytes);
      assert.deepEqual(await Promise.all([hson.sha256(), json.sha256(), html.sha256(), binary.sha256()]), hashes);
    }
  }
});
await check("actual source-loaded Worker preserves repaired HTML and SVG graphs", async () => {
  const expected = [...scalarHtmlFixtures, ...memberHtmlFixtures, ...arrayHtmlFixtures, ...mixedSvgFixtures, ...svgSourceFixtures].map(fixture => fixture.graph);
  const observed = await new Promise<HsonNode[]>((resolve, reject) => {
    const worker = repository_typescript_worker(new URL("./fixtures/html-source-producer.worker.mts", import.meta.url));
    worker.once("message", resolve); worker.once("error", reject);
    worker.once("exit", code => { if (code !== 0) reject(new Error(`HTML source Worker exited ${code}`)); });
  });
  assert.deepEqual(observed, expected);
});
events.terminal("pass"); console.log(`1..${checks}`);
