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

const TABLE_DIRECT_ALLOWED = new Set([
  "caption", "colgroup", "thead", "tbody", "tfoot", "tr", "script", "style", "template",
]);

const HEAD_ALLOWED = new Set([
  "base", "basefont", "bgsound", "link", "meta", "noframes", "script", "style", "template", "title",
]);

/** Build the immutable, DOM-free browser realization authority for canonical state. @internal */
export function plan_browser_realization(
  value: HsonNode | Primitive,
  options: Readonly<{ parentNamespace?: BrowserNamespace }> = {},
): BrowserRealizationPlan {
  const parentNamespace = options.parentNamespace ?? "html";
  const fingerprint = browser_realization_fingerprint(value, parentNamespace);
  const roots = plan_atoms(flatten_value(value, "0"), parentNamespace, "ordinary", fingerprint);
  return Object.freeze({
    version: 1,
    fingerprint,
    parentNamespace,
    roots: Object.freeze(roots),
  });
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
): BrowserRealizationNode[] {
  if (parserContext !== "ordinary") return plan_atomic(atoms, parserContext, atomicHost ?? "", fingerprint);
  const result: BrowserRealizationNode[] = [];
  let previousWasText = false;
  let textOrdinal = 0;
  let boundaryOrdinal = 0;
  for (const atom of atoms) {
    if (atom.kind === "element-atom") {
      result.push(plan_element(atom.node, atom.path, parentNamespace));
      previousWasText = false;
      continue;
    }
    assert_transportable_text(atom.value, atom.path);
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
): BrowserRealizationElement {
  if (node.$_tag.startsWith(HSON_SYS_PREFIX)) {
    throw incompatible("a reserved virtual node reached native element planning", path);
  }
  const names = browser_element_namespace(parentNamespace, node.$_tag);
  const attrs: BrowserRealizationAttribute[] = [];
  const plannedAttrNames = new Set<string>();
  const quid = node.$_meta?.[HSON_META_QUID];
  if (quid !== undefined) {
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
  let children = plan_atoms(atoms, names.childNamespace, parserContext, elementFingerprint, names.localName);
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
  assert_transportable_text(text.value, text.path);
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

function assert_transportable_text(value: string, path: string): void {
  if (value.includes("\0")) throw incompatible("NUL cannot be preserved by text/html parsing", path);
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) throw incompatible("a lone surrogate cannot be preserved by UTF-8 HTML transport", path);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw incompatible("a lone surrogate cannot be preserved by UTF-8 HTML transport", path);
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
  const quid = value.$_meta?.[HSON_META_QUID] ?? "";
  return `n(${JSON.stringify(value.$_tag)}|q=${quid}|a=${attrs}|c=${value.$_content.map(stable_value).join(";")})`;
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
