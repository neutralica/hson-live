import type { HsonNode } from "../../core/types.js";
import { is_Node } from "../../core/node-guards.js";
import type { PartDefinitionAnalysis, PartLocalDeclaration, PartReferenceUse } from "../part-definition.js";
import { is_part_iterator_attribute, is_part_receiving_attribute, PART_DECLARATION, PART_OPTIONAL, type PartReference } from "../part-placeholder.js";
import { HsonSourceProvenanceBuilder, type HsonSourceProvenance, type HsonSourceRange } from "../hson-source-provenance/hson-source-provenance.js";
import type { PartSourceLocation } from "../hson-schema/part-source.js";
import { tokenize_authored_document_library, type HsonTemplateSlot } from "../../api/transform/parsers/tokenize-hson.js";
import { assemble_authored_document } from "../../api/document/hson-authored.js";

/** Shared source bridge for compiler facts and editor-only authoring regions.
 * Callers establish static structure; dynamic values cannot manufacture names. */
export function parse_part_binding_source(source: string, slots: readonly HsonTemplateSlot[] = []) {
  const builder = new HsonSourceProvenanceBuilder();
  const tokens = tokenize_authored_document_library(source, builder, slots.length ? { slots, substitutions: slots.map(() => "") } : undefined);
  for (const token of tokens) {
    if (token.kind === "OPEN") for (const attr of token.rawAttrs) if (attr.value?.direct === true) {
      if (is_part_iterator_attribute(attr.name) || is_part_receiving_attribute(token.tag, attr.name)
        || attr.name === PART_DECLARATION || attr.name === PART_OPTIONAL) throw new Error("Dynamic Part declaration is not lexical evidence.");
      attr.value.text = "";
    }
    if (token.kind === "TEXT" && token.directValue !== undefined) token.directValue = "";
  }
  const root = assemble_authored_document(tokens, [], new Map(), builder);
  return { root, provenance: builder.finalize(root, source.length) };
}

/** Internal source projection. Object identity is the analyzer's lexical identity,
 * never a name index. File locations are translated to document URIs by the host. */
export type PartBindingDeclaration = Readonly<{
  name: string;
  kind: PartLocalDeclaration["kind"];
  origin: "receiving" | "iteration-value" | "iteration-index" | "iteration-key";
  location: PartSourceLocation;
  scope?: PartSourceLocation;
  incoming?: string;
  elementOf?: PartBindingReference;
  elementKind?: "array" | "object";
}>;
export type PartBindingReference = Readonly<{
  reference: PartReference;
  location: PartSourceLocation;
  root: PartSourceLocation;
  scope?: PartSourceLocation;
  iterators: readonly PartSourceLocation[];
  context: PartReferenceUse["context"] | "receiving";
  attachment?: PartSourceLocation;
  conditional?: true;
  resolution: "resolved" | "unresolved" | "unavailable";
  declaration?: PartBindingDeclaration;
}>;
export type PartBindingSources = Readonly<{
  declarations: readonly PartBindingDeclaration[];
  references: readonly PartBindingReference[];
}>;

/** Correspondence only: decoded values and reference grammar come from Hson.
 * Unsupported normalization withholds exact ranges instead of substring guessing. */
function value_boundaries(source: string, range: HsonSourceRange, decoded: string): readonly number[] | undefined {
  const raw = source.slice(range.start, range.end);
  if (raw === decoded) return Array.from({ length: decoded.length + 1 }, (_, index) => range.start + index);
  if (!raw.startsWith('"') || !raw.endsWith('"')) return undefined;
  const boundaries = [range.start + 1];
  let value = "";
  for (let at = 1; at < raw.length - 1;) {
    const begin = at;
    if (raw[at] === "\\") {
      at += raw[at + 1] === "u" ? 6 : 2;
      try { value += JSON.parse('"' + raw.slice(begin, at) + '"'); } catch { return undefined; }
    } else { value += raw[at++]; }
    boundaries.push(range.start + at);
  }
  return value === decoded && boundaries.length === decoded.length + 1 ? boundaries : undefined;
}

/** Reuse one completed authoritative analysis and its parser provenance. */
export function project_part_bindings(root: HsonNode, analysis: PartDefinitionAnalysis, provenance: HsonSourceProvenance,
  source: string, map: (range: HsonSourceRange) => PartSourceLocation | undefined,
  eventRange?: (reference: PartReference, range: HsonSourceRange) => PartSourceLocation | undefined) {
  const paths = new Map<HsonNode, readonly number[]>();
  const visit = (node: HsonNode, path: readonly number[]): void => {
    paths.set(node, path);
    node.$_content.forEach((child, index) => { if (is_Node(child)) visit(child, [...path, index]); });
  };
  visit(root, []);
  const range = (node: HsonNode, attribute?: string, role: "name" | "value" = "value") => {
    const path = paths.get(node);
    return path === undefined ? undefined : attribute === undefined
      ? provenance.range({ kind: "node", path: role === "value" ? [...path, 0] : path, role: role === "value" ? "value" : "coverage" })
      : provenance.range({ kind: "attribute", owner: path, name: attribute, role });
  };
  const mapped = (where: HsonSourceRange | undefined) => {
    const location = where === undefined ? undefined : map(where);
    return location?.precision === "exact" ? location : undefined;
  };
  const scopeLocations = new Map<HsonNode, PartSourceLocation | undefined>();
  const scopeLocation = (node: HsonNode) => {
    if (!scopeLocations.has(node)) scopeLocations.set(node, mapped(range(node, undefined, "name")));
    return scopeLocations.get(node);
  };
  const valueBoundaries = new Map<HsonSourceRange, readonly number[] | undefined>();
  const declarations = new Map<PartLocalDeclaration, PartBindingDeclaration>();
  const references = new Map<PartReferenceUse, PartBindingReference>();
  const declaration = (binding: PartLocalDeclaration): PartBindingDeclaration | undefined => {
    const existing = declarations.get(binding);
    if (existing !== undefined) return existing;
    const iterator = analysis.iterators.get(binding.node);
    const attribute = binding.receiving === undefined ? iterator?.attribute : `${binding.kind}:${binding.name}`;
    if (attribute === undefined) return undefined;
    const where = range(binding.node, attribute, "name");
    if (where === undefined || source.slice(where.start, where.end) !== attribute) return undefined;
    // The analyzer selected the alias. Split only its already-validated attribute.
    const fields = attribute.split(":");
    const index = binding.receiving !== undefined ? 1 : fields.indexOf(binding.name, 1);
    if (index < 0) return undefined;
    const start = where.start + fields.slice(0, index).reduce((size, field) => size + field.length + 1, 0);
    const location = mapped({ start, end: start + binding.name.length });
    if (location === undefined) return undefined;
    const origin = binding.receiving !== undefined ? "receiving" : iterator?.value === binding.name ? "iteration-value"
      : iterator?.kind === "array" ? "iteration-index" : "iteration-key";
    const elementOf = binding.elementOf === undefined ? undefined : reference(binding.elementOf);
    const result: PartBindingDeclaration = { name: binding.name, kind: binding.kind, origin, location,
      scope: scopeLocation(binding.node), ...(binding.receiving === undefined ? {} : { incoming: binding.receiving.reference.name }),
      ...(elementOf === undefined ? {} : { elementOf, elementKind: iterator?.kind }) };
    declarations.set(binding, result);
    return result;
  };
  const projectReference = (parsed: PartReference, node: HsonNode, attribute: string | undefined, context: PartBindingReference["context"],
    binding?: PartLocalDeclaration, iterators: readonly HsonNode[] = [], conditional?: true): PartBindingReference | undefined => {
    let location: PartSourceLocation | undefined, root: PartSourceLocation | undefined, attachment: PartSourceLocation | undefined;
    if (context === "event") {
      location = eventRange?.(parsed, { start: parsed.start, end: parsed.end });
      root = eventRange?.(parsed, { start: parsed.start + 2, end: parsed.start + 2 + parsed.name.length });
      attachment = mapped(range(node, attribute, "name"));
    } else {
      const structural = context === "structure";
      const where = range(node, attribute, structural ? "name" : "value");
      const value = structural ? attribute : attribute === undefined ? node.$_content[0] : node.$_attrs?.[attribute];
      if (where === undefined || typeof value !== "string") return undefined;
      if (!valueBoundaries.has(where)) valueBoundaries.set(where, value_boundaries(source, where, value));
      const boundaries = valueBoundaries.get(where);
      if (boundaries === undefined) return undefined;
      const start = boundaries[parsed.start], end = boundaries[parsed.end];
      const rootStart = boundaries[parsed.start + 2], rootEnd = boundaries[parsed.start + 2 + parsed.name.length];
      if (start === undefined || end === undefined || rootStart === undefined || rootEnd === undefined) return undefined;
      location = mapped({ start, end }); root = mapped({ start: rootStart, end: rootEnd });
    }
    if (location === undefined || root === undefined) return undefined;
    const target = binding === undefined ? undefined : declaration(binding);
    return { reference: parsed, location, root, scope: scopeLocation(iterators.at(-1) ?? rootElement),
      iterators: iterators.flatMap(node => { const where = scopeLocation(node); return where === undefined ? [] : [where]; }), context,
      resolution: parsed.namespace === "incoming" || binding !== undefined && target === undefined ? "unavailable" : target === undefined ? "unresolved" : "resolved",
      ...(target === undefined ? {} : { declaration: target }), ...(attachment === undefined ? {} : { attachment }),
      ...(conditional === undefined ? {} : { conditional }) };
  };
  const rootElement = is_Node(root.$_content[0]) ? root.$_content[0] : root;
  const reference = (use: PartReferenceUse): PartBindingReference | undefined => {
    const existing = references.get(use);
    if (existing !== undefined) return existing;
    const result = projectReference(use.reference, use.node, use.attribute, use.context, use.binding, use.iterators, use.conditional);
    if (result !== undefined) references.set(use, result);
    return result;
  };
  for (const scope of analysis.scopes.values()) for (const binding of scope.values()) declaration(binding);
  for (const use of analysis.uses) reference(use);
  const incoming = analysis.receiving.flatMap(binding => {
    const ref = projectReference(binding.receiving.reference, binding.node, `${binding.kind}:${binding.name}`, "receiving");
    return ref === undefined ? [] : [ref];
  });
  const sources: PartBindingSources = {
    declarations: [...declarations.values()],
    references: [...references.values(), ...incoming].sort((a, b) => a.root.file.localeCompare(b.root.file) || a.root.start - b.root.start),
  };
  return { sources, byUse: references };
}
