import type { HsonNode, Primitive } from "../core/types.js";
import { ROOT_TAG, STR_TAG } from "../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../core/node-guards.js";

export const PART_OPTIONAL = "part:optional";

/** Hson flags canonically decode to their own spelling. */
export function part_optional_issue(value: unknown): string | undefined {
  return value === PART_OPTIONAL ? undefined : "part:optional requires a flag, without a value.";
}

/** Part admission validates flag form even for definitions never invoked. */
export function validate_part_optional_flags(root: HsonNode): void {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (Object.hasOwn(node.$_attrs ?? {}, PART_OPTIONAL)) {
      const issue = part_optional_issue(node.$_attrs![PART_OPTIONAL]);
      if (issue !== undefined || !is_ordinary_element_node(node)) throw new TypeError(issue ?? "part:optional requires an element in a Part definition.");
    }
    for (const child of node.$_content) if (is_Node(child)) stack.push(child);
  }
}

/** Connector coordinates are reserved; every other public attribute is an input. */
export function is_part_argument_attribute(name: string): boolean {
  return !name.startsWith("#{") && name !== "lib" && name !== "at" && name !== PART_OPTIONAL;
}

export function is_part_parameter_name(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name);
}

/** Normalize explicit Data/Document sending prefixes; coordinates are never bindings. */
export function part_argument_name(raw: string): Readonly<{ name: string; kind: PartArgumentKind }> | undefined {
  const kind = raw.startsWith("data:") ? "data" : raw.startsWith("doc:") ? "doc" : "scalar";
  const name = kind === "scalar" ? raw : raw.slice(kind === "data" ? 5 : 4);
  return is_part_parameter_name(name) && is_part_argument_attribute(name) ? { name, kind } : undefined;
}

export type PartArgumentKind = "scalar" | "data" | "doc";
export type PartReference = Readonly<{ namespace: "incoming" | "local"; name: string; path: readonly (string | number)[]; reference: string; start: number; end: number }>;

/** One bounded selector scanner, shared by runtime, source facts and editor checkpoints.
 * Quoted property keys use JSON escapes; braces inside a key never close a reference. */
export function scan_part_reference(value: string, start: number, incomplete = false): PartReference | undefined {
  if (!["%{", "#{"].includes(value.slice(start, start + 2))) return undefined;
  const namespace = value[start] === "%" ? "incoming" : "local";
  let at = start + 2;
  const nameAt = at;
  const name = (): string | undefined => {
    if (!/[A-Za-z_]/.test(value[at] ?? "")) return undefined;
    const begin = at++;
    while (at < value.length && /[A-Za-z0-9_-]/.test(value[at]!)) at++;
    return value.slice(begin, at);
  };
  const atEnd = (): boolean => incomplete && (at === value.length || value[at] === "}");
  const root = name();
  const path: (string | number)[] = [];
  const result = (): PartReference => ({ namespace, name: root ?? "", path, reference: value.slice(nameAt, at), start, end: at + (value[at] === "}" ? 1 : 0) });
  if (root === undefined) return atEnd() ? result() : undefined;
  while (at < value.length && value[at] !== "}") {
    if (value[at] === ".") {
      at++;
      const key = name();
      if (key === undefined) return atEnd() ? result() : undefined;
      path.push(key);
    } else if (value[at] === "[") {
      at++;
      if (value[at] === '"') {
        const begin = at++;
        while (at < value.length && value[at] !== '"') {
          if (value[at] === "\\") at++;
          at++;
        }
        if (at >= value.length) return incomplete ? { ...result(), end: value.length, reference: value.slice(nameAt) } : undefined;
        let key: unknown;
        try { key = JSON.parse(value.slice(begin, ++at)); } catch { return undefined; }
        if (typeof key !== "string") return undefined;
        path.push(key);
      } else {
        const begin = at;
        while (at < value.length && /[0-9]/.test(value[at]!)) at++;
        const token = value.slice(begin, at), index = Number(token);
        if (!/^(0|[1-9][0-9]*)$/.test(token) || !Number.isSafeInteger(index)) {
          return atEnd() && begin === at ? result() : undefined;
        }
        path.push(index);
      }
      if (value[at] !== "]") return atEnd() ? result() : undefined;
      at++;
    } else return undefined;
  }
  return value[at] === "}" || atEnd() ? result() : undefined;
}

export function part_placeholder_matches(value: string): readonly PartReference[] | undefined {
  const matches: PartReference[] = [];
  let at = 0;
  while ((at = next_part_reference(value, at)) !== -1) {
    const match = scan_part_reference(value, at);
    if (match === undefined) return undefined;
    matches.push(match); at = match.end;
  }
  return matches;
}

export function whole_part_reference(value: string): PartReference | undefined {
  if (!value.startsWith("%{") && !value.startsWith("#{")) return undefined;
  const match = scan_part_reference(value, 0);
  return match?.end === value.length ? match : undefined;
}

export function part_reference_text(reference: PartReference): string {
  return `${reference.namespace === "incoming" ? "%" : "#"}{${reference.reference}}`;
}

/** Connector sending syntax wins for the deliberately valid data:data spelling. */
export function is_part_receiving_attribute(tag: string, name: string): boolean {
  return (name.endsWith(":data") || name.endsWith(":doc"))
    && !(tag.toLowerCase() === "hson-part" && (name.startsWith("data:") || name.startsWith("doc:")));
}

/** A receiving declaration binds one incoming structured root, never a selected subtree. */
export type PartReceivingDeclaration = Readonly<{ name: string; kind: "data" | "doc"; reference: PartReference }>;
export function part_receiving_declaration(raw: string, value: unknown): PartReceivingDeclaration {
  const kind = raw.endsWith(":doc") ? "doc" : "data";
  const name = raw.slice(0, kind === "data" ? -5 : -4);
  const reference = typeof value === "string" ? whole_part_reference(value) : undefined;
  if (!(raw.endsWith(":data") || raw.endsWith(":doc")) || !is_part_parameter_name(name) || !is_part_argument_attribute(name)) {
    throw new TypeError(`Invalid Part receiving declaration ${JSON.stringify(raw)}.`);
  }
  if (reference === undefined || reference.namespace !== "incoming" || reference.path.length !== 0) {
    throw new TypeError(`Part receiving declaration ${JSON.stringify(raw)} requires one whole incoming argument reference.`);
  }
  return { name, kind, reference };
}

/** Exact decoded replacement span, including selectors but excluding %{ and }. */
export function part_reference_checkpoint(value: string, cursor: number): Readonly<{ start: number; end: number; prefix: string; complete: boolean; namespace: "incoming" | "local" }> | undefined {
  let at = 0;
  while ((at = next_part_reference(value, at)) !== -1 && at + 2 <= cursor) {
    const match = scan_part_reference(value, at, true);
    if (match === undefined) return undefined;
    const complete = value[match.end - 1] === "}";
    const end = match.end - (complete ? 1 : 0);
    if (cursor <= end) {
      if (scan_part_reference(value.slice(0, cursor), at, true) === undefined) return undefined;
      return { namespace: match.namespace, start: at + 2, end, prefix: value.slice(at + 2, cursor), complete };
    }
    at = match.end;
  }
  return undefined;
}

/** contentTags are the owners of enclosing content, excluding an attribute's own element. */
export function part_placeholder_placement_issue(contentTags: readonly string[], attribute?: Readonly<{ name: string; value: unknown }>): string | undefined {
  if (contentTags.some(tag => ["script", "style"].includes(tag.toLowerCase()))) return "Part placeholders in script/style content are unsupported.";
  if (attribute !== undefined) {
    if (/^on/i.test(attribute.name) && typeof attribute.value === "string") return "Part placeholders in event-handler attributes are unsupported.";
    if (typeof attribute.value === "object" && attribute.value !== null) return "Part placeholders in structured attributes are unsupported.";
  }
  return undefined;
}

/** Shared placement checks over an already detached, qualified document. */
export function transform_part_parameter_strings(root: HsonNode,
  substitute: (value: string, node: HsonNode, owner: HsonNode) => Primitive | undefined,
  forwarding?: (reference: PartReference, node: HsonNode, kind: "data" | "doc") => void,
  receiving?: (declarations: readonly PartReceivingDeclaration[]) => void,
  traversal?: Readonly<{
    enter?: (node: HsonNode, parent: HsonNode | undefined) => boolean | void;
    leave?: (node: HsonNode, parent: HsonNode | undefined) => void;
    inspect?: boolean;
    structure?: (reference: PartReference, node: HsonNode) => void;
  }>): void {
  const element = root.$_tag === ROOT_TAG && root.$_content.length === 1 && is_Node(root.$_content[0]) ? root.$_content[0] : undefined;
  const declarations = Object.entries(element?.$_attrs ?? {}).filter(([name]) => element !== undefined && is_part_receiving_attribute(element.$_tag, name))
    .map(([name, value]) => part_receiving_declaration(name, value));
  receiving?.(declarations);
  const stack: { node: HsonNode; owner: HsonNode; parent?: HsonNode; leaving?: boolean }[] = [{ node: root, owner: root }];
  while (stack.length) {
    const job = stack.pop()!, { node, parent } = job;
    const owner = is_ordinary_element_node(node) ? node : job.owner;
    if (job.leaving) { traversal?.leave?.(node, parent); continue; }
    if (traversal?.enter?.(node, parent) === false) continue;
    stack.push({ ...job, leaving: true });
    if (has_part_reference(node.$_tag)) throw new TypeError("Part placeholders cannot occur in tags.");
    if (node.$_meta !== undefined && has_part_reference(JSON.stringify(node.$_meta))) throw new TypeError("Part placeholders cannot occur in identity metadata.");
    if (node.$_attrs !== undefined) {
      const attrs: NonNullable<HsonNode["$_attrs"]> = Object.create(null);
      for (const [name, value] of Object.entries(node.$_attrs)) {
        if (name === PART_OPTIONAL) {
          const issue = part_optional_issue(value);
          if (issue !== undefined || !is_ordinary_element_node(node)) throw new TypeError(issue ?? "part:optional requires an element in a Part definition.");
          continue;
        }
        if (is_part_receiving_attribute(node.$_tag, name)) {
          if (node !== element) throw new TypeError("Part receiving declarations are only allowed on the single definition root.");
          continue; // Compile-time receiving interface; never part of realized attributes.
        }
        if (name.startsWith("#{")) {
          const reference = part_structural_reference(node);
          if (reference === undefined) throw new TypeError("Invalid structural Part reference.");
          traversal?.structure?.(reference, node);
          attrs[name] = value;
          continue;
        }
        if (has_part_reference(name)) throw new TypeError("Part placeholders cannot occur in attribute names.");
        const issue = part_placeholder_placement_issue([], { name, value });
        if (issue !== undefined && (typeof value === "string" ? has_part_reference(value) : value !== null && typeof value === "object" && has_part_reference(JSON.stringify(value)))) throw new TypeError(issue);
        if (node.$_tag.toLowerCase() === "hson-part" && (name.startsWith("data:") || name.startsWith("doc:"))) {
          const reference = typeof value === "string" ? whole_part_reference(value) : undefined;
          if (reference !== undefined) forwarding?.(reference, node, name.startsWith("data:") ? "data" : "doc");
          attrs[name] = value;
        } else {
          const replacement = typeof value === "string" ? substitute(value, node, owner) : value;
          if (replacement !== undefined) attrs[name] = replacement;
        }
      }
      if (!traversal?.inspect) node.$_attrs = attrs;
    }
    if (node.$_tag === STR_TAG && typeof node.$_content[0] === "string") {
      const value = substitute(node.$_content[0], node, owner);
      // Canonical document text is STR-only; strong scalar types apply to attributes.
      if (value !== undefined && !traversal?.inspect) node.$_content = [String(value)];
    } else {
      const issue = part_placeholder_placement_issue([node.$_tag]);
      if (issue !== undefined && has_part_reference(JSON.stringify(node.$_content))) throw new TypeError(issue);
      for (let index = node.$_content.length - 1; index >= 0; index--) {
        const child = node.$_content[index];
        if (is_Node(child)) stack.push({ node: child, owner, parent: node });
      }
    }
  }
}

/** The exact surface spelling is its own flag representation. No private attribute alias. */
export function part_structural_reference(node: HsonNode): PartReference | undefined {
  const attrs = node.$_attrs ?? {};
  const keys = Object.keys(attrs).filter(name => name.startsWith("#{"));
  if (!keys.length) return undefined;
  const key = keys[0]!;
  const reference = whole_part_reference(key);
  if (node.$_tag.toLowerCase() !== "hson-part" || keys.length !== 1 || reference?.namespace !== "local"
    || reference.path.length || attrs[key] !== key || node.$_content.length
    || Object.keys(attrs).some(name => name !== key && name !== PART_OPTIONAL)) {
    throw new TypeError("Structural hson-part requires one standalone local Document reference, optional flag, and no lib/at or arguments.");
  }
  return reference;
}

export function has_part_reference(value: string): boolean { return /[%#]\{/.test(value); }
function next_part_reference(value: string, start: number): number {
  const incoming = value.indexOf("%{", start), local = value.indexOf("#{", start);
  return incoming < 0 ? local : local < 0 ? incoming : Math.min(incoming, local);
}

/** One receiving interface normalizer, used by governed write and composition. */
export function part_receiving_interface(root: HsonNode): ReadonlyMap<string, PartArgumentKind> {
  const names = new Map<string, PartArgumentKind>(), locals = new Map<string, "data" | "doc">();
  const add = (name: string, kind: PartArgumentKind) => {
    if (names.has(name) && names.get(name) !== kind) throw new TypeError(`Conflicting Part input ${JSON.stringify(name)}.`);
    names.set(name, kind);
  };
  const observe = (reference: PartReference, structure = false) => {
    if (reference.namespace === "incoming") {
      if (reference.path.length || structure) throw new TypeError("Structured Part inputs require a declared local binding and #{} reference.");
      add(reference.name, "scalar");
    } else {
      const kind = locals.get(reference.name);
      if (kind === undefined) throw new TypeError(`Missing Part local declaration ${JSON.stringify(reference.name)}.`);
      if (structure ? kind !== "doc" : reference.path.length && kind !== "data") throw new TypeError("Part reference does not match its declared representation.");
    }
  };
  transform_part_parameter_strings(root, value => {
    const references = part_placeholder_matches(value);
    if (references === undefined) throw new TypeError("Invalid Part placeholder.");
    references.forEach(reference => observe(reference)); return value;
  }, (reference, _node, kind) => {
    observe(reference);
    if (reference.namespace !== "local" || locals.get(reference.name) !== kind) throw new TypeError("Typed Part forwarding requires the same declared representation.");
  }, declarations => {
    for (const declaration of declarations) {
      if (locals.has(declaration.name)) throw new TypeError(`Conflicting Part local binding ${JSON.stringify(declaration.name)}.`);
      locals.set(declaration.name, declaration.kind); add(declaration.reference.name, declaration.kind);
    }
  }, { inspect: true, structure: reference => observe(reference, true) });
  return names;
}
