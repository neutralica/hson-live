import { isTag, isText, type ChildNode, type Element } from "domhandler";
import { parseDocument } from "htmlparser2";
import { assert_invariants } from "../../../core/assert-invariants.js";
import {
  ARR_TAG,
  ELEM_TAG,
  EVERY_VSN,
  HSON_SYS_PREFIX,
  HTML_KEY_PREFIX,
  II_TAG,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  VAL_TAG,
  _DATA_INDEX,
  _DATA_QUID,
  _TRANSIT_PREFIX,
} from "../../../core/constants.js";
import { CREATE_NODE } from "../../../core/factories.js";
import { is_indexed } from "../../../core/node-guards.js";
import { is_persisted_quid } from "../../../core/persisted-quid.js";
import type { HsonAttrs, HsonMeta, HsonNode, Primitive } from "../../../core/types.js";
import { normalize_attr_ws } from "../utils/attrs-utils/normalize_attrs_ws.js";
import { parse_style_string } from "../utils/attrs-utils/parse-style.js";
import { decode_html_key_tag } from "../utils/html-utils/encode-html-tag.js";
import { coerce } from "../utils/primitive-utils/coerce-string.utils.js";
import { _throw_transform_err } from "../utils/sys-utils/throw-transform-err.utils.js";

const ALLOWED_ATTRS = new Set([
  "href",
  "src",
  "srcset",
  "sizes",
  "alt",
  "title",
  "id",
  "class",
  "role",
  "aria-label",
  "aria-hidden",
  "aria-expanded",
  "aria-controls",
  "target",
  "rel",
  "loading",
  "decoding",
]);

const FORBIDDEN_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "svg",
  "math",
  "video",
  "audio",
]);

const ALLOWED_URI = /^(?:https?:|mailto:|tel:|data:image\/)/i;
const URI_ATTR = /^(?:href|src|xlink:href|poster)$/i;

function sanitized_attribute(name: string, value: string): boolean {
  const lower = name.toLowerCase();
  if (lower === "style" || lower === "srcdoc" || lower.startsWith("on")) return false;
  if (!ALLOWED_ATTRS.has(lower) && !lower.startsWith("data-")) return false;
  if (URI_ATTR.test(lower)) return ALLOWED_URI.test(value);
  if (lower !== "srcset") return true;

  return value
    .split(/\s*,\s*/)
    .every((candidate) => ALLOWED_URI.test(candidate.trim().split(/\s+/)[0] ?? ""));
}

function attributes_from_element(
  element: Element,
  sanitize: boolean,
  svg: boolean,
): { attrs: HsonAttrs; meta?: HsonMeta } {
  const attrs: HsonAttrs = {};
  let meta: HsonMeta | undefined;

  for (const [authoredName, value] of Object.entries(element.attribs)) {
    const lower = authoredName.toLowerCase();
    const key = svg ? authoredName : lower;
    if (sanitize && !sanitized_attribute(lower, value)) continue;
    if (lower.startsWith(_TRANSIT_PREFIX)) continue;
    if (lower === "xmlns" || lower.startsWith("xmlns:") || lower.startsWith("xml:")) continue;

    if (lower === _DATA_INDEX) {
      (meta ??= {})[_DATA_INDEX] = value;
      continue;
    }

    if (lower === _DATA_QUID) {
      if (!is_persisted_quid(value)) {
        _throw_transform_err("invalid persisted QUID in HTML input", "parse-html-string", value);
      }
      (meta ??= {})[_DATA_QUID] = value;
      continue;
    }

    if (lower === "style") {
      attrs.style = parse_style_string(value);
      continue;
    }

    const normalizedKey = lower === "xlink:href" ? "href" : key;
    if (normalizedKey === "href" && lower === "xlink:href" && attrs.href !== undefined) continue;
    attrs[normalizedKey] =
      value === "" || value === authoredName || value === lower
        ? normalizedKey
        : normalize_attr_ws(value);
  }

  if (sanitize && attrs.target === "_blank") {
    const rel = typeof attrs.rel === "string" ? attrs.rel : "";
    attrs.rel = [...new Set([...rel.split(/\s+/).filter(Boolean), "noopener", "noreferrer"])].join(" ");
  }

  return {
    attrs,
    ...(meta === undefined ? {} : { meta }),
  };
}

function text_content(children: ChildNode[]): string {
  let content = "";
  for (const child of children) {
    if (isText(child)) content += child.data;
    else if (isTag(child)) content += text_content(child.children);
  }
  return content;
}

function child_values(
  children: ChildNode[],
  parentTag: string,
  sanitize: boolean,
  svgContext = false,
): (HsonNode | string)[] {
  const values: (HsonNode | string)[] = [];

  for (const child of children) {
    if (isTag(child)) {
      const converted = element_to_hson(child, parentTag, sanitize, svgContext);
      if (converted !== undefined) values.push(converted);
      continue;
    }

    if (!isText(child)) continue;
    const raw = child.data;
    const trimmed = raw.trim();

    if (trimmed === '""') {
      values.push(CREATE_NODE({ $_tag: STR_TAG, $_content: [""] }));
      continue;
    }

    if (parentTag === OBJ_TAG) {
      const unboxed = raw.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
      if (unboxed.length > 0) values.push(unboxed);
      continue;
    }

    if (trimmed.length > 0) values.push(trimmed);
  }

  return values;
}

function element_to_hson(
  element: Element,
  parentTag: string | undefined,
  sanitize: boolean,
  svgContext = false,
): HsonNode | undefined {
  const tagLower = element.name.toLowerCase();
  if (sanitize && FORBIDDEN_TAGS.has(tagLower)) return undefined;
  const svg = svgContext || tagLower === "svg";

  const encoded = tagLower.startsWith(HTML_KEY_PREFIX);
  const tag = decode_html_key_tag(tagLower);
  if (encoded && parentTag !== OBJ_TAG) {
    _throw_transform_err(
      `encoded HTML tag prefix "${HTML_KEY_PREFIX}" is only allowed under ${OBJ_TAG}`,
      "parse-html-string",
    );
  }
  if (tag === STR_TAG) {
    _throw_transform_err("literal <_hson_str> is not allowed in input HTML", "parse-html-string");
  }
  if (tag.startsWith(HSON_SYS_PREFIX) && !EVERY_VSN.includes(tag)) {
    _throw_transform_err(`unknown VSN-like tag: <${tag}>`, "parse-html-string");
  }

  const { attrs, meta } = attributes_from_element(element, sanitize, svg);

  if ((tag === "style" || tag === "script") && !sanitize) {
    let content = text_content(element.children).trim();
    if (content.startsWith("<![CDATA[")) {
      const end = content.indexOf("]]>");
      if (end === -1) {
        _throw_transform_err("Malformed CDATA block: missing closing ']]>'", "parse-html-string");
      }
      content = content.slice("<![CDATA[".length, end);
    }
    if (content.length > 0) {
      return CREATE_NODE({
        $_tag: tag,
        $_attrs: attrs,
        $_meta: meta,
        $_content: [
          CREATE_NODE({
            $_tag: ELEM_TAG,
            $_content: [CREATE_NODE({ $_tag: STR_TAG, $_content: [content] })],
          }),
        ],
      });
    }
  }

  const values = child_values(element.children, tag, sanitize, svg);
  const childNodes: HsonNode[] = values.map((value) =>
    typeof value === "string"
      ? CREATE_NODE({ $_tag: STR_TAG, $_content: [value] })
      : value,
  );

  if (tag === VAL_TAG) {
    if (values.length !== 1) {
      _throw_transform_err("<_hson_val> must contain exactly one value", "parse-html-string");
    }
    const value = values[0];
    let primitive: Primitive | undefined;
    if (typeof value === "string") {
      primitive = coerce(value);
    } else if (value.$_tag === VAL_TAG || value.$_tag === STR_TAG) {
      const payload = value.$_content[0];
      if (typeof payload === "string") primitive = coerce(payload);
      else if (
        payload === null ||
        typeof payload === "boolean" ||
        typeof payload === "number"
      ) {
        primitive = payload;
      }
    }
    if (primitive === undefined || typeof primitive === "string") {
      _throw_transform_err("<_hson_val> must contain a non-string primitive", "parse-html-string");
    }
    return CREATE_NODE({ $_tag: VAL_TAG, $_content: [primitive] });
  }

  if (tag === OBJ_TAG) return CREATE_NODE({ $_tag: OBJ_TAG, $_content: childNodes });
  if (tag === ARR_TAG) {
    if (!childNodes.every(is_indexed)) {
      _throw_transform_err("_hson_array children are not valid index tags", "parse-html-string");
    }
    return CREATE_NODE({ $_tag: ARR_TAG, $_content: childNodes });
  }
  if (tag === II_TAG) {
    if (childNodes.length !== 1) {
      _throw_transform_err("<_hson_ii> must have exactly one child", "parse-html-string");
    }
    return CREATE_NODE({ $_tag: II_TAG, $_content: [childNodes[0]], $_meta: meta });
  }
  if (tag === ELEM_TAG) {
    _throw_transform_err("_hson_elem tag found in html", "parse-html-string");
  }

  const content =
    childNodes.length === 1 &&
    (childNodes[0].$_tag === OBJ_TAG ||
      childNodes[0].$_tag === ARR_TAG ||
      childNodes[0].$_tag === ELEM_TAG)
      ? childNodes
      : [CREATE_NODE({ $_tag: ELEM_TAG, $_content: childNodes })];

  return CREATE_NODE({
    $_tag: tag,
    $_attrs: attrs,
    $_meta: meta,
    $_content: content,
  });
}

function root_from_children(children: ChildNode[], sanitize: boolean): HsonNode {
  const values = child_values(children, ELEM_TAG, sanitize);
  const nodes = values.map((value) =>
    typeof value === "string"
      ? CREATE_NODE({ $_tag: STR_TAG, $_content: [value] })
      : value,
  );

  if (
    nodes.length === 1 &&
    (nodes[0].$_tag === ROOT_TAG ||
      nodes[0].$_tag === OBJ_TAG ||
      nodes[0].$_tag === ARR_TAG ||
      nodes[0].$_tag === ELEM_TAG)
  ) {
    const only = nodes[0];
    return only.$_tag === ROOT_TAG
      ? only
      : CREATE_NODE({ $_tag: ROOT_TAG, $_content: [only] });
  }

  return CREATE_NODE({
    $_tag: ROOT_TAG,
    $_content: [CREATE_NODE({ $_tag: ELEM_TAG, $_content: nodes })],
  });
}

function standalone_svg_node(element: Element): HsonNode {
  const children: HsonNode[] = [];
  for (const child of element.children) {
    if (isTag(child)) children.push(standalone_svg_node(child));
    else if (isText(child) && child.data.length > 0) {
      children.push(CREATE_NODE({ $_tag: STR_TAG, $_content: [child.data] }));
    }
  }

  return CREATE_NODE({
    $_tag: element.name,
    $_attrs: { ...element.attribs },
    $_content: children,
  });
}

function root_is_empty(root: HsonNode): boolean {
  const only = root.$_content[0];
  return (
    typeof only === "object" &&
    only !== null &&
    only.$_tag === ELEM_TAG &&
    only.$_content.length === 0
  );
}

/**
 * Parse an HTML string without browser globals. When `sanitize` is true, the
 * parsed tree is filtered before it is converted into canonical HSON.
 */
export function parse_html_string(input: string, sanitize: boolean): HsonNode {
  const document = parseDocument(input, {
    decodeEntities: true,
    lowerCaseAttributeNames: false,
    lowerCaseTags: false,
    recognizeSelfClosing: true,
  });
  if (!sanitize && /^<\s*svg[\s>]/i.test(input.trimStart())) {
    const svg = document.children.find(isTag);
    if (svg !== undefined && svg.name.toLowerCase() === "svg") {
      return standalone_svg_node(svg);
    }
  }
  const root = root_from_children(document.children, sanitize);
  if (sanitize && root_is_empty(root)) {
    _throw_transform_err(
      "parse_html_string(): all content removed by sanitizer (forbidden tags/attrs only).",
      "parse-html-string",
      input.slice(0, 200),
    );
  }
  assert_invariants(root, "parse-html-string");
  return root;
}
