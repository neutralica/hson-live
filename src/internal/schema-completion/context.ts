import { performance } from "node:perf_hooks";
import { tokenize_hson } from "../../api/transform/parsers/tokenize-hson.js";
import { parse_hson_with_provenance } from "../hson-source-provenance/parse-hson-with-provenance.js";
import type { HsonSourceLexicalCollector, HsonSourceRange } from "../hson-source-provenance/hson-source-provenance.js";
import { is_projected_value_hson_node, projected_value_from_hson_node } from "../../core/projected-value-graph.js";
import { is_ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { resolve_projected_hson_location } from "../../api/livemap/livemap.editor.js";
import { resolve_internal_document_location, type InternalDocumentLogicalEdge } from "../../api/livemap/livemap.document.logical.js";
import { classify_live_root_mode } from "../../api/livemap/livemap.document.js";
import type { HsonNode } from "../../core/types.js";
import { is_Node, is_ordinary_element_node } from "../../core/node-guards.js";

type Slot = Parameters<NonNullable<HsonSourceLexicalCollector["completionSlot"]>>[0];
type Probe = Readonly<{ kind: Slot; range: HsonSourceRange; text: string; witness: HsonSourceRange }>;
export type CompletionContext = Readonly<{
  kind: Slot;
  path: readonly (string | number)[];
  range: HsonSourceRange;
  root: HsonNode;
  projected?: OrderedProjectedValue;
  existing: readonly string[];
  attribute?: string;
  childIndex?: number;
  childCount?: number;
  /** Name replacement must not also insert a new member value / element body. */
  replacing: boolean;
  unknownPaths: readonly (readonly (string | number)[])[];
  timings: Readonly<{ contextMs: number; parseMs: number; resolveMs: number }>;
}>;

/** One grammar-selected probe, never a candidate search or a tolerant parser. */
export function completion_context(source: string, cursor: number, unknownRanges: readonly HsonSourceRange[] = []): CompletionContext | undefined {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > source.length || source.length > 128_000) return undefined;
  const started = performance.now();
  let probe: Probe | undefined;
  const stop = {};
  const select = (kind: Slot, range: HsonSourceRange): void => {
    if (cursor < range.start || cursor > range.end) return;
    const trivia = /^[ \t\r\n]*$/.test(source.slice(range.start, range.end));
    const replacement = trivia ? { start: cursor, end: cursor } : range;
    // A name longer than the entire authored source cannot collide with any
    // authored decoded name. Identity below is nevertheless RANGE evidence.
    const name = "d6" + "x".repeat(source.length + 1);
    const text = kind === "member" ? name + (trivia ? " null" : "")
      : kind === "tag" || kind === "header" ? name
      : kind === "child" ? '""' : "null";
    const width = kind === "member" ? name.length : text.length;
    probe = { kind, range: replacement, text: text + (trivia ? " " : ""), witness: { start: replacement.start, end: replacement.start + width } };
    throw stop;
  };
  try {
    tokenize_hson(source, 0, {
      completionSlot: select,
      recordToken(_token, evidence) { if (evidence.roles.value) select("value", evidence.roles.value); },
      recordAttribute(_attr, roles) { if (roles.value) select("attribute-value", roles.value); },
    });
  } catch (cause) { if (cause !== stop) return undefined; }
  if (probe === undefined) return undefined;
  const selected: Probe = probe;
  const contextMs = performance.now() - started;
  const parseStarted = performance.now();
  let measured: { contextMs: number; parseMs: number; resolveMs: number } | undefined;
  let resolveStarted = 0;
  try {
    const parsed = parse_hson_with_provenance(source.slice(0, selected.range.start) + selected.text + source.slice(selected.range.end));
    const { value: root, provenance } = parsed;
    resolveStarted = performance.now();
    const timings = { contextMs, parseMs: resolveStarted - parseStarted, resolveMs: 0 };
    measured = timings;
    const matches = (range: HsonSourceRange | undefined): boolean => range?.start === selected.witness.start && range.end === selected.witness.end;
    const unknownPaths: (readonly (string | number)[])[] = [];
    const base = { kind: selected.kind, range: selected.range, root, replacing: selected.range.end > selected.range.start, timings, unknownPaths };
    const unknown = unknownRanges.map(range => range.start >= selected.range.end
      ? { start: range.start + selected.text.length - (selected.range.end - selected.range.start), end: range.end + selected.text.length - (selected.range.end - selected.range.start) } : range);
    if (is_projected_value_hson_node(root)) {
      const projected = projected_value_from_hson_node(root);
      const findUnknown = (value: OrderedProjectedValue, path: readonly (string | number)[]): void => {
        const location = resolve_projected_hson_location(root, path);
        const range = location?.scalarValuePath === undefined ? undefined : provenance.range({ kind: "node", path: location.scalarValuePath, role: "value" });
        if (range && unknown.some(r => r.start === range.start && r.end === range.end)) unknownPaths.push(path);
        if (is_ordered_projected_object(value)) for (const [key, child] of value.entries) findUnknown(child, [...path, key]);
        else if (Array.isArray(value)) value.forEach((child, i) => findUnknown(child, [...path, i]));
      };
      if (unknown.length > 0) findUnknown(projected, []);
      if (unknownPaths.length !== unknown.length) return undefined;
      const walk = (value: OrderedProjectedValue, path: readonly (string | number)[], siblings: readonly string[]): CompletionContext | undefined => {
        const location = resolve_projected_hson_location(root, path);
        if (location === undefined) return undefined;
        if (selected.kind === "member" && matches(provenance.range({ kind: "node", path: location.wrapperPath, role: "name" }))) {
          return { ...base, projected, path: path.slice(0, -1), existing: siblings.filter(name => name !== path.at(-1)) };
        }
        if (selected.kind === "value" && location.scalarValuePath !== undefined && matches(provenance.range({ kind: "node", path: location.scalarValuePath, role: "value" }))) {
          return { ...base, projected, path, existing: [] };
        }
        if (is_ordered_projected_object(value)) {
          const keys = value.entries.map(([key]) => key);
          for (const [key, child] of value.entries) { const result = walk(child, [...path, key], keys); if (result) return result; }
        } else if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) { const result = walk(value[i], [...path, i], []); if (result) return result; }
        }
        return undefined;
      };
      return walk(projected, [], []);
    }
    const mode = classify_live_root_mode(root);
    // An unknown complete attr value cannot change the tag, attribute names or
    // child layout. Document text holes still require current D5 evidence.
    if (unknown.length > 0) {
      const proven = new Set<number>();
      const visit = (node: HsonNode, owner: readonly number[]): void => {
        for (const name of Object.keys(node.$_attrs ?? {})) {
          const range = provenance.range({ kind: "attribute", owner, name, role: "value" });
          unknown.forEach((r, i) => { if (range?.start === r.start && range.end === r.end) proven.add(i); });
        }
        node.$_content.forEach((child, i) => { if (is_Node(child)) visit(child, [...owner, i]); });
      };
      visit(root, []);
      if (proven.size !== unknown.length) return undefined;
    }
    if (mode !== "element" && mode !== "fragment") return undefined;
    const resolve = (path: readonly number[], facet = false) => {
      const edges: InternalDocumentLogicalEdge[] = path.map(index => ({ kind: "content", index }));
      if (facet) edges.push({ kind: "facet", facet: "content" });
      return resolve_internal_document_location(root, mode, edges);
    };
    const walk = (path: readonly number[]): CompletionContext | undefined => {
      if (path.length > 64) return undefined;
      const node = resolve(path);
      if (node.kind === "content") {
        for (let i = 0; i < node.length; i++) {
          const result = walk([...path, i]);
          if (result) return { ...result, childCount: result.childCount ?? node.length - (result.replacing ? 0 : 1) };
        }
        return undefined;
      }
      const physical = node.physical;
      const physicalPath = physical.kind === "direct" || physical.kind === "carrier" ? physical.path : undefined;
      if (physicalPath === undefined) return undefined;
      const owner = mode === "element" ? [0, ...physicalPath] : physicalPath;
      if (selected.kind === "tag" && matches(provenance.range({ kind: "node", path: owner, role: "name" }))) return { ...base, path, existing: [] };
      if ((selected.kind === "child" || selected.kind === "value") && matches(provenance.range({ kind: "node", path: [...owner, 0], role: "value" }))) return { ...base, kind: "child", path, existing: [] };
      if (node.kind !== "node" || !is_ordinary_element_node(node.value)) return undefined;
      const attrs = Object.keys(node.value.$_attrs ?? {});
      for (const name of attrs) {
        const role = selected.kind === "attribute-value" ? "value" : "name";
        if ((selected.kind === "header" || selected.kind === "attribute-value") && matches(provenance.range({ kind: "attribute", owner, name, role }))) {
          const content = resolve(path, true);
          const childCount = content.kind === "content" ? content.length : 0;
          const laterAttr = attrs.some(attr => (provenance.range({ kind: "attribute", owner, name: attr, role: "name" })?.start ?? 0) > selected.witness.end);
          return { ...base, path, existing: attrs.filter(attr => attr !== name), attribute: selected.kind === "attribute-value" ? name : undefined,
            childCount, childIndex: !base.replacing && !laterAttr ? 0 : undefined };
        }
      }
      const content = resolve(path, true);
      if (content.kind === "content") for (let i = 0; i < content.length; i++) { const result = walk([...path, i]); if (result) return { ...result, childCount: result.childCount ?? content.length - (result.replacing ? 0 : 1) }; }
      return undefined;
    };
    return walk([]);
  } catch { return undefined; }
  finally { if (measured !== undefined) measured.resolveMs = performance.now() - resolveStarted; }
}
