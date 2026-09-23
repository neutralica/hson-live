import {
  ARR_TAG,
  ELEM_TAG,
  HSON_META_QUID,
  HSON_SYS_PREFIX,
  OBJ_TAG,
  ROOT_TAG,
  STR_TAG,
  VAL_TAG,
} from "../../core/constants.js";
import { is_Node } from "../../core/node-guards.js";
import type { CanonicalPublicAttrValue, HsonNode, Primitive } from "../../core/types.js";
import { serialize_style } from "../../api/transform/utils/attrs-utils/serialize-style.js";
import { canonical_svg_attr_name } from "../../api/transform/utils/html-utils/parse_html_attrs.js";

export const BROWSER_HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
export const BROWSER_SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export type BrowserNamespace = "html" | "svg";
export type BrowserParserContext = "ordinary" | "rcdata" | "rawtext";

export type BrowserRealizationAttribute = Readonly<{ name: string; value: string }>;

type PlannedBase = Readonly<{ path: string; canonicalNode?: HsonNode }>;

export type BrowserRealizationText = PlannedBase & Readonly<{
  kind: "text";
  value: string;
  parserContext: BrowserParserContext;
}>;

export type BrowserRealizationMarker = PlannedBase & Readonly<{
  kind: "marker";
  markerKind: "boundary" | "empty" | "pre-leading-newline";
  value: string;
}>;

export type BrowserRealizationElement = PlannedBase & Readonly<{
  kind: "element";
  canonicalNode: HsonNode;
  namespace: BrowserNamespace;
  localName: string;
  attrs: readonly BrowserRealizationAttribute[];
  children: readonly BrowserRealizationNode[];
  childTarget: "element" | "template-content";
  parserContext: BrowserParserContext;
}>;

export type BrowserRealizationWrapper = PlannedBase & Readonly<{
  kind: "wrapper";
  namespace: BrowserNamespace;
  localName: string;
  attrs: readonly BrowserRealizationAttribute[];
  children: readonly BrowserRealizationNode[];
  childTarget: "element";
  parserContext: "ordinary";
}>;

export type BrowserRealizationNode =
  | BrowserRealizationText
  | BrowserRealizationMarker
  | BrowserRealizationElement
  | BrowserRealizationWrapper;

export type BrowserRealizationPlan = Readonly<{
  version: 1;
  fingerprint: string;
  parentNamespace: BrowserNamespace;
  parserClosure: "not-required" | "verified";
  roots: readonly BrowserRealizationNode[];
}>;

export class BrowserRealizationIncompatibilityError extends Error {
  public readonly code = "HSON_BROWSER_REALIZATION_INCOMPATIBLE";
  public constructor(
    public readonly reason: string,
    public readonly canonicalPath: string,
  ) {
    super(`Browser realization is incompatible at ${canonicalPath}: ${reason}`);
    this.name = "BrowserRealizationIncompatibilityError";
  }
}

type TextAtom = Readonly<{
  kind: "text-atom";
  value: string;
  path: string;
  canonicalNode?: HsonNode;
}>;
type ElementAtom = Readonly<{ kind: "element-atom"; node: HsonNode; path: string }>;
type Atom = TextAtom | ElementAtom;

const SVG_ELEMENT_CASE: Readonly<Record<string, string>> = Object.freeze({
  altglyph: "altGlyph",
  altglyphdef: "altGlyphDef",
  altglyphitem: "altGlyphItem",
  animatecolor: "animateColor",
  animatemotion: "animateMotion",
  animatetransform: "animateTransform",
  clippath: "clipPath",
  feblend: "feBlend",
  fecolormatrix: "feColorMatrix",
  fecomponenttransfer: "feComponentTransfer",
  fecomposite: "feComposite",
  feconvolvematrix: "feConvolveMatrix",
  fediffuselighting: "feDiffuseLighting",
  fedisplacementmap: "feDisplacementMap",
  fedistantlight: "feDistantLight",
  fedropshadow: "feDropShadow",
  feflood: "feFlood",
  fefunca: "feFuncA",
  fefuncb: "feFuncB",
  fefuncg: "feFuncG",
  fefuncr: "feFuncR",
  fegaussianblur: "feGaussianBlur",
  feimage: "feImage",
  femerge: "feMerge",
  femergenode: "feMergeNode",
  femorphology: "feMorphology",
  feoffset: "feOffset",
  fepointlight: "fePointLight",
  fespecularlighting: "feSpecularLighting",
  fespotlight: "feSpotLight",
  fetile: "feTile",
  feturbulence: "feTurbulence",
  foreignobject: "foreignObject",
  glyphref: "glyphRef",
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
  textpath: "textPath",
});

const ATOMIC_CONTEXT = new Map<string, BrowserParserContext>([
  ["textarea", "rcdata"],
  ["title", "rcdata"],
  ["style", "rawtext"],
  ["script", "rawtext"],
]);

const HTML_VOID_ELEMENTS = new Set([
  "area", "base", "basefont", "bgsound", "br", "col", "command", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

const P_IMPLIED_END_STARTS = new Set([
  "address", "article", "aside", "blockquote", "center", "details", "dialog", "dir", "div", "dl", "fieldset", "figcaption", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "main", "menu",
  "nav", "ol", "p", "pre", "search", "section", "summary", "table", "ul", "li", "dt", "dd", "listing", "plaintext",
]);

const TABLE_FAMILY = new Set([
  "caption", "colgroup", "col", "tbody", "thead", "tfoot", "tr", "td", "th",
]);

const TABLE_CHILDREN = new Set([
  "caption", "colgroup", "thead", "tbody", "tfoot", "script", "style", "template",
]);

const TABLE_SECTION_CHILDREN = new Set(["tr", "script", "style", "template"]);
const TABLE_ROW_CHILDREN = new Set(["td", "th", "script", "style", "template"]);
const COLGROUP_CHILDREN = new Set(["col", "template"]);
const SELECT_CHILDREN = new Set(["option", "optgroup", "hr", "script", "template"]);
const OPTGROUP_CHILDREN = new Set(["option", "script", "template"]);

const SVG_HTML_BREAKOUT_STARTS = new Set([
  "address", "article", "aside", "b", "big", "blockquote", "body", "br", "center", "code", "dd", "div", "dl",
  "dt", "em", "embed", "font", "h1", "h2", "h3", "h4", "h5", "h6", "head", "hr", "html", "i", "img",
  "li", "listing", "main", "menu", "meta", "nobr", "ol", "p", "pre", "ruby", "s", "small", "span", "strong",
  "strike", "sub", "sup", "table", "tt", "u", "ul", "var",
]);

const SCOPE_BOUNDARIES = new Set(["applet", "caption", "html", "marquee", "object", "table", "td", "th", "template"]);
const BUTTON_SCOPE_BOUNDARIES = new Set([...SCOPE_BOUNDARIES, "button"]);
const LIST_ITEM_SCOPE_BOUNDARIES = new Set([...SCOPE_BOUNDARIES, "ol", "ul"]);
const RAWTEXT_HOSTS_OUTSIDE_VERSION_ONE = new Set(["iframe", "noembed", "noframes", "xmp"]);

const TABLE_DIRECT_ALLOWED = new Set([
  "caption", "colgroup", "thead", "tbody", "tfoot", "tr", "script", "style", "template",
]);

const HEAD_ALLOWED = new Set([
  "base", "basefont", "bgsound", "link", "meta", "noframes", "script", "style", "template", "title",
]);

/** Build the immutable, DOM-free browser realization authority for canonical state. @internal */
export function plan_browser_realization(
  value: HsonNode | Primitive,
  options: Readonly<{
    parentNamespace?: BrowserNamespace;
    capability?: "dom" | "ssr";
  }> = {},
): BrowserRealizationPlan {
  const parentNamespace = options.parentNamespace ?? "html";
  const capability = options.capability ?? "ssr";
  const fingerprint = browser_realization_fingerprint(value, parentNamespace);
  const roots = plan_atoms(flatten_value(value, "0"), parentNamespace, "ordinary", fingerprint, undefined, capability);
  const plan: BrowserRealizationPlan = Object.freeze({
    version: 1,
    fingerprint,
    parentNamespace,
    parserClosure: capability === "ssr" ? "verified" : "not-required",
    roots: Object.freeze(roots),
  });
  if (capability === "ssr") assert_browser_realization_parser_closed(plan);
  return plan;
}

/** Standards-defined HTML voidness shared by planning and serialization. @internal */
export function is_html_void_element(localName: string): boolean {
  return HTML_VOID_ELEMENTS.has(localName);
}

/** Shared canonical-value to native DOM attribute lowering. @internal */
export function lower_browser_attribute_value(
  name: string,
  value: CanonicalPublicAttrValue | undefined,
  namespace: BrowserNamespace,
): BrowserRealizationAttribute | undefined {
  if (value === null || value === false || value === undefined) return undefined;
  const loweredName = namespace === "svg" ? canonical_svg_attr_name(name) : name.toLowerCase();
  if (value === true) return Object.freeze({ name: loweredName, value: "" });
  if (name === "style" && typeof value === "object") {
    const cssText = serialize_style(value);
    return cssText === "" ? undefined : Object.freeze({ name: loweredName, value: cssText });
  }
  return Object.freeze({ name: loweredName, value: String(value) });
}

/** One namespace transition authority shared by every browser realization consumer. @internal */
export function browser_element_namespace(
  parentNamespace: BrowserNamespace,
  canonicalTag: string,
): Readonly<{ namespace: BrowserNamespace; localName: string; childNamespace: BrowserNamespace }> {
  const lower = canonicalTag.toLowerCase();
  const namespace: BrowserNamespace = lower === "svg" ? "svg" : parentNamespace;
  const localName = namespace === "svg" ? SVG_ELEMENT_CASE[lower] ?? canonicalTag : lower;
  const childNamespace: BrowserNamespace = namespace === "svg" && lower === "foreignobject" ? "html" : namespace;
  return Object.freeze({ namespace, localName, childNamespace });
}

function plan_atoms(
  atoms: readonly Atom[],
  parentNamespace: BrowserNamespace,
  parserContext: BrowserParserContext,
  fingerprint: string,
  atomicHost?: string,
  capability: "dom" | "ssr" = "ssr",
): BrowserRealizationNode[] {
  if (parserContext !== "ordinary") return plan_atomic(atoms, parserContext, atomicHost ?? "", fingerprint);
  const result: BrowserRealizationNode[] = [];
  let previousWasText = false;
  let textOrdinal = 0;
  let boundaryOrdinal = 0;
  for (const atom of atoms) {
    if (atom.kind === "element-atom") {
      result.push(plan_element(atom.node, atom.path, parentNamespace, capability));
      previousWasText = false;
      continue;
    }
    assert_parser_transportable_string(atom.value, atom.path, "text");
    if (previousWasText) {
      result.push(marker_node("boundary", fingerprint, atom.path, boundaryOrdinal));
      boundaryOrdinal += 1;
    }
    if (atom.value === "") {
      result.push(marker_node("empty", fingerprint, atom.path, textOrdinal, atom.canonicalNode));
    } else {
      result.push(Object.freeze({
        kind: "text",
        value: atom.value,
        path: atom.path,
        ...(atom.canonicalNode === undefined ? {} : { canonicalNode: atom.canonicalNode }),
        parserContext: "ordinary",
      }));
    }
    previousWasText = true;
    textOrdinal += 1;
  }
  return result;
}

function plan_element(
  node: HsonNode,
  path: string,
  parentNamespace: BrowserNamespace,
  capability: "dom" | "ssr",
): BrowserRealizationElement {
  if (node.$_tag.startsWith(HSON_SYS_PREFIX)) {
    throw incompatible("a reserved virtual node reached native element planning", path);
  }
  const names = browser_element_namespace(parentNamespace, node.$_tag);
  const attrs: BrowserRealizationAttribute[] = [];
  const plannedAttrNames = new Set<string>();
  const quid = node.$_meta?.[HSON_META_QUID];
  if (capability === "dom" && quid !== undefined) {
    attrs.push(Object.freeze({ name: "hson:quid", value: quid }));
    plannedAttrNames.add("hson:quid");
  }
  for (const [name, value] of Object.entries(node.$_attrs ?? {})) {
    const lowered = lower_browser_attribute_value(name, value, names.namespace);
    if (lowered === undefined) continue;
    if (plannedAttrNames.has(lowered.name)) {
      throw incompatible(`canonical attributes collapse to duplicate browser name ${JSON.stringify(lowered.name)}`, path);
    }
    plannedAttrNames.add(lowered.name);
    attrs.push(lowered);
  }
  attrs.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

  const parserContext = names.namespace === "html"
    ? ATOMIC_CONTEXT.get(names.localName) ?? "ordinary"
    : "ordinary";
  const atoms = flatten_content(node.$_content, `${path}.c`);
  validate_document_structure(names.namespace, names.localName, atoms, path);
  const elementFingerprint = browser_realization_fingerprint(node, names.namespace);
  let children = plan_atoms(atoms, names.childNamespace, parserContext, elementFingerprint, names.localName, capability);
  if (names.namespace === "html" && names.localName === "table") {
    children = derive_table_wrappers(children, path);
  }
  if (names.namespace === "html" && names.localName === "pre"
    && children[0]?.kind === "text" && children[0].value.startsWith("\n")) {
    children.unshift(marker_node("pre-leading-newline", elementFingerprint, `${path}.pre`, 0));
  }
  return Object.freeze({
    kind: "element",
    canonicalNode: node,
    path,
    namespace: names.namespace,
    localName: names.localName,
    attrs: Object.freeze(attrs),
    children: Object.freeze(children),
    childTarget: names.namespace === "html" && names.localName === "template"
      ? "template-content"
      : "element",
    parserContext,
  });
}

function plan_atomic(
  atoms: readonly Atom[],
  parserContext: Exclude<BrowserParserContext, "ordinary">,
  host: string,
  _fingerprint: string,
): BrowserRealizationNode[] {
  for (const atom of atoms) {
    if (atom.kind === "element-atom") {
      throw incompatible("parser-atomic elements cannot contain canonical element cuts in version one", atom.path);
    }
  }
  const texts = atoms.filter((atom): atom is TextAtom => atom.kind === "text-atom");
  if (texts.length === 0) return [];
  if (texts.length !== 1) {
    throw incompatible("parser-atomic content supports at most one canonical text leaf in version one", texts[1]?.path ?? "0");
  }
  const text = texts[0]!;
  if (text.value === "") {
    throw incompatible("an explicit empty parser-atomic text leaf requires deferred shared-run evidence", text.path);
  }
  assert_parser_transportable_string(text.value, text.path, "text");
  if (parserContext === "rcdata") {
    if (text.value.startsWith("\n") && host === "textarea") {
      throw incompatible("a leading LF in textarea is suppressed by the HTML parser", text.path);
    }
  } else {
    if (text.value.includes("\r")) {
      throw incompatible(`${host} RAWTEXT containing CR cannot survive HTML input preprocessing`, text.path);
    }
    const sentinel = new RegExp(`<\\/${host}(?:[\\t\\n\\f\\r \\/>]|$)`, "i");
    if (sentinel.test(text.value)) {
      throw incompatible(`${host} RAWTEXT contains a parser-significant closing sentinel`, text.path);
    }
  }
  return [Object.freeze({
    kind: "text",
    value: text.value,
    path: text.path,
    ...(text.canonicalNode === undefined ? {} : { canonicalNode: text.canonicalNode }),
    parserContext,
  })];
}

function derive_table_wrappers(
  children: readonly BrowserRealizationNode[],
  path: string,
): BrowserRealizationNode[] {
  const result: BrowserRealizationNode[] = [];
  let rows: BrowserRealizationNode[] = [];
  let wrapperOrdinal = 0;
  const flush = (): void => {
    if (rows.length === 0) return;
    result.push(Object.freeze({
      kind: "wrapper",
      path: `${path}.tbody:${wrapperOrdinal}`,
      namespace: "html",
      localName: "tbody",
      attrs: Object.freeze([]),
      children: Object.freeze(rows),
      childTarget: "element",
      parserContext: "ordinary",
    }));
    rows = [];
    wrapperOrdinal += 1;
  };
  for (const child of children) {
    if (child.kind === "element" && child.namespace === "html" && child.localName === "tr") {
      rows.push(child);
      continue;
    }
    flush();
    if (child.kind === "text" && /[^\t\n\f\r ]/.test(child.value)) {
      throw incompatible("non-whitespace table text would be foster-parented", child.path);
    }
    if (child.kind === "element" && !TABLE_DIRECT_ALLOWED.has(child.localName)) {
      throw incompatible(`direct <${child.localName}> content would be foster-parented by a table parser`, child.path);
    }
    result.push(child);
  }
  flush();
  return result;
}

function validate_document_structure(
  namespace: BrowserNamespace,
  localName: string,
  atoms: readonly Atom[],
  path: string,
): void {
  if (namespace !== "html") return;
  if (localName === "html") {
    const elements = atoms.filter((atom): atom is ElementAtom => atom.kind === "element-atom");
    const text = atoms.find((atom) => atom.kind === "text-atom" && atom.value !== "");
    if (text !== undefined || elements.length !== 2
      || elements[0]?.node.$_tag.toLowerCase() !== "head"
      || elements[1]?.node.$_tag.toLowerCase() !== "body") {
      throw incompatible("a full document requires exactly ordered canonical <head> and <body> children", path);
    }
  }
  if (localName === "head") {
    for (const atom of atoms) {
      if (atom.kind === "text-atom" ? atom.value !== "" : !HEAD_ALLOWED.has(atom.node.$_tag.toLowerCase())) {
        throw incompatible("canonical head content would be relocated by the HTML parser", atom.path);
      }
    }
  }
}

type ParserElement = BrowserRealizationElement | BrowserRealizationWrapper;

/** Verify the deliberately conservative version-one HTML-parser-stable domain. @internal */
export function assert_browser_realization_parser_closed(plan: BrowserRealizationPlan): void {
  for (const root of plan.roots) {
    if (root.kind !== "element" && root.kind !== "wrapper") continue;
    if (root.namespace === "html" && (root.localName === "head" || root.localName === "body" || TABLE_FAMILY.has(root.localName))) {
      throw incompatible(`<${root.localName}> requires a parser-valid owning context`, root.path);
    }
  }
  const htmlRoots = plan.roots.filter(
    (root): root is ParserElement => (root.kind === "element" || root.kind === "wrapper")
      && root.namespace === "html" && root.localName === "html",
  );
  if (htmlRoots.length !== 0 && (htmlRoots.length !== 1 || plan.roots.length !== 1)) {
    throw incompatible("a full <html> document must be the plan's only root", htmlRoots[0]?.path ?? "0");
  }
  validate_parser_children(plan.roots, undefined, []);
}

function validate_parser_children(
  children: readonly BrowserRealizationNode[],
  parent: ParserElement | undefined,
  ancestors: readonly ParserElement[],
): void {
  if (parent !== undefined) validate_parent_parser_content(parent, children);
  for (const child of children) {
    if (child.kind !== "element" && child.kind !== "wrapper") continue;
    const parserAncestors = parent?.namespace === "html" && parent.localName === "template" ? [] : ancestors;
    validate_parser_element(child, parent, parserAncestors);
    const nextAncestors = [...parserAncestors, child];
    validate_parser_children(child.children, child, nextAncestors);
  }
}

function validate_parser_element(
  element: ParserElement,
  parent: ParserElement | undefined,
  ancestors: readonly ParserElement[],
): void {
  for (const attr of element.attrs) {
    assert_parser_transportable_string(
      attr.value,
      `${element.path}.a[${JSON.stringify(attr.name)}]`,
      "attribute value",
    );
  }
  if (element.namespace === "svg") {
    if (parent?.namespace === "svg" && SVG_HTML_BREAKOUT_STARTS.has(element.localName.toLowerCase())) {
      throw incompatible(`HTML parsing would leave SVG foreign content at <${element.localName}>`, element.path);
    }
    return;
  }

  const name = element.localName;
  const parentName = parent?.namespace === "html" ? parent.localName : undefined;
  if (name === "html" && parent !== undefined) {
    throw incompatible("a nested <html> start tag is handled by document insertion mode", element.path);
  }
  if (name === "head" && parentName !== "html") {
    throw incompatible("<head> requires the planned document <html> as its parent", element.path);
  }
  if (name === "body" && parentName !== "html") {
    throw incompatible("<body> requires the planned document <html> as its parent", element.path);
  }
  validate_table_family_parent(name, parentName, element.path);

  if (name === "image" || name === "math" || name === "frameset" || name === "frame" || name === "isindex" || name === "keygen") {
    throw incompatible(`<${name}> has parser-special namespace or token handling outside version one`, element.path);
  }
  if (name === "plaintext") {
    throw incompatible("<plaintext> cannot be closed by HTML source", element.path);
  }
  if (name === "noscript") {
    throw incompatible("<noscript> parsing depends on the native scripting flag", element.path);
  }
  if (RAWTEXT_HOSTS_OUTSIDE_VERSION_ONE.has(name) && element.children.length !== 0) {
    throw incompatible(`<${name}> parser-atomic content is outside version-one shared-run support`, element.path);
  }

  if (P_IMPLIED_END_STARTS.has(name) && has_scoped_ancestor(ancestors, "p", BUTTON_SCOPE_BOUNDARIES)) {
    throw incompatible(`<${name}> would implicitly close an ancestor <p>`, element.path);
  }
  if (name === "li" && has_scoped_ancestor(ancestors, "li", LIST_ITEM_SCOPE_BOUNDARIES)) {
    throw incompatible("a nested <li> start tag would implicitly close its ancestor <li>", element.path);
  }
  if ((name === "dt" || name === "dd")
    && (has_scoped_ancestor(ancestors, "dt", SCOPE_BOUNDARIES)
      || has_scoped_ancestor(ancestors, "dd", SCOPE_BOUNDARIES))) {
    throw incompatible(`<${name}> would implicitly close an ancestor <dt> or <dd>`, element.path);
  }
  if ((name === "rb" || name === "rtc" || name === "rt" || name === "rp") && parentName !== "ruby") {
    throw incompatible(`<${name}> requires a direct parser-stable <ruby> parent`, element.path);
  }
  if (name === "option" && has_html_ancestor(ancestors, "option")) {
    throw incompatible("a nested <option> start tag would implicitly close its ancestor <option>", element.path);
  }
  if (name === "optgroup" && (has_html_ancestor(ancestors, "option") || has_html_ancestor(ancestors, "optgroup"))) {
    throw incompatible("a nested <optgroup> start tag would implicitly close select content", element.path);
  }
  if (name === "a" && has_html_ancestor(ancestors, "a")) {
    throw incompatible("a nested <a> start tag triggers active-formatting reconstruction", element.path);
  }
  if (name === "nobr" && has_html_ancestor(ancestors, "nobr")) {
    throw incompatible("a nested <nobr> start tag triggers active-formatting reconstruction", element.path);
  }
  if (name === "button" && has_scoped_ancestor(ancestors, "button", SCOPE_BOUNDARIES)) {
    throw incompatible("a nested <button> start tag would implicitly close its ancestor <button>", element.path);
  }
  if (name === "form" && has_html_ancestor(ancestors, "form")) {
    throw incompatible("a nested <form> start tag would be ignored by the HTML parser", element.path);
  }
  if (name === "select" && has_html_ancestor(ancestors, "select")) {
    throw incompatible("a nested <select> start tag would close its ancestor <select>", element.path);
  }
  if (/^h[1-6]$/.test(name) && parentName !== undefined && /^h[1-6]$/.test(parentName)) {
    throw incompatible(`<${name}> would implicitly close its heading parent`, element.path);
  }
}

function validate_parent_parser_content(
  parent: ParserElement,
  children: readonly BrowserRealizationNode[],
): void {
  if (parent.namespace === "svg") {
    if (parent.localName === "title" || parent.localName === "desc") {
      const element = children.find((child) => child.kind === "element" || child.kind === "wrapper");
      if (element !== undefined) {
        throw incompatible(`SVG <${parent.localName}> is an HTML integration point with unstable element children`, element.path);
      }
    }
    return;
  }
  if (is_html_void_element(parent.localName) && children.length !== 0) {
    throw incompatible(`void element <${parent.localName}> cannot realize children through HTML parsing`, children[0]?.path ?? parent.path);
  }
  if (parent.localName === "html") {
    const names = children.filter(is_parser_element).map((child) => child.localName);
    if (children.length !== 2 || names.length !== 2 || names[0] !== "head" || names[1] !== "body") {
      throw incompatible("document insertion mode requires exactly planned <head> then <body>", parent.path);
    }
  }
  if (parent.localName === "table") validate_restricted_children(parent, children, TABLE_CHILDREN, "table insertion mode would relocate child");
  if (parent.localName === "tbody" || parent.localName === "thead" || parent.localName === "tfoot") {
    validate_restricted_children(parent, children, TABLE_SECTION_CHILDREN, "table-section insertion mode would relocate child");
  }
  if (parent.localName === "tr") validate_restricted_children(parent, children, TABLE_ROW_CHILDREN, "table-row insertion mode would relocate child");
  if (parent.localName === "colgroup") validate_restricted_children(parent, children, COLGROUP_CHILDREN, "column-group insertion mode would close before child");
  if (parent.localName === "select") validate_restricted_children(parent, children, SELECT_CHILDREN, "child is invalid in select parser context", true);
  if (parent.localName === "optgroup") validate_restricted_children(parent, children, OPTGROUP_CHILDREN, "child is invalid in optgroup parser context", true);
  if (parent.localName === "option") {
    const element = children.find(is_parser_element);
    if (element !== undefined) throw incompatible("option parser context cannot preserve element children", element.path);
  }
}

function validate_restricted_children(
  parent: ParserElement,
  children: readonly BrowserRealizationNode[],
  allowedElements: ReadonlySet<string>,
  reason: string,
  allowText = false,
): void {
  for (const child of children) {
    if (child.kind === "marker") continue;
    if (child.kind === "text") {
      if (allowText || !/[^\t\n\f\r ]/.test(child.value)) continue;
      throw incompatible(reason, child.path);
    }
    if (child.namespace === "html" && allowedElements.has(child.localName)) continue;
    throw incompatible(`${reason}: <${child.localName}> under <${parent.localName}>`, child.path);
  }
}

function validate_table_family_parent(name: string, parentName: string | undefined, path: string): void {
  let allowed: readonly string[] | undefined;
  if (name === "caption" || name === "colgroup" || name === "thead" || name === "tbody" || name === "tfoot") allowed = ["table"];
  else if (name === "col") allowed = ["colgroup"];
  else if (name === "tr") allowed = ["tbody", "thead", "tfoot"];
  else if (name === "td" || name === "th") allowed = ["tr"];
  if (allowed !== undefined && (parentName === undefined || !allowed.includes(parentName))) {
    throw incompatible(`<${name}> requires parser-valid parent ${allowed.map((item) => `<${item}>`).join(" or ")}`, path);
  }
}

function has_html_ancestor(ancestors: readonly ParserElement[], name: string): boolean {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]!;
    if (ancestor.namespace === "html" && ancestor.localName === name) return true;
  }
  return false;
}

function has_scoped_ancestor(
  ancestors: readonly ParserElement[],
  name: string,
  boundaries: ReadonlySet<string>,
): boolean {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]!;
    if (ancestor.namespace !== "html") continue;
    if (ancestor.localName === name) return true;
    if (boundaries.has(ancestor.localName)) return false;
  }
  return false;
}

function is_parser_element(node: BrowserRealizationNode): node is ParserElement {
  return node.kind === "element" || node.kind === "wrapper";
}

function flatten_value(value: HsonNode | Primitive, path: string): Atom[] {
  if (!is_Node(value)) return [{ kind: "text-atom", value: String(value ?? ""), path }];
  if (value.$_tag === STR_TAG || value.$_tag === VAL_TAG) {
    return [{
      kind: "text-atom",
      value: String(value.$_content[0] ?? ""),
      path,
      canonicalNode: value,
    }];
  }
  if (value.$_tag === ARR_TAG) {
    const result: Atom[] = [];
    for (let index = 0; index < value.$_content.length; index += 1) {
      const item = value.$_content[index];
      if (!is_Node(item)) continue;
      const payload = item.$_content[0];
      if (payload !== undefined && payload !== null) result.push(...flatten_value(payload, `${path}.${index}.0`));
    }
    return result;
  }
  if (value.$_tag === ROOT_TAG || value.$_tag === OBJ_TAG || value.$_tag === ELEM_TAG) {
    return flatten_content(value.$_content, path);
  }
  return [{ kind: "element-atom", node: value, path }];
}

function flatten_content(content: readonly (HsonNode | Primitive)[], path: string): Atom[] {
  return content.flatMap((child, index) => flatten_value(child, `${path}.${index}`));
}

function marker_node(
  kind: BrowserRealizationMarker["markerKind"],
  fingerprint: string,
  path: string,
  ordinal: number,
  canonicalNode?: HsonNode,
): BrowserRealizationMarker {
  const markerName = kind === "pre-leading-newline" ? "pre-lf" : kind;
  return Object.freeze({
    kind: "marker",
    markerKind: kind,
    value: `hson-boundary:v1:${fingerprint}:${markerName}:${ordinal}`,
    path,
    ...(canonicalNode === undefined ? {} : { canonicalNode }),
  });
}

function assert_parser_transportable_string(
  value: string,
  path: string,
  subject: "text" | "attribute value",
): void {
  if (value.includes("\0")) {
    const reason = subject === "text"
      ? "NUL cannot be preserved by text/html parsing"
      : "attribute value containing NUL cannot be preserved by text/html parsing";
    throw incompatible(reason, path);
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        const reason = subject === "text"
          ? "a lone surrogate cannot be preserved by UTF-8 HTML transport"
          : "attribute value containing a lone surrogate cannot be preserved by UTF-8 HTML transport";
        throw incompatible(reason, path);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      const reason = subject === "text"
        ? "a lone surrogate cannot be preserved by UTF-8 HTML transport"
        : "attribute value containing a lone surrogate cannot be preserved by UTF-8 HTML transport";
      throw incompatible(reason, path);
    }
  }
}

function incompatible(reason: string, path: string): BrowserRealizationIncompatibilityError {
  return new BrowserRealizationIncompatibilityError(reason, path);
}

function browser_realization_fingerprint(value: HsonNode | Primitive, namespace: BrowserNamespace): string {
  const source = `${namespace}|${stable_value(value)}`;
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left ^= code;
    left = Math.imul(left, 0x01000193);
    right ^= code + index;
    right = Math.imul(right, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

function stable_value(value: HsonNode | Primitive): string {
  if (!is_Node(value)) return stable_primitive(value);
  const attrs = Object.keys(value.$_attrs ?? {}).sort().map((key) => `${JSON.stringify(key)}=${stable_unknown(value.$_attrs?.[key])}`).join(",");
  return `n(${JSON.stringify(value.$_tag)}|a=${attrs}|c=${value.$_content.map(stable_value).join(";")})`;
}

function stable_unknown(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && Object.is(value, -0)) return "number:-0";
    return `${typeof value}:${JSON.stringify(value)}`;
  }
  if (!is_record(value)) return `object:${String(value)}`;
  const record = value;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable_unknown(record[key])}`).join(",")}}`;
}

function stable_primitive(value: Primitive): string {
  if (typeof value === "number" && Object.is(value, -0)) return "number:-0";
  return `${typeof value}:${JSON.stringify(value)}`;
}

function is_record(value: object): value is Readonly<Record<string, unknown>> {
  return !Array.isArray(value);
}
