import { create_test_event_emitter } from "./test-events.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import { parseDocument } from "htmlparser2";
import { hson } from "../src/hson.ts";
import { hsonTransform } from "../src/api/transform/index.ts";
import { UNSAFE_TRANSFORM_SOURCE } from "../src/api/transform/transform.browser.ts";
import { hsonLiveMap } from "../src/api/livemap/livemap.facade.ts";
import { hsonLiveTree } from "../src/api/livetree/livetree.facade.ts";
import { make_branch_from_node } from "../src/api/livetree/creation/create-branch.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { parse_html, parse_html_exact_runtime } from "../src/api/transform/parsers/parse-html.ts";
import { node_from_svg, node_from_svg_exact_runtime, SVG_NS } from "../src/api/transform/utils/node-utils/node-from-svg.ts";
import {
  HsonNodeQuidValidationError,
  read_hson_node_quid,
} from "../src/core/hson-node-quid.ts";
import { HSON_META_INDEX, HSON_META_QUID } from "../src/core/constants.ts";
import type { HsonNode } from "../src/core/types.ts";
import {
  destroy_subtree_quids,
  ensure_quid,
  get_node_by_quid,
  LIVETREE_QUID_MINT_RETRY_LIMIT,
} from "../src/api/livetree/quid/data-quid.ts";
import { is_persisted_quid } from "../src/core/persisted-quid.ts";
import { construct_exact_runtime_livetree, LiveTree } from "../src/api/livetree/livetree.ts";
import { begin_livetree_materialization_profile } from "../src/api/livetree/debug/materialization-profile.ts";
import { read_transform_error_details } from "../src/core/errors.ts";
import { admit_exact_runtime_livemap_node } from "../src/internal/exact-runtime-node-admission.ts";

const Q1 = "000000001";
const Q2 = "000000002";
const Q3 = "000000003";
const Q4 = "000000004";
const Q5 = "000000005";
const Q6 = "000000006";
const Q7 = "000000007";
const Q8 = "000000008";
const Q9 = "000000009";
const Q10 = "00000000a";
const Q11 = "00000000b";
const QUID_ATTR = "hson:quid";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "transform.hson-node-quid-ingress",
  title: "Canonical HsonNode QUID ingress",
  category: "Transform",
  runtime: "node-synthetic-dom",
  tags: Object.freeze(["quid", "ingress", "externally-discoverable"]),
});

const testEvents = create_test_event_emitter("transform.hson-node-quid-ingress");
let checks = 0;
function check(name: string, fn: () => void): void {

  testEvents.case_begin(name, name);
  try {
    fn();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function is_node(value: HsonNode["$_content"][number]): value is HsonNode {
  return typeof value === "object" && value !== null && "$_tag" in value;
}

function nodes(root: HsonNode): HsonNode[] {
  const result: HsonNode[] = [];
  const visit = (node: HsonNode): void => {
    result.push(node);
    for (const child of node.$_content) if (is_node(child)) visit(child);
  };
  visit(root);
  return result;
}

function must_tag(root: HsonNode, tag: string): HsonNode {
  const found = nodes(root).find((node) => node.$_tag === tag);
  assert.ok(found, `expected <${tag}>`);
  return found;
}

function document_root(...children: HsonNode[]): HsonNode {
  return {
    $_tag: "_hson_root",
    $_content: [{ $_tag: "_hson_elem", $_content: children }],
  };
}

function element(tag: string, quid?: string, children: HsonNode[] = []): HsonNode {
  return {
    $_tag: tag,
    $_content: children.length === 0
      ? []
      : [{ $_tag: "_hson_elem", $_content: children }],
    ...(quid === undefined ? {} : { $_meta: { [HSON_META_QUID]: quid } }),
  };
}

function validation_cause(error: unknown): HsonNodeQuidValidationError | undefined {
  let current = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof HsonNodeQuidValidationError) return current;
    seen.add(current);
    current = current.cause;
  }
  return undefined;
}

function assert_validation_code(
  fn: () => unknown,
  code: HsonNodeQuidValidationError["code"],
): HsonNodeQuidValidationError {
  let observed: unknown;
  try {
    fn();
  } catch (error) {
    observed = error;
  }
  assert.ok(observed instanceof Error, "expected ingestion to reject");
  const cause = validation_cause(observed);
  assert.ok(cause, `expected shared validation cause behind: ${observed.message}`);
  assert.equal(cause.code, code);
  return cause;
}

function assert_portable_node_reject(fn: () => unknown): void {
  let observed: unknown;
  try { fn(); } catch (error) { observed = error; }
  assert.equal(read_transform_error_details(observed)?.code, "PORTABLE_RUNTIME_QUID_FORBIDDEN");
}

function assert_authored_reserved_name_failure(
  fn: () => unknown,
  name: string,
  position: Readonly<{ line: number; col: number; index: number }>,
): void {
  let observed: unknown;
  try {
    fn();
  } catch (error) {
    observed = error;
  }
  assert.ok(observed instanceof Error, "expected authored reserved name to reject");
  assert.ok(
    observed.message.includes("[authored-reserved-name]"),
    `expected authored-reserved-name classification behind: ${observed.message}`,
  );
  assert.ok(
    observed.message.includes(`authored Hson name "${name}"`),
    `expected rejected authored name behind: ${observed.message}`,
  );
  assert.ok(
    observed.message.includes(
      `at ${position.line}:${position.col} (index ${position.index})`,
    ),
    `expected authored source position behind: ${observed.message}`,
  );
  assert.equal(
    validation_cause(observed),
    undefined,
    "authored reserved names must reject at lexical admission before shared validation",
  );
}

type DomAttr = Readonly<{ name: string; value: string }>;
type DomElementInput = Readonly<{
  tag: string;
  attrs?: readonly DomAttr[];
  children?: readonly Record<string, unknown>[];
  namespace?: string;
}>;

function dom_element(input: DomElementInput): Element {
  const attrs = [...(input.attrs ?? [])];
  const children = [...(input.children ?? [])];
  return {
    nodeType: 1,
    tagName: input.tag,
    namespaceURI: input.namespace ?? "http://www.w3.org/1999/xhtml",
    attributes: attrs,
    childNodes: children,
    hasAttribute(name: string): boolean {
      return attrs.some((attr) => attr.name === name);
    },
    get textContent(): string {
      return children.map((child) => child.textContent ?? child.nodeValue ?? "").join("");
    },
  } as unknown as Element;
}

function text_node(value: string): Record<string, unknown> {
  return { nodeType: 3, nodeValue: value, textContent: value };
}

function with_dom_node_constants(fn: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Node");
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    writable: true,
    value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  });
  try {
    fn();
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, "Node");
    else Object.defineProperty(globalThis, "Node", descriptor);
  }
}

function with_generated_candidates(
  finalBytes: readonly number[],
  fn: (calls: () => number) => void,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  let callCount = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    writable: true,
    value: {
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        assert.ok(array instanceof Uint8Array);
        array.fill(0);
        array[array.length - 1] = (finalBytes[Math.min(callCount, finalBytes.length - 1)] ?? 0) << 3;
        callCount += 1;
        return array;
      },
    } as Crypto,
  });
  try {
    fn(() => callCount);
  } finally {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, "crypto");
    else Object.defineProperty(globalThis, "crypto", descriptor);
  }
}

function prepare_parser_element(
  node: Record<string, unknown>,
  inheritedNamespace?: string,
): void {
  if (node.nodeType !== 1) return;
  const tag = String(node.tagName);
  const namespace = tag.toLowerCase() === "svg"
    ? SVG_NS
    : inheritedNamespace ?? "http://www.w3.org/1999/xhtml";
  Object.defineProperty(node, "namespaceURI", {
    configurable: true,
    value: namespace,
  });
  Object.defineProperty(node, "hasAttribute", {
    configurable: true,
    value(name: string): boolean {
      return (node.attributes as DomAttr[]).some((attr) => attr.name === name);
    },
  });
  for (const child of node.childNodes as Record<string, unknown>[]) {
    prepare_parser_element(child, namespace);
  }
}

function parser_document(source: string): {
  documentElement: Element;
  querySelector(selector: string): null;
} {
  const parsed = parseDocument(source, {
    xmlMode: true,
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    recognizeSelfClosing: true,
  });
  const root = parsed.childNodes.find((node) => node.nodeType === 1);
  assert.ok(root, "test DOM parser expected one document element");
  prepare_parser_element(root as unknown as Record<string, unknown>);
  return {
    documentElement: root as unknown as Element,
    querySelector: () => null,
  };
}

function browser_source_element(markup: string): Element {
  const element = parser_document(markup).documentElement;
  const openingEnd = markup.indexOf(">");
  const closingStart = markup.lastIndexOf("</");
  const inner = openingEnd === -1 || closingStart < openingEnd
    ? ""
    : markup.slice(openingEnd + 1, closingStart);
  Object.defineProperties(element, {
    outerHTML: {
      configurable: true,
      get: () => markup,
    },
    innerHTML: {
      configurable: true,
      get: () => inner,
    },
  });
  return element;
}

function exact_browser_html(input: string | Element): HsonNode {
  const source = typeof input === "string" ? input : input.outerHTML;
  if (/^<\s*svg(?:\s|>)/i.test(source.trimStart())) {
    return node_from_svg_exact_runtime(typeof input === "string" ? browser_source_element(input) : input);
  }
  return parse_html_exact_runtime(input);
}

function with_browser_ingress_dom(fn: () => void): void {
  const descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
  for (const key of ["DOMParser", "Node", "document"] as const) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }

  class TestDOMParser {
    parseFromString(source: string): ReturnType<typeof parser_document> {
      return parser_document(source);
    }
  }

  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    writable: true,
    value: TestDOMParser,
  });
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    writable: true,
    value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  });

  // The template branch is intentionally present so the parity test can be
  // mutation-tested against the former Element-only QUID stripping helper.
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: {
      createElement(tag: string): unknown {
        assert.equal(tag, "template");
        let markup = "";
        return {
          get innerHTML(): string {
            return markup;
          },
          set innerHTML(value: string) {
            markup = value;
          },
          content: {
            querySelectorAll(): Array<{ removeAttribute(name: string): void }> {
              return [{
                removeAttribute(name: string): void {
                  if (name !== QUID_ATTR) return;
                  markup = markup.replace(
                    /\shson:quid=(?:"[^"]*"|'[^']*')/gi,
                    "",
                  );
                },
              }];
            },
          },
        };
      },
    },
  });

  try {
    fn();
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
      else Object.defineProperty(globalThis, key, descriptor);
    }
  }
}

check("portable Hson rejects generated QUID claims with a source position", () => {
  for (const source of [`<main @${Q1}/>`, `<main @${Q1} <span @${Q2}/>/>`, `«@${Q1} 1»`]) {
    assert.throws(
      () => parse_hson(source),
      (error) => error instanceof Error && "code" in error
        && error.code === "PORTABLE_RUNTIME_QUID_FORBIDDEN"
        && "source" in error && typeof error.source === "object",
    );
  }
  assert.equal(read_hson_node_quid(must_tag(parse_hson(`<main/>`), "main")), undefined);
  assert.equal(get_node_by_quid(Q1), undefined);
});

check("internal exact Hson compatibility remains separate from portable admission", () => {
  const exact = parse_hson_exact_runtime(`<main @${Q1} <span @${Q2}/>/>`);
  assert.equal(read_hson_node_quid(must_tag(exact, "main")), Q1);
  assert.equal(read_hson_node_quid(must_tag(exact, "span")), Q2);
  assert.equal(get_node_by_quid(Q1), undefined);
});

check("malformed authored QUID syntax still rejects without normalization", () => {
  for (const malformed of ["00000001", "0000000001", "00000000i", "00000000A"]) {
    assert.throws(() => parse_hson(`<main @${malformed}/>`));
  }
});

check("portable HTML rejects generated QUID metadata through trusted and untrusted parsers", () => {
  for (const parse of [
    () => hsonTransform.fromTrustedHtml(`<main hson:quid="${Q1}"/>`).toNode(),
    () => hsonTransform.fromUntrustedHtml(`<main hson:quid="${Q1}"/>`).toNode(),
    () => hsonTransform.fromTrustedHtml(`<main hson:quid="bad"/>`).toNode(),
    () => hsonTransform.fromTrustedHtml(`<svg hson:quid="${Q1}"/>`).toNode(),
  ]) {
    assert.throws(parse, (error) => error instanceof Error && "code" in error
      && error.code === "PORTABLE_RUNTIME_QUID_FORBIDDEN");
  }
  const ordinary = hsonTransform.fromTrustedHtml(
    `<main hson-foo="ordinary" data-_quid="application" data-_index="ordinary"/>`,
  ).toNode();
  assert.equal(must_tag(ordinary, "main").$_attrs?.["data-_quid"], "application");
  assert.equal(must_tag(ordinary, "main").$_attrs?.["data-_index"], "ordinary");
  assert.equal(must_tag(ordinary, "main").$_attrs?.["hson-foo"], "ordinary");
});

check("portable DOM and SVG Element ingress rejects QUID claims", () => {
  with_dom_node_constants(() => {
    const html = dom_element({ tag: "main", attrs: [{ name: QUID_ATTR, value: Q1 }] });
    const svg = dom_element({ tag: "svg", namespace: SVG_NS, attrs: [{ name: QUID_ATTR, value: Q1 }] });
    assert.throws(() => parse_html(html), /runtime QUID metadata is invalid/);
    assert.throws(() => node_from_svg(svg), /runtime QUID metadata is invalid/);
    assert.equal(get_node_by_quid(Q1), undefined);
  });
});

check("local exact DOM ingress retains QUIDs for runtime realization", () => {
  with_dom_node_constants(() => {
    const html = dom_element({ tag: "main", attrs: [{ name: QUID_ATTR, value: Q1 }] });
    const svg = dom_element({ tag: "svg", namespace: SVG_NS, attrs: [{ name: QUID_ATTR, value: Q2 }] });
    assert.equal(read_hson_node_quid(must_tag(parse_html_exact_runtime(html), "main")), Q1);
    assert.equal(read_hson_node_quid(node_from_svg_exact_runtime(svg)), Q2);
    assert.equal(get_node_by_quid(Q1), undefined);
  });
});

check("all portable graph facades reject serialized identity including raw nodes", () => {
  assert.throws(() => hsonTransform.fromHson(`<main @${Q1}/>`).toNode(), /runtime QUID metadata is invalid/);
  assert.throws(() => hsonTransform.fromJson({ main: "", $_meta: { quid: Q1 } }).toNode(), /runtime QUID metadata is invalid/);
  assert.throws(() => hsonTransform.fromTrustedHtml(`<main hson:quid="${Q1}"/>`).toNode(), /runtime QUID metadata is invalid/);
  const local = document_root(element("main", Q1));
  assert.equal(read_hson_node_quid(must_tag(local, "main")), Q1);
  assert_portable_node_reject(() => hsonTransform.fromNode(local));
  assert_portable_node_reject(() => hsonLiveMap.fromNode(local));
  assert_portable_node_reject(() => hsonLiveTree.fromNode(local));
  assert_portable_node_reject(() => hsonTransform.fromNode(document_root(element("main", "bad"))));
});

check("public raw nodes reject QUIDs before exact runtime placement checks", () => {
  const invalidVsn = document_root(element("main", Q1));
  invalidVsn.$_meta = { [HSON_META_QUID]: Q2 };
  const beforeVsn = structuredClone(invalidVsn);
  assert_portable_node_reject(() => hsonTransform.fromNode(invalidVsn));
  assert.deepEqual(invalidVsn, beforeVsn);

  const duplicate = document_root(element("main", Q1, [element("aside", Q1)]));
  const beforeDuplicate = structuredClone(duplicate);
  assert_portable_node_reject(() => hsonTransform.fromNode(duplicate));
  assert.equal(read_hson_node_quid(must_tag(duplicate, "main")), Q1);
  assert.equal(read_hson_node_quid(must_tag(duplicate, "aside")), Q1);
  assert.deepEqual(duplicate, beforeDuplicate);

  assert_validation_code(
    () => make_branch_from_node(invalidVsn),
    "INELIGIBLE_QUID",
  );
  assert.throws(() => make_branch_from_node(duplicate), /Duplicate QUID/);
  assert.deepEqual(invalidVsn, beforeVsn);
  assert.deepEqual(duplicate, beforeDuplicate);
});

check("browser HTML string and Element inputs preserve the supplied root and equivalent nested cold identity", () => {
  with_browser_ingress_dom(() => {
    const markup =
      `<button hson:quid="${Q4}" data-_quid="application" data-user="kept">`
      + `<span hson:quid="${Q5}" aria-label="child">Save</span>`
      + `</button>`;
    const sourceElement = browser_source_element(markup);
    const sourceBefore = sourceElement.outerHTML;

    const fromString = exact_browser_html(markup);
    const fromElement = exact_browser_html(sourceElement);

    for (const graph of [fromString, fromElement]) {
      assert.equal(graph.$_tag, "_hson_root");
      const wrapper = graph.$_content[0];
      assert.ok(wrapper !== undefined && is_node(wrapper));
      assert.equal(wrapper.$_tag, "_hson_elem");
      const structuralRoot = wrapper.$_content[0];
      assert.ok(structuralRoot !== undefined && is_node(structuralRoot));
      assert.equal(structuralRoot.$_tag, "button");
      const button = must_tag(graph, "button");
      const span = must_tag(graph, "span");
      assert.equal(read_hson_node_quid(button), Q4);
      assert.equal(read_hson_node_quid(span), Q5);
      assert.equal(button.$_attrs?.[HSON_META_QUID], undefined);
      assert.equal(span.$_attrs?.[HSON_META_QUID], undefined);
      assert.equal(button.$_attrs?.["data-user"], "kept");
      assert.equal(button.$_attrs?.["data-_quid"], "application");
      assert.equal(span.$_attrs?.["aria-label"], "child");
    }
    assert.deepEqual(fromElement, fromString);
    assert.equal(sourceElement.outerHTML, sourceBefore);
    assert.equal(get_node_by_quid(Q4), undefined);
    assert.equal(get_node_by_quid(Q5), undefined);

    const arrayWire = hson.fromJson([{}]).toHtml().serialize();
    const reparsedArray = exact_browser_html(arrayWire);
    const reparsedArrayElement = exact_browser_html(browser_source_element(arrayWire));
    assert.equal(must_tag(reparsedArray, "_hson_ii").$_meta?.[HSON_META_INDEX], "0");
    assert.deepEqual(reparsedArrayElement, reparsedArray);
  });
});

check("Transform queryDOM and queryBody remain intentional child-only snapshot helpers", () => {
  with_browser_ingress_dom(() => {
    const selected = browser_source_element(
      `<section data-root="selected">`
      + `<span data-child="kept">value</span>`
      + `</section>`,
    );
    const body = browser_source_element(
      `<body><article>body</article></body>`,
    );
    const selectedBefore = selected.outerHTML;
    const bodyBefore = body.outerHTML;
    const currentDocument = globalThis.document as Document & {
      body: Element;
      querySelector(selector: string): Element | null;
    };
    currentDocument.body = body as HTMLElement;
    currentDocument.querySelector = (selector: string): Element | null =>
      selector === "#selected" ? selected : null;

    const selectedSnapshot = UNSAFE_TRANSFORM_SOURCE.queryDOM("#selected").toNode();
    assert.equal(nodes(selectedSnapshot).some((node) => node.$_tag === "section"), false);
    assert.equal(read_hson_node_quid(must_tag(selectedSnapshot, "span")), undefined);
    assert.equal(must_tag(selectedSnapshot, "span").$_attrs?.["data-child"], "kept");

    const bodySnapshot = UNSAFE_TRANSFORM_SOURCE.queryBody().toNode();
    assert.equal(nodes(bodySnapshot).some((node) => node.$_tag === "body"), false);
    assert.equal(read_hson_node_quid(must_tag(bodySnapshot, "article")), undefined);

    assert.equal(selected.outerHTML, selectedBefore);
    assert.equal(body.outerHTML, bodyBefore);
    assert.equal(get_node_by_quid(Q4), undefined);
    assert.equal(get_node_by_quid(Q5), undefined);
    assert.equal(get_node_by_quid(Q6), undefined);
  });
});

check("browser SVG string and Element inputs preserve the supplied SVG root and equivalent protected identity", () => {
  with_browser_ingress_dom(() => {
    const markup =
      `<svg hson:quid="${Q4}" viewBox="0 0 10 10">`
      + `<path hson:quid="${Q5}" stroke-width="2"/>`
      + `</svg>`;
    const sourceElement = browser_source_element(markup);
    const sourceBefore = sourceElement.outerHTML;
    const fromString = exact_browser_html(markup);
    const fromElement = exact_browser_html(sourceElement);

    assert.deepEqual(fromElement, fromString);
    assert.equal(fromElement.$_tag, "svg");
    assert.equal(read_hson_node_quid(fromElement), Q4);
    assert.equal(read_hson_node_quid(must_tag(fromElement, "path")), Q5);
    assert.equal(fromElement.$_attrs?.[HSON_META_QUID], undefined);
    assert.equal(must_tag(fromElement, "path").$_attrs?.[HSON_META_QUID], undefined);
    assert.equal(fromElement.$_attrs?.viewBox, "0 0 10 10");
    assert.equal(must_tag(fromElement, "path").$_attrs?.["stroke-width"], "2");
    assert.equal(sourceElement.outerHTML, sourceBefore);
    assert.equal(get_node_by_quid(Q4), undefined);
    assert.equal(get_node_by_quid(Q5), undefined);
  });
});

check("XML-shaped Element input retains its supplied root and matches equivalent string structure", () => {
  with_browser_ingress_dom(() => {
    const markup =
      `<Catalog hson:quid="${Q4}" data-kind="root">`
      + `<Entry hson:quid="${Q5}" key="A">value</Entry>`
      + `</Catalog>`;
    const sourceElement = browser_source_element(markup);
    const sourceBefore = sourceElement.outerHTML;
    const fromString = exact_browser_html(markup);
    const fromElement = exact_browser_html(sourceElement);

    assert.deepEqual(fromElement, fromString);
    assert.equal(must_tag(fromElement, "catalog").$_attrs?.["data-kind"], "root");
    assert.equal(must_tag(fromElement, "entry").$_attrs?.key, "A");
    assert.equal(read_hson_node_quid(must_tag(fromElement, "catalog")), Q4);
    assert.equal(read_hson_node_quid(must_tag(fromElement, "entry")), Q5);
    assert.equal(sourceElement.outerHTML, sourceBefore);
  });
});

check("cold duplicate HTML string and Element graphs are equivalent but LiveTree admission rejects atomically", () => {
  with_browser_ingress_dom(() => {
    const markup =
      `<section><button hson:quid="${Q6}">A</button>`
      + `<button hson:quid="${Q6}">B</button></section>`;
    const sourceElement = browser_source_element(markup);
    const sourceBefore = sourceElement.outerHTML;
    const fromString = exact_browser_html(markup);
    const fromElement = exact_browser_html(sourceElement);
    assert.deepEqual(fromElement, fromString);
    assert.equal(
      nodes(fromString).filter((node) => read_hson_node_quid(node) === Q6).length,
      2,
    );
    assert.equal(get_node_by_quid(Q6), undefined);

    assert.throws(() => hsonLiveTree.fromTrustedHtml(markup), /Duplicate QUID/);
    assert.throws(() => hsonLiveTree.fromTrustedHtml(sourceElement), /Duplicate QUID/);
    assert.equal(get_node_by_quid(Q6), undefined);
    assert.equal(sourceElement.outerHTML, sourceBefore);
  });
});

check("LiveTree admission claims supplied descendants while preserving sparse absent descendants", () => {
  const source = document_root(element("main", Q4, [
    element("supplied", Q5),
    element("absent"),
  ]));
  const supplied = must_tag(source, "supplied");
  const absent = must_tag(source, "absent");
  const tree = make_branch_from_node(source);
  let absentHandle: LiveTree | undefined;
  try {
    assert.equal(read_hson_node_quid(tree.node), Q4);
    assert.equal(get_node_by_quid(Q4), tree.node);
    assert.equal(read_hson_node_quid(supplied), Q5);
    assert.equal(get_node_by_quid(Q5), supplied);
    assert.equal(read_hson_node_quid(absent), undefined);

    absentHandle = new LiveTree(absent);
    const laterQuid = read_hson_node_quid(absent);
    assert.equal(is_persisted_quid(laterQuid), true);
    assert.equal(get_node_by_quid(laterQuid!), absent);
  } finally {
    if (absentHandle !== undefined) destroy_subtree_quids(absentHandle.node);
    destroy_subtree_quids(tree.node);
  }
});

check("LiveTree detach retains ownership and terminal removal releases it", () => {
  const parent = make_branch_from_node(document_root(element("main")));
  const branch = make_branch_from_node(document_root(element("section", Q3)));
  try {
    parent.append(branch);
    assert.equal(get_node_by_quid(Q3), branch.node);
    assert.equal(branch.detach(), 1);
    assert.equal(read_hson_node_quid(branch.node), Q3);
    assert.equal(get_node_by_quid(Q3), branch.node);
    branch.remove();
    assert.equal(get_node_by_quid(Q3), undefined);
  } finally {
    destroy_subtree_quids(parent.node);
  }
});

check("unpublished generated collisions retry and exhaustion is atomic", () => {
  const owner = element("owner", Q1);
  ensure_quid(owner);
  const retried = element("retried");
  const successfulProfile = begin_livetree_materialization_profile();
  let retriedTree: LiveTree | undefined;
  let successfulCalls = 0;
  try {
    with_generated_candidates([1, 2], (calls) => {
      retriedTree = new LiveTree(retried);
      successfulCalls = calls();
    });
    const successfulMetrics = successfulProfile.stop();
    assert.equal(successfulCalls, 2);
    assert.equal(read_hson_node_quid(retried), Q2);
    assert.equal(get_node_by_quid(Q1), owner);
    assert.equal(get_node_by_quid(Q2), retried);
    assert.equal(successfulMetrics.quidEnsureCalls, 1);
    assert.equal(successfulMetrics.quidRegistryWrites, 2);
  } finally {
    successfulProfile.stop();
    if (retriedTree !== undefined) destroy_subtree_quids(retriedTree.node);
  }

  const exhausted = element("exhausted", undefined, [element("cold-supplied", Q7)]);
  const exhaustedBefore = structuredClone(exhausted);
  const exhaustedProfile = begin_livetree_materialization_profile();
  let exhaustedCalls = 0;
  try {
    with_generated_candidates([1], (calls) => {
      assert.throws(
        () => construct_exact_runtime_livetree(exhausted),
        new RegExp(`after ${LIVETREE_QUID_MINT_RETRY_LIMIT} secure attempts`),
      );
      exhaustedCalls = calls();
    });
    const exhaustedMetrics = exhaustedProfile.stop();
    assert.equal(exhaustedCalls, LIVETREE_QUID_MINT_RETRY_LIMIT);
    assert.deepEqual(exhausted, exhaustedBefore);
    assert.equal(get_node_by_quid(Q1), owner);
    assert.equal(get_node_by_quid(Q7), undefined);
    assert.equal(
      Object.values(exhaustedMetrics).every((value) => value === 0),
      true,
    );
  } finally {
    exhaustedProfile.stop();
    destroy_subtree_quids(owner);
  }
});

check("cold Element identity is claimed unchanged while absent identity is minted on materialization", () => {
  with_browser_ingress_dom(() => {
    const source = browser_source_element(
      `<button hson:quid="${Q8}" data-user="kept">Save</button>`,
    );
    const parsed = exact_browser_html(source);
    assert.equal(read_hson_node_quid(must_tag(parsed, "button")), Q8);
    assert.equal(get_node_by_quid(Q8), undefined);

    const claimed = hsonLiveTree.fromTrustedHtml(source);
    try {
      assert.equal(read_hson_node_quid(claimed.node), Q8);
      assert.equal(get_node_by_quid(Q8), claimed.node);
      assert.equal(claimed.node.$_attrs?.["data-user"], "kept");
    } finally {
      destroy_subtree_quids(claimed.node);
    }

    const absentSource = browser_source_element(`<button data-user="kept">Save</button>`);
    const coldAbsent = exact_browser_html(absentSource);
    assert.equal(read_hson_node_quid(must_tag(coldAbsent, "button")), undefined);
    const minted = hsonLiveTree.fromTrustedHtml(absentSource);
    try {
      const mintedQuid = read_hson_node_quid(minted.node);
      assert.equal(is_persisted_quid(mintedQuid), true);
      assert.equal(get_node_by_quid(mintedQuid!), minted.node);
      assert.equal(minted.node.$_attrs?.["data-user"], "kept");
    } finally {
      destroy_subtree_quids(minted.node);
    }
  });
});

check("actively owned Element identity rejects a second owner without mutation or remint", () => {
  with_browser_ingress_dom(() => {
    const source = browser_source_element(
      `<button hson:quid="${Q9}" data-user="kept">Save</button>`,
    );
    const owner = hsonLiveTree.fromTrustedHtml(
      `<button hson:quid="${Q9}" data-user="kept">Save</button>`,
    );
    const ownerBefore = structuredClone(owner.node);
    const sourceBefore = source.innerHTML;
    let second: ReturnType<typeof hsonLiveTree.fromTrustedHtml> | undefined;

    try {
      assert.throws(
        () => {
          second = hsonLiveTree.fromTrustedHtml(source);
        },
        /Duplicate QUID/,
      );
      assert.equal(second, undefined);
      assert.deepEqual(owner.node, ownerBefore);
      assert.equal(source.innerHTML, sourceBefore);
      assert.equal(read_hson_node_quid(owner.node), Q9);
      assert.equal(get_node_by_quid(Q9), owner.node);
    } finally {
      if (second !== undefined) destroy_subtree_quids(second.node);
      destroy_subtree_quids(owner.node);
    }
  });
});

check("cloneBranch keeps fresh identity semantics independently of Element ingestion", () => {
  with_browser_ingress_dom(() => {
    const source = hsonLiveTree.fromTrustedHtml(
      `<button hson:quid="${Q10}"><span hson:quid="${Q11}">Save</span></button>`,
    );
    const clone = source.cloneBranch();
    try {
      const sourceSpan = must_tag(source.node, "span");
      const cloneSpan = must_tag(clone.node, "span");
      assert.notEqual(read_hson_node_quid(clone.node), Q10);
      assert.notEqual(read_hson_node_quid(cloneSpan), Q11);
      assert.equal(is_persisted_quid(read_hson_node_quid(clone.node)), true);
      assert.equal(is_persisted_quid(read_hson_node_quid(cloneSpan)), true);
      for (const wrapper of nodes(clone.node).filter((node) => node.$_tag.startsWith("_hson_"))) {
        assert.equal(read_hson_node_quid(wrapper), undefined);
      }
      assert.equal(read_hson_node_quid(source.node), Q10);
      assert.equal(read_hson_node_quid(sourceSpan), Q11);
    } finally {
      destroy_subtree_quids(clone.node);
      destroy_subtree_quids(source.node);
    }
  });
});

check("VSN QUID eligibility has no projected-container exception", () => {
  const cleanVsn: HsonNode = { $_tag: "_hson_future", $_content: [] };
  assert.equal(read_hson_node_quid(cleanVsn), undefined);
  assert.throws(() => ensure_quid(cleanVsn), /ineligible/i);
  assert.throws(() => hsonTransform.fromHson(`<@${Q5}>`).toNode(), /runtime QUID metadata is invalid/);
  assert.throws(() => hsonTransform.fromHson(`«@${Q5}»`).toNode(), /runtime QUID metadata is invalid/);

  const validRaw = document_root(element("main", Q6));
  assert.equal(read_hson_node_quid(must_tag(validRaw, "main")), Q6);
  assert_portable_node_reject(() => hsonTransform.fromNode(validRaw));
  assert.equal(get_node_by_quid(Q6), undefined);

  const malformedRaw = document_root(element("main", "BAD"));
  assert_portable_node_reject(() => hsonTransform.fromNode(malformedRaw));
});

check("internal exact LiveMap installation remains cold while public raw admission rejects", () => {
  const valid = document_root(element("main", Q1, [element("p", Q2)]));
  const before = structuredClone(valid);
  assert_portable_node_reject(() => hsonLiveMap.fromNode(valid));
  const map = admit_exact_runtime_livemap_node(valid);
  assert.deepEqual(valid, before);
  assert.equal(map.mode, "document");
  assert.equal(map.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(map.document.byQuid(Q2)?.$_tag, "p");
  assert.equal(get_node_by_quid(Q1), undefined);
  assert.equal(get_node_by_quid(Q2), undefined);

  const duplicateCold = document_root(element("main", Q1, [element("aside", Q1)]));
  assert.equal(read_hson_node_quid(must_tag(duplicateCold, "main")), Q1);
  assert.equal(read_hson_node_quid(must_tag(duplicateCold, "aside")), Q1);
  assert.throws(
    () => admit_exact_runtime_livemap_node(duplicateCold),
    (error) => error instanceof Error
      && validation_cause(error)?.code === "DUPLICATE_QUID",
  );
  const invalidVsn = document_root(element("main", Q3));
  must_tag(invalidVsn, "_hson_elem").$_meta = { [HSON_META_QUID]: Q1 };
  assert.throws(
    () => admit_exact_runtime_livemap_node(invalidVsn),
    (error) => error instanceof Error
      && (validation_cause(error)?.code === "INELIGIBLE_QUID"
        || /quid must be a canonical persisted QUID on an eligible standard tag/.test(error.message)),
  );

  const crossMapSource = document_root(element("shared", Q6));
  const firstMap = admit_exact_runtime_livemap_node(crossMapSource);
  const secondMap = admit_exact_runtime_livemap_node(crossMapSource);
  assert.equal(firstMap.mode, "document");
  assert.equal(secondMap.mode, "document");
  assert.equal(firstMap.document.byQuid(Q6)?.$_tag, "shared");
  assert.equal(secondMap.document.byQuid(Q6)?.$_tag, "shared");
  assert.equal(get_node_by_quid(Q6), undefined);
});

check("failed document capture installation is atomic", () => {
  const target = admit_exact_runtime_livemap_node(document_root(element("main", Q1)));
  if (target.mode !== "document") throw new Error("expected element LiveMap");
  const source = admit_exact_runtime_livemap_node(document_root(element("section", Q2)));
  if (source.mode !== "document") throw new Error("expected element LiveMap");
  const invalidCapture = structuredClone(source.capture());
  const section = must_tag(invalidCapture.root, "section");
  section.$_content = [{
    $_tag: "_hson_elem",
    $_content: [element("aside", Q2)],
  }];
  const before = target.capture();
  assert.throws(
    () => target.install(invalidCapture),
    (error) => error instanceof Error
      && validation_cause(error)?.code === "DUPLICATE_QUID",
  );
  assert.deepEqual(target.capture(), before);
  assert.equal(target.rev, before.rev);
});

process.stdout.write(`# ${checks} HsonNode QUID ingress checks passed\n`);
testEvents.terminal("pass");
