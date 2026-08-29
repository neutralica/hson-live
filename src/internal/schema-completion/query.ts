import { performance } from "node:perf_hooks";
import { read_defined_projected_schema_node, type LiveMapSchemaNode } from "../../api/livemap/livemap.schema.js";
import { require_document_root_schema } from "../../api/livemap/livemap.document.schema.js";
import { ordered_projected_value_equal, is_ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { projected_value_to_hson_node } from "../../core/projected-value-graph.js";
import { serialize_hson } from "../../api/transform/serializers/serialize-hson.js";
import { serialize_hson_tag_name } from "../../api/transform/utils/hson-utils/hson-tag-helpers.js";
import { resolve_internal_document_location } from "../../api/livemap/livemap.document.logical.js";
import { classify_live_root_mode } from "../../api/livemap/livemap.document.js";
import { completion_context, type CompletionContext } from "./context.js";

export type SchemaCompletionItem = Readonly<{
  id: string; label: string; kind: "member" | "literal" | "tag" | "attribute" | "flag";
  insertText: string; snippet: boolean; detail: string; required?: boolean; sortText: string;
}>;
export type SchemaCompletionResult = Readonly<{
  status: "available" | "unsupported";
  items: readonly SchemaCompletionItem[];
  range?: Readonly<{ start: number; end: number }>;
  timings?: Readonly<{ contextMs: number; parseMs: number; resolveMs: number; queryMs: number }>;
}>;
const unavailable: SchemaCompletionResult = { status: "unsupported", items: [] };
type Draft = Omit<SchemaCompletionItem, "id" | "sortText">;
// Raw tagged templates cannot escape JS delimiters with a backslash: it would
// survive into Hson. Use Hson's own Unicode escapes inside serialized names/strings.
const templateSafe = (text: string): string => text.replace(/`/g, "\\u0060").replace(/\$\{/g, "\\u0024{");
const literalText = (value: OrderedProjectedValue): string => templateSafe(serialize_hson(projected_value_to_hson_node(value), { noBreak: true }));
const snippetText = (text: string): string => text.replace(/[\\$}]/g, "\\$&");

/** Observational finite query over the actual compiled nodes. Never calls validate. */
export function query_schema_completion(schema: object, source: string, cursor: number, unknownRanges: readonly Readonly<{ start: number; end: number }>[] = []): SchemaCompletionResult {
  const context = completion_context(source, cursor, unknownRanges);
  if (context === undefined) return unavailable;
  const start = performance.now();
  try {
    const projected = read_defined_projected_schema_node(schema);
    const drafts = projected !== undefined && context.projected !== undefined
      ? projectedCompletions(projected, context) : documentCompletions(schema, context);
    const separator = !context.replacing && cursor < source.length && !/[ \t\r\n>\]»/]/.test(source[cursor]) ? " " : "";
    const items = drafts.map((item, i) => ({ ...item, insertText: item.insertText + separator, id: String(i), sortText: `${item.required === true ? 0 : item.required === false ? 1 : 2}:${String(i).padStart(6, "0")}` }));
    return { status: "available", items, range: context.range, timings: { ...context.timings, queryMs: performance.now() - start } };
  } catch { return unavailable; }
}

function projectedQuery() {
  let budget = 512;
  const expand = (node: LiveMapSchemaNode, active = new Set<LiveMapSchemaNode>(), followRecursion = true): LiveMapSchemaNode[] => {
    if (--budget < 0 || active.size > 64 || active.has(node)) throw new Error("Completion traversal bound");
    const seen = new Set(active).add(node);
    if (node.kind === "recurse" && !followRecursion) return [node];
    if (node.kind === "recurse" || node.kind === "constrain") {
      const child = node.kind === "recurse" ? node.recurse?.() : node.base;
      return child === undefined ? [] : expand(child, seen, followRecursion).map(n => ({ ...n, optional: node.optional, nullable: n.nullable || node.nullable }));
    }
    if (node.kind === "pick") return (node.choices ?? []).flatMap(n => expand(n, seen, followRecursion).map(n => ({ ...n, optional: node.optional, nullable: n.nullable || node.nullable })));
    return [node];
  };
  const finite = (nodes: readonly LiveMapSchemaNode[]): OrderedProjectedValue[] | undefined => {
    const out: OrderedProjectedValue[] = [];
    for (const node of nodes.flatMap(n => expand(n, new Set(), false))) {
      const values = node.kind === "literal" ? node.literals : node.kind === "boolean" ? [true, false] : node.kind === "null" ? [null] : undefined;
      if (values === undefined) return undefined;
      for (const value of [...values, ...(node.nullable ? [null] : [])]) if (!out.some(v => ordered_projected_value_equal(v, value))) out.push(value);
    }
    return out;
  };
  const narrow = (nodes: readonly LiveMapSchemaNode[], value: OrderedProjectedValue | undefined, unknownKeys: readonly string[] = []): LiveMapSchemaNode[] => {
    if (nodes.length < 2 || !is_ordered_projected_object(value)) return [...nodes];
    return nodes.filter(node => node.kind !== "object" || (node.props ?? []).every(([key, rule]) => {
      if (unknownKeys.includes(key)) return true;
      const entry = value.entries.find(([name]) => name === key);
      if (entry === undefined) return true;
      const rules = expand(rule, new Set(), false);
      // Only literal evidence disambiguates; broad domains and constraints do not.
      if (!rules.every(r => r.kind === "literal")) return true;
      return finite(rules)?.some(v => ordered_projected_value_equal(v, entry[1])) === true;
    }));
  };
  return { expand, finite, narrow };
}
function literals(values: readonly OrderedProjectedValue[] | undefined): Draft[] {
  return (values ?? []).map(value => { const text = literalText(value); return { label: text, kind: "literal", insertText: text, snippet: false, detail: "declarative literal (constraints still validate)" }; });
}
function projectedCompletions(root: LiveMapSchemaNode, context: CompletionContext): Draft[] {
  const query = projectedQuery();
  let value = context.projected;
  const opaquePaths = [...context.unknownPaths, ...(context.kind === "value" ? [context.path] : [])];
  const unknownKeys = (path: readonly (string | number)[]) => opaquePaths.filter(p => p.length === path.length + 1 && path.every((part, i) => part === p[i])).flatMap(p => typeof p.at(-1) === "string" ? [String(p.at(-1))] : []);
  let nodes = query.narrow(query.expand(root), value, unknownKeys([]));
  const traversed: (string | number)[] = [];
  for (const part of context.path) {
    traversed.push(part);
    if (context.unknownPaths.some(p => p.length <= traversed.length && p.every((part, i) => part === traversed[i]))) return [];
    const next = nodes.map(node => typeof part === "string"
      ? node.kind === "object" ? node.props?.find(([key]) => key === part)?.[1] : node.kind === "record" ? node.record : undefined
      : node.kind === "array" ? node.item : node.kind === "tuple" && (!Array.isArray(value) || value.length <= (node.items?.length ?? 0)) ? node.items?.[part] : undefined);
    if (next.some(n => n === undefined)) return [];
    value = typeof part === "string" && is_ordered_projected_object(value) ? value.entries.find(([key]) => key === part)?.[1]
      : typeof part === "number" && Array.isArray(value) ? value[part] : undefined;
    nodes = query.narrow(next.flatMap(n => n === undefined ? [] : query.expand(n)), value, unknownKeys(traversed));
  }
  if (context.kind === "value") return literals(query.finite(nodes));
  if (context.kind !== "member" || nodes.length === 0 || nodes.some(n => n.kind !== "object")) return [];
  return (nodes[0].props ?? []).flatMap(([name]) => {
    if (context.existing.includes(name)) return [];
    const props = nodes.map(n => n.props?.find(([key]) => key === name)?.[1]);
    if (props.some(p => p === undefined)) return [];
    const rules = props.flatMap(p => p === undefined ? [] : [p]);
    const required = rules.every(r => !r.optional);
    const values = query.finite(rules);
    const spelling = templateSafe(serialize_hson_tag_name(name));
    const insertText = context.replacing ? spelling : values?.length === 1 ? `${spelling} ${literalText(values[0])}` : `${snippetText(spelling)} \${1}`;
    return [{ label: name, kind: "member", insertText, snippet: !context.replacing && values?.length !== 1, required,
      detail: `${required ? "required" : "optional/branch-dependent"} member${nodes.some(n => !n.exact) ? " (known declaration; open object)" : ""}` } satisfies Draft];
  });
}

type DocumentRoot = ReturnType<typeof require_document_root_schema>["node"];
type ElementNode = Extract<DocumentRoot, { kind: "element" }>;
type ContentNode = NonNullable<ElementNode["content"]>;
type ItemNode = Extract<ContentNode, { kind: "sequence" }>["items"][number];
function documentCompletions(schema: object, context: CompletionContext): Draft[] {
  if (context.projected !== undefined) return [];
  const root = require_document_root_schema(schema).node;
  let budget = 512;
  const items = (node: ItemNode): ItemNode[] => {
    if (--budget < 0) throw new Error("Completion traversal bound");
    return node.kind === "pick" ? node.choices.flatMap(items) : [node];
  };
  const child = (node: ContentNode | undefined, index: number, count?: number): ItemNode[] => {
    if (--budget < 0) throw new Error("Completion traversal bound");
    if (node === undefined) return [];
    if (node.kind === "pick") {
      // Content alternatives require a separate sequence-viability authority.
      return [];
    }
    if (node.kind === "sequence") return node.items[index] === undefined || (count !== undefined && count >= node.items.length) ? [] : items(node.items[index]);
    return node.count !== undefined && (index >= node.count || (count !== undefined && count >= node.count)) ? [] : items(node.item);
  };
  const mode = classify_live_root_mode(context.root);
  if (mode !== "element" && mode !== "fragment") return [];
  const observedTag = (path: readonly (string | number)[]): string | undefined => {
    const edges = path.flatMap(index => typeof index === "number" ? [{ kind: "content" as const, index }] : []);
    const result = resolve_internal_document_location(context.root, mode, edges);
    return result.kind === "node" ? result.value.$_tag : undefined;
  };
  let nodes: ItemNode[] = root.kind === "element" ? [root] : [];
  for (let i = 0; i < context.path.length; i++) {
    const index = context.path[i];
    if (typeof index !== "number") return [];
    if (i === 0 && root.kind === "fragment") nodes = child(root.content, index, i === context.path.length - 1 && !context.replacing ? context.childCount : undefined);
    else {
      const tag = observedTag(context.path.slice(0, i));
      const active = nodes.filter(n => n.kind === "element" && (n.tag === undefined || n.tag === tag));
      if (active.length !== 1 || active[0].kind !== "element") return [];
      nodes = child(active[0].content, index, i === context.path.length - 1 && !context.replacing ? context.childCount : undefined);
    }
  }
  const tagChoices = (choices: readonly ItemNode[], nameOnly: boolean): Draft[] => {
    const tags = new Set<string>();
    return choices.flatMap(node => {
      if (node.kind !== "element" || node.tag === undefined || tags.has(node.tag)) return [];
      tags.add(node.tag);
      const tag = templateSafe(serialize_hson_tag_name(node.tag));
      if (choices.filter(choice => choice.kind === "element" && choice.tag === node.tag).length > 1) {
        return [{ label: node.tag, kind: "tag", insertText: nameOnly ? tag : `<${snippetText(tag)} \${1}/>`, snippet: !nameOnly,
          detail: `<${node.tag}> element (multiple contracts; choose attrs/content explicitly)` } satisfies Draft];
      }
      const empty = node.content?.kind === "sequence" && node.content.items.length === 0;
      let placeholder = 1;
      const requiredAttrs = (node.attrs?.props ?? []).filter(([, rule]) => !rule.optional).map(([name, rule]) => {
        if (rule.flag) return ` ${snippetText(name)}`;
        const values = rule.valueSchema === undefined ? undefined : projectedQuery().finite([rule.valueSchema]);
        return values?.length === 1 && typeof values[0] === "string" ? ` ${snippetText(name)}=${snippetText(literalText(values[0]))}` : ` ${snippetText(name)}=\${${placeholder++}}`;
      }).join("");
      const content = node.content === undefined || empty ? "" : ` \${${placeholder}}`;
      return [{ label: node.tag, kind: "tag", insertText: nameOnly ? tag : `<${snippetText(tag)}${requiredAttrs}${content}/>`, snippet: !nameOnly, detail: `<${node.tag}> element` } satisfies Draft];
    });
  };
  if (context.kind === "tag" || context.kind === "child") return tagChoices(nodes, context.kind === "tag");
  const tag = observedTag(context.path);
  nodes = nodes.filter(n => n.kind === "element" && (n.tag === undefined || n.tag === tag));
  if (nodes.length !== 1 || nodes[0].kind !== "element") return [];
  const element = nodes[0];
  const query = projectedQuery();
  if (context.kind === "attribute-value") {
    const rule = element.attrs?.props.find(([name]) => name === context.attribute)?.[1];
    // Ordinary authored attrs are canonical strings. Do not fabricate a typed
    // primitive attr spelling when the parser cannot preserve that value.
    return rule?.flag || rule?.valueSchema === undefined ? [] : literals(query.finite([rule.valueSchema])?.filter(value => typeof value === "string"));
  }
  if (context.kind !== "header") return [];
  const attrs: Draft[] = (element.attrs?.props ?? []).flatMap(([name, rule]) => {
    if (context.existing.includes(name)) return [];
    const values = rule.valueSchema === undefined ? undefined : query.finite([rule.valueSchema])?.filter(value => typeof value === "string");
    const snippet = !rule.flag && !context.replacing && values?.length !== 1;
    return [{ label: name, kind: rule.flag ? "flag" : "attribute", required: !rule.optional,
      insertText: rule.flag || context.replacing ? name : values?.length === 1 ? `${name}=${literalText(values[0])}` : `${snippetText(name)}=\${1}`,
      snippet, detail: `${rule.optional ? "optional" : "required"} ${rule.flag ? "flag" : "attribute"}${element.attrs?.exact ? "" : " (known declaration; open attrs)"}` }];
  });
  return [...attrs, ...(context.childIndex === undefined ? [] : tagChoices(child(element.content, context.childIndex, context.childCount), false))];
}
