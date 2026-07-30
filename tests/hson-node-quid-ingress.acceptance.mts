import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import { parseDocument } from "htmlparser2";
import { hson } from "../src/hson.ts";
import { hsonTransform } from "../src/api/transform/index.ts";
import { hsonLiveMap } from "../src/api/livemap/livemap.facade.ts";
import { hsonLiveTree } from "../src/api/livetree/livetree.facade.ts";
import { make_branch_from_node } from "../src/api/livetree/creation/create-branch.ts";
import { parse_hson } from "../src/api/transform/parsers/parse-hson.ts";
import { parse_html } from "../src/api/transform/parsers/parse-html.ts";
import { node_from_svg, SVG_NS } from "../src/api/transform/utils/node-utils/node-from-svg.ts";
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
import { LiveTree } from "../src/api/livetree/livetree.ts";
import { begin_livetree_materialization_profile } from "../src/api/livetree/debug/materialization-profile.ts";

const Q1 = "0000000000000001";
const Q2 = "0000000000000002";
const Q3 = "0000000000000003";
const Q4 = "0000000000000004";
const Q5 = "0000000000000005";
const Q6 = "0000000000000006";
const QUID_ATTR = "hson:quid";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
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
    $_content: [{ $_tag: "_hson_elem", $_content: children }],
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
        array[array.length - 1] = finalBytes[Math.min(callCount, finalBytes.length - 1)] ?? 0;
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

check("HSON canonical @quid attaches protected metadata", () => {
  const canonical = must_tag(parse_hson(`<main @${Q1}/>`), "main");
  assert.equal(read_hson_node_quid(canonical), Q1);
  assert.equal(canonical.$_attrs?.[HSON_META_QUID], undefined);
  assert.equal(canonical.$_meta?.[HSON_META_QUID], Q1);
});

check("HSON rejects malformed length, alphabet, and uppercase without normalization", () => {
  for (const malformed of [
    "000000000000001",
    "000000000000000i",
    "000000000000000A",
  ]) {
    assert.throws(() => parse_hson(`<main @${malformed}/>`), /invalid persisted QUID/);
  }
});

check("HSON rejects QUID annotations on every expressible current VSN form", () => {
  for (const tag of [
    "_hson_root",
    "_hson_obj",
    "_hson_arr",
    "_hson_ii",
    "_hson_elem",
    "_hson_str",
    "_hson_val",
  ]) {
    const cause = assert_validation_code(
      () => parse_hson(`<${tag} @${Q1}/>`),
      "INELIGIBLE_QUID",
    );
    assert.equal(cause.node.$_tag, tag);
  }
});

check("HSON cold parsing preserves sibling and nested duplicate canonical claims", () => {
  const sibling = parse_hson(`<a @${Q1}/> <b @${Q1}/>`);
  assert.deepEqual(
    nodes(sibling).filter((node) => read_hson_node_quid(node) === Q1).map((node) => node.$_tag),
    ["a", "b"],
  );
  const nested = parse_hson(`<a @${Q1} <b @${Q1}/>/>`);
  assert.equal(read_hson_node_quid(must_tag(nested, "a")), Q1);
  assert.equal(read_hson_node_quid(must_tag(nested, "b")), Q1);
  assert.equal(get_node_by_quid(Q1), undefined);
});

check("HSON accepts distinct or absent identity and parsing stays cold", () => {
  const distinct = parse_hson(`<a @${Q1}/> <b @${Q2}/>`);
  assert.equal(read_hson_node_quid(must_tag(distinct, "a")), Q1);
  assert.equal(read_hson_node_quid(must_tag(distinct, "b")), Q2);
  assert.equal(read_hson_node_quid(must_tag(parse_hson(`<main/>`), "main")), undefined);
  assert.equal(get_node_by_quid(Q1), undefined);
  assert.equal(get_node_by_quid(Q2), undefined);
});

check("HTML hson:quid becomes metadata while hson-foo and every data-* spelling remain ordinary", () => {
  const root = hsonTransform
    .fromTrustedHtml(`<main hson:quid="${Q1}" hson-foo="ordinary" data-_quid="application" data-_index="also-application" data-user="kept"/>`)
    .toNode();
  const main = must_tag(root, "main");
  assert.equal(main.$_meta?.[HSON_META_QUID], Q1);
  assert.equal(main.$_attrs?.[HSON_META_QUID], undefined);
  assert.equal(main.$_attrs?.["data-_quid"], "application");
  assert.equal(main.$_attrs?.["data-_index"], "also-application");
  assert.equal(main.$_attrs?.["data-user"], "kept");
  assert.equal(main.$_attrs?.["hson-foo"], "ordinary");
  assert.equal(get_node_by_quid(Q1), undefined);

  const untrusted = hsonTransform
    .fromUntrustedHtml(`<main data-_quid="application" data-_index="ordinary"/>`)
    .toNode();
  assert.equal(must_tag(untrusted, "main").$_attrs?.["data-_quid"], "application");
  assert.equal(must_tag(untrusted, "main").$_attrs?.["data-_index"], "ordinary");
});

check("HTML rejects unknown hson:* metadata while data-_custom remains ordinary", () => {
  for (const parse of [
    () => hsonTransform.fromTrustedHtml(`<main><span hson:unknown="invalid"/></main>`),
    () => hsonTransform.fromUntrustedHtml(`<main><span hson:unknown="invalid"/></main>`),
    () => hsonTransform.fromTrustedHtml(`<svg><path hson:unknown="invalid"/></svg>`),
    () => hsonTransform.fromTrustedHtml(`<main _hson_meta_attr_v2_71756964="${Q1}"/>`),
  ]) {
    assert.throws(parse, /unknown HSON metadata markup name "hson:unknown"|externally authored private HSON metadata transit name/);
  }
  const ordinary = hsonTransform.fromTrustedHtml(
    `<main data-_custom="ordinary"/>`,
  ).toNode();
  assert.equal(must_tag(ordinary, "main").$_attrs?.["data-_custom"], "ordinary");
});

check("trusted and untrusted HTML reject malformed protected metadata through the shared rule", () => {
  for (const parse of [
    () => hsonTransform.fromTrustedHtml(`<main hson:quid="bad"/>`),
    () => hsonTransform.fromUntrustedHtml(`<main hson:quid="bad"/>`),
  ]) {
    assert.throws(parse, /invalid value for HSON metadata "hson:quid"/);
  }
});

check("HTML cold transforms preserve sibling and nested duplicate canonical claims", () => {
  const sibling = hsonTransform.fromTrustedHtml(
    `<main hson:quid="${Q1}"/><aside hson:quid="${Q1}"/>`,
  ).toNode();
  assert.equal(read_hson_node_quid(must_tag(sibling, "main")), Q1);
  assert.equal(read_hson_node_quid(must_tag(sibling, "aside")), Q1);
  const nested = hsonTransform.fromTrustedHtml(
    `<main hson:quid="${Q1}"><aside hson:quid="${Q1}"/></main>`,
  ).toNode();
  assert.equal(read_hson_node_quid(must_tag(nested, "main")), Q1);
  assert.equal(read_hson_node_quid(must_tag(nested, "aside")), Q1);
  assert.equal(get_node_by_quid(Q1), undefined);
});

check("HTML accepts distinct claims through both trust facades", () => {
  for (const source of [
    hsonTransform.fromTrustedHtml(
      `<main hson:quid="${Q1}"/><aside hson:quid="${Q2}"/>`,
    ),
    hsonTransform.fromUntrustedHtml(
      `<main hson:quid="${Q1}"/><aside hson:quid="${Q2}"/>`,
    ),
  ]) {
    assert.equal(must_tag(source.toNode(), "main").$_meta?.[HSON_META_QUID], Q1);
    assert.equal(must_tag(source.toNode(), "aside").$_meta?.[HSON_META_QUID], Q2);
  }
});

check("standalone SVG text preserves protected QUID metadata and ordinary SVG attributes", () => {
  const svg = hsonTransform
    .fromTrustedHtml(
      `<svg hson:quid="${Q1}" viewBox="0 0 10 10" xmlns:xlink="http://www.w3.org/1999/xlink"><path stroke-width="2"/></svg>`,
    )
    .toNode();
  assert.equal(svg.$_tag, "svg");
  assert.equal(svg.$_meta?.[HSON_META_QUID], Q1);
  assert.equal(svg.$_attrs?.[HSON_META_QUID], undefined);
  assert.equal(svg.$_attrs?.viewBox, "0 0 10 10");
  assert.equal(svg.$_attrs?.["xmlns:xlink"], "http://www.w3.org/1999/xlink");
  assert.equal(must_tag(svg, "path").$_attrs?.["stroke-width"], "2");
});

check("standalone SVG text rejects malformed identity and preserves duplicate canonical claims", () => {
  assert.throws(
    () => hsonTransform.fromTrustedHtml(`<svg hson:quid="bad"/>`),
    /invalid value for HSON metadata "hson:quid"/,
  );
  const duplicate = hsonTransform.fromTrustedHtml(
    `<svg><path hson:quid="${Q1}"/><circle hson:quid="${Q1}"/></svg>`,
  ).toNode();
  assert.equal(read_hson_node_quid(must_tag(duplicate, "path")), Q1);
  assert.equal(read_hson_node_quid(must_tag(duplicate, "circle")), Q1);
});

check("SVG DOM ingestion applies the same metadata route without changing namespaces", () => {
  with_dom_node_constants(() => {
    const path = dom_element({
      tag: "path",
      namespace: SVG_NS,
      attrs: [
        { name: QUID_ATTR, value: Q2 },
        { name: "stroke-width", value: "2" },
      ],
    });
    const svg = dom_element({
      tag: "svg",
      namespace: SVG_NS,
      attrs: [
        { name: QUID_ATTR, value: Q1 },
        { name: "viewBox", value: "0 0 10 10" },
        { name: "xmlns:xlink", value: "http://www.w3.org/1999/xlink" },
      ],
      children: [path as unknown as Record<string, unknown>, text_node(" ")],
    });
    const root = node_from_svg(svg);
    assert.equal(root.$_meta?.[HSON_META_QUID], Q1);
    assert.equal(root.$_attrs?.[HSON_META_QUID], undefined);
    assert.equal(root.$_attrs?.viewBox, "0 0 10 10");
    assert.equal(root.$_attrs?.["xmlns:xlink"], "http://www.w3.org/1999/xlink");
    const parsedPath = must_tag(root, "path");
    assert.equal(parsedPath.$_meta?.[HSON_META_QUID], Q2);
    assert.equal(parsedPath.$_attrs?.["stroke-width"], "2");
  });
});

check("SVG DOM ingestion rejects unknown hson:* and preserves data-* as ordinary", () => {
  with_dom_node_constants(() => {
    assert.throws(
      () => node_from_svg(dom_element({
        tag: "svg",
        namespace: SVG_NS,
        children: [dom_element({
          tag: "path",
          namespace: SVG_NS,
          attrs: [{ name: "hson:unknown", value: "invalid" }],
        }) as unknown as Record<string, unknown>],
      })),
      /unknown HSON metadata markup name "hson:unknown"/,
    );
    assert.throws(
      () => node_from_svg(dom_element({
        tag: "svg",
        namespace: SVG_NS,
        attrs: [{ name: "_hson_meta_attr_v2_71756964", value: Q1 }],
      })),
      /private HSON metadata transit name/,
    );
    const ordinary = node_from_svg(dom_element({
      tag: "svg",
      namespace: SVG_NS,
      attrs: [{ name: "data-_custom", value: "ordinary" }],
    }));
    assert.equal(ordinary.$_attrs?.["data-_custom"], "ordinary");
  });
});

check("SVG DOM ingestion rejects malformed placement and preserves duplicate canonical identity", () => {
  with_dom_node_constants(() => {
    assert.throws(
      () => node_from_svg(dom_element({
        tag: "svg",
        namespace: SVG_NS,
        attrs: [{ name: QUID_ATTR, value: "bad" }],
      })),
      /invalid value for HSON metadata "hson:quid"/,
    );
    assert.throws(
      () => node_from_svg(dom_element({
        tag: "_hson_future",
        namespace: SVG_NS,
        attrs: [{ name: QUID_ATTR, value: Q1 }],
      })),
      /metadata "quid" is not defined for node "_hson_future"/,
    );
    const duplicate = dom_element({
      tag: "svg",
      namespace: SVG_NS,
      children: [
        dom_element({
          tag: "path",
          namespace: SVG_NS,
          attrs: [{ name: QUID_ATTR, value: Q1 }],
        }) as unknown as Record<string, unknown>,
        dom_element({
          tag: "circle",
          namespace: SVG_NS,
          attrs: [{ name: QUID_ATTR, value: Q1 }],
        }) as unknown as Record<string, unknown>,
      ],
    });
    const parsed = node_from_svg(duplicate);
    assert.equal(read_hson_node_quid(must_tag(parsed, "path")), Q1);
    assert.equal(read_hson_node_quid(must_tag(parsed, "circle")), Q1);
  });
});

check("DOM/XML element ingestion shares HTML protected metadata and completed scan rules", () => {
  with_dom_node_constants(() => {
    assert.throws(
      () => parse_html(dom_element({
        tag: "_hson_future",
        attrs: [{ name: QUID_ATTR, value: Q1 }],
      })),
      /metadata "quid" is not defined for node "_hson_future"/,
    );
    const child = dom_element({
      tag: "entry",
      attrs: [
        { name: QUID_ATTR, value: Q2 },
        { name: "data-user", value: "kept" },
      ],
    });
    const input = dom_element({
      tag: "catalog",
      attrs: [{ name: QUID_ATTR, value: Q1 }],
      children: [child as unknown as Record<string, unknown>],
    });
    const root = parse_html(input);
    assert.equal(must_tag(root, "catalog").$_meta?.[HSON_META_QUID], Q1);
    const entry = must_tag(root, "entry");
    assert.equal(entry.$_meta?.[HSON_META_QUID], Q2);
    assert.equal(entry.$_attrs?.[HSON_META_QUID], undefined);
    assert.equal(entry.$_attrs?.["data-user"], "kept");

    const duplicate = dom_element({
      tag: "catalog",
      attrs: [{ name: QUID_ATTR, value: Q1 }],
      children: [
        dom_element({
          tag: "entry",
          attrs: [{ name: QUID_ATTR, value: Q1 }],
        }) as unknown as Record<string, unknown>,
      ],
    });
    const duplicateRoot = parse_html(duplicate);
    assert.equal(read_hson_node_quid(must_tag(duplicateRoot, "catalog")), Q1);
    assert.equal(read_hson_node_quid(must_tag(duplicateRoot, "entry")), Q1);
  });
});

check("all public transform graph facades agree on valid and malformed metadata", () => {
  const validNodes = [
    hsonTransform.fromHson(`<main @${Q1}/>`).toNode(),
    hsonTransform.fromTrustedHtml(`<main hson:quid="${Q1}"/>`).toNode(),
    hsonTransform.fromUntrustedHtml(`<main hson:quid="${Q1}"/>`).toNode(),
    hsonTransform.fromNode(document_root(element("main", Q1))).toNode(),
  ];
  for (const root of validNodes) {
    assert.equal(must_tag(root, "main").$_meta?.[HSON_META_QUID], Q1);
  }

  assert.throws(
    () => hsonTransform.fromHson(`<main @bad/>`).toNode(),
    /invalid persisted QUID/,
  );
  for (const invalid of [
    () => hsonTransform.fromTrustedHtml(`<main hson:quid="bad"/>`).toNode(),
    () => hsonTransform.fromUntrustedHtml(`<main hson:quid="bad"/>`).toNode(),
  ]) assert.throws(invalid, /invalid value for HSON metadata "hson:quid"/);
  assert_validation_code(
    () => hsonTransform.fromNode(document_root(element("main", "bad"))).toNode(),
    "MALFORMED_QUID",
  );
});

check("raw validated fromNode rejects VSN placement but preserves duplicate canonical claims", () => {
  const invalidVsn = document_root(element("main", Q1));
  invalidVsn.$_meta = { [HSON_META_QUID]: Q2 };
  const beforeVsn = structuredClone(invalidVsn);
  assert_validation_code(
    () => hsonTransform.fromNode(invalidVsn),
    "INELIGIBLE_QUID",
  );
  assert.deepEqual(invalidVsn, beforeVsn);

  const duplicate = document_root(element("main", Q1, [element("aside", Q1)]));
  const beforeDuplicate = structuredClone(duplicate);
  const coldDuplicate = hsonTransform.fromNode(duplicate).toNode();
  assert.equal(read_hson_node_quid(must_tag(coldDuplicate, "main")), Q1);
  assert.equal(read_hson_node_quid(must_tag(coldDuplicate, "aside")), Q1);
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

    const fromString = hson.fromTrustedHtml(markup).toNode();
    const fromElement = hson.fromTrustedHtml(sourceElement).toNode();

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
    const reparsedArray = hson.fromTrustedHtml(arrayWire).toNode();
    const reparsedArrayElement = hson.fromTrustedHtml(browser_source_element(arrayWire)).toNode();
    assert.equal(must_tag(reparsedArray, "_hson_ii").$_meta?.[HSON_META_INDEX], "0");
    assert.deepEqual(reparsedArrayElement, reparsedArray);
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
    const fromString = hson.fromTrustedHtml(markup).toNode();
    const fromElement = hson.fromTrustedHtml(sourceElement).toNode();

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
    const fromString = hson.fromTrustedHtml(markup).toNode();
    const fromElement = hson.fromTrustedHtml(sourceElement).toNode();

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
    const fromString = hson.fromTrustedHtml(markup).toNode();
    const fromElement = hson.fromTrustedHtml(sourceElement).toNode();
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
    assert.equal(branch.remove(), 1);
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

  const exhausted = element("exhausted", undefined, [element("cold-supplied", Q4)]);
  const exhaustedBefore = structuredClone(exhausted);
  const exhaustedProfile = begin_livetree_materialization_profile();
  let exhaustedCalls = 0;
  try {
    with_generated_candidates([1], (calls) => {
      assert.throws(
        () => new LiveTree(exhausted),
        new RegExp(`after ${LIVETREE_QUID_MINT_RETRY_LIMIT} secure attempts`),
      );
      exhaustedCalls = calls();
    });
    const exhaustedMetrics = exhaustedProfile.stop();
    assert.equal(exhaustedCalls, LIVETREE_QUID_MINT_RETRY_LIMIT);
    assert.deepEqual(exhausted, exhaustedBefore);
    assert.equal(get_node_by_quid(Q1), owner);
    assert.equal(get_node_by_quid(Q4), undefined);
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
      `<button hson:quid="${Q4}" data-user="kept">Save</button>`,
    );
    const parsed = hson.fromTrustedHtml(source).toNode();
    assert.equal(read_hson_node_quid(must_tag(parsed, "button")), Q4);
    assert.equal(get_node_by_quid(Q4), undefined);

    const claimed = hsonLiveTree.fromTrustedHtml(source);
    try {
      assert.equal(read_hson_node_quid(claimed.node), Q4);
      assert.equal(get_node_by_quid(Q4), claimed.node);
      assert.equal(claimed.node.$_attrs?.["data-user"], "kept");
    } finally {
      destroy_subtree_quids(claimed.node);
    }

    const absentSource = browser_source_element(`<button data-user="kept">Save</button>`);
    const coldAbsent = hson.fromTrustedHtml(absentSource).toNode();
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
      `<button hson:quid="${Q4}" data-user="kept">Save</button>`,
    );
    const owner = hsonLiveTree.fromTrustedHtml(
      `<button hson:quid="${Q4}" data-user="kept">Save</button>`,
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
      assert.equal(read_hson_node_quid(owner.node), Q4);
      assert.equal(get_node_by_quid(Q4), owner.node);
    } finally {
      if (second !== undefined) destroy_subtree_quids(second.node);
      destroy_subtree_quids(owner.node);
    }
  });
});

check("cloneBranch keeps fresh identity semantics independently of Element ingestion", () => {
  with_browser_ingress_dom(() => {
    const source = hsonLiveTree.fromTrustedHtml(
      `<button hson:quid="${Q4}"><span hson:quid="${Q5}">Save</span></button>`,
    );
    const clone = source.cloneBranch();
    try {
      const sourceSpan = must_tag(source.node, "span");
      const cloneSpan = must_tag(clone.node, "span");
      assert.notEqual(read_hson_node_quid(clone.node), Q4);
      assert.notEqual(read_hson_node_quid(cloneSpan), Q5);
      assert.equal(is_persisted_quid(read_hson_node_quid(clone.node)), true);
      assert.equal(is_persisted_quid(read_hson_node_quid(cloneSpan)), true);
      for (const wrapper of nodes(clone.node).filter((node) => node.$_tag.startsWith("_hson_"))) {
        assert.equal(read_hson_node_quid(wrapper), undefined);
      }
      assert.equal(read_hson_node_quid(source.node), Q4);
      assert.equal(read_hson_node_quid(sourceSpan), Q5);
    } finally {
      destroy_subtree_quids(clone.node);
      destroy_subtree_quids(source.node);
    }
  });
});

check("VSN eligibility and validated raw HsonNode ingress remain unchanged", () => {
  const cleanVsn: HsonNode = { $_tag: "_hson_future", $_content: [] };
  assert.equal(read_hson_node_quid(cleanVsn), undefined);
  assert.throws(() => ensure_quid(cleanVsn), /ineligible/i);

  const validRaw = document_root(element("main", Q6));
  assert.equal(
    read_hson_node_quid(must_tag(hsonTransform.fromNode(validRaw).toNode(), "main")),
    Q6,
  );
  assert.equal(get_node_by_quid(Q6), undefined);

  const malformedRaw = document_root(element("main", "BAD"));
  assert_validation_code(
    () => hsonTransform.fromNode(malformedRaw),
    "MALFORMED_QUID",
  );
});

check("LiveMap raw installation validates all modes, remains cold, and leaves sources detached", () => {
  const valid = document_root(element("main", Q1, [element("p", Q2)]));
  const before = structuredClone(valid);
  const map = hsonLiveMap.fromNode(valid);
  assert.deepEqual(valid, before);
  assert.equal(map.mode, "element");
  assert.equal(map.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(map.document.byQuid(Q2)?.$_tag, "p");
  assert.equal(get_node_by_quid(Q1), undefined);
  assert.equal(get_node_by_quid(Q2), undefined);

  const duplicateCold = hsonTransform.fromNode(
    document_root(element("main", Q1, [element("aside", Q1)])),
  ).toNode();
  assert.equal(read_hson_node_quid(must_tag(duplicateCold, "main")), Q1);
  assert.equal(read_hson_node_quid(must_tag(duplicateCold, "aside")), Q1);
  assert.throws(
    () => hsonLiveMap.fromNode(duplicateCold),
    (error) => error instanceof Error
      && validation_cause(error)?.code === "DUPLICATE_QUID",
  );
  const invalidVsn = document_root(element("main", Q3));
  must_tag(invalidVsn, "_hson_elem").$_meta = { [HSON_META_QUID]: Q1 };
  assert.throws(
    () => hsonLiveMap.fromNode(invalidVsn),
    (error) => error instanceof Error
      && validation_cause(error)?.code === "INELIGIBLE_QUID",
  );

  const crossMapSource = document_root(element("shared", Q6));
  const firstMap = hsonLiveMap.fromNode(crossMapSource);
  const secondMap = hsonLiveMap.fromNode(crossMapSource);
  assert.equal(firstMap.mode, "element");
  assert.equal(secondMap.mode, "element");
  assert.equal(firstMap.document.byQuid(Q6)?.$_tag, "shared");
  assert.equal(secondMap.document.byQuid(Q6)?.$_tag, "shared");
  assert.equal(get_node_by_quid(Q6), undefined);
});

check("failed document capture installation is atomic", () => {
  const target = hsonLiveMap.fromNode(document_root(element("main", Q1)));
  if (target.mode !== "element") throw new Error("expected element LiveMap");
  const source = hsonLiveMap.fromNode(document_root(element("section", Q2)));
  if (source.mode !== "element") throw new Error("expected element LiveMap");
  const invalidCapture = structuredClone(source.capture());
  const section = must_tag(invalidCapture.root, "section");
  section.$_content.push(element("aside", Q2));
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
emit_hson_live_test_completion("transform.hson-node-quid-ingress", checks, checks, 0);
