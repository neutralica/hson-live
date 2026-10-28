import type { HsonNode } from "../core/types.js";

export const PART_OPTIONAL = "part:optional";
export const PART_DECLARATION = "hson:part";
export const PART_LOCAL_REFERENCE_MIGRATION = "Local Part references use ^{...}; replace the old #{...} spelling.";

/** Reserved construction syntax, classified before receiving/sending attributes. */
export function is_part_iterator_attribute(name: string): boolean { return name.startsWith("for:") || name.startsWith("per:"); }

export type PartIteratorDeclaration = Readonly<{ attribute: string; value?: string; source: PartReference } & (
  { kind: "array"; index?: string; key?: never } | { kind: "object"; key?: string; index?: never }
)>;

export function part_iterator_declaration(name: string, value: unknown): PartIteratorDeclaration {
  const fields = name.split(":");
  const first = fields[1], second = fields[2];
  if ((fields[0] !== "for" && fields[0] !== "per") || fields.length < 2 || fields.length > 3
    || first === undefined || (first !== "" && !is_part_parameter_name(first))
    || (fields.length === 2 ? first === "" : second === undefined || !is_part_parameter_name(second))
    || first === second) throw new TypeError("Part iteration requires for:item[:index], for::index, per:key[:value], or per::value with distinct valid aliases.");
  const source = typeof value === "string" ? whole_part_reference(value) : undefined;
  if (typeof value === "string" && value.startsWith("#{")) throw new TypeError(PART_LOCAL_REFERENCE_MIGRATION);
  if (source?.namespace !== "local") throw new TypeError("Part iteration requires one whole local ^{} Data reference.");
  return fields[0] === "for"
    ? { attribute: name, kind: "array", ...(first === "" ? {} : { value: first }), ...(second === undefined ? {} : { index: second }), source }
    : { attribute: name, kind: "object", ...(first === "" ? {} : { key: first }), ...(second === undefined ? {} : { value: second }), source };
}

export function part_node_iterator(node: HsonNode): PartIteratorDeclaration | undefined {
  const attributes = Object.entries(node.$_attrs ?? {}).filter(([name]) => is_part_iterator_attribute(name));
  if (attributes.length > 1) throw new TypeError("An element may declare only one Part iterator.");
  const attribute = attributes[0];
  return attribute === undefined ? undefined : part_iterator_declaration(attribute[0], attribute[1]);
}

/** Valued spellings must be rejected before ordinary string-flag normalization. */
export function part_declaration_issue(value: unknown, valued = false): string | undefined {
  return !valued && value === PART_DECLARATION ? undefined : "hson:part requires a flag, without a value.";
}

/** Hson flags canonically decode to their own spelling. */
export function part_optional_issue(value: unknown): string | undefined {
  return value === PART_OPTIONAL ? undefined : "part:optional requires a flag, without a value.";
}

/** Connector coordinates are reserved; every other public attribute is an input. */
export function is_part_argument_attribute(name: string): boolean {
  return !is_part_iterator_attribute(name) && !name.startsWith("^{") && name !== "lib" && name !== "at" && name !== PART_OPTIONAL && name !== PART_DECLARATION;
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
export type PartReference = Readonly<{ namespace: "incoming" | "local"; name: string; path: readonly (string | number)[]; optional: boolean; reference: string; start: number; end: number }>;

/** One bounded selector scanner, shared by runtime, source facts and editor checkpoints.
 * Quoted property keys use JSON escapes; braces inside a key never close a reference. */
export function scan_part_reference(value: string, start: number, incomplete = false): PartReference | undefined {
  if (!["%{", "^{"].includes(value.slice(start, start + 2))) return undefined;
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
  let optional = false;
  const result = (): PartReference => ({ namespace, name: root ?? "", path, optional, reference: value.slice(nameAt, at), start, end: at + (value[at] === "}" ? 1 : 0) });
  if (root === undefined) return atEnd() ? result() : undefined;
  while (at < value.length && value[at] !== "}") {
    if (value[at] === "?") {
      optional = true; at++;
      return value[at] === "}" || atEnd() ? result() : undefined;
    } else if (value[at] === ".") {
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

export function part_placeholder_matches(value: string, invalid?: (message: string) => void): readonly PartReference[] | undefined {
  const matches: PartReference[] = [];
  let at = 0;
  while ((at = next_part_reference(value, at)) !== -1) {
    const match = scan_part_reference(value, at);
    if (match === undefined) {
      invalid?.(value.startsWith("#{", at) ? PART_LOCAL_REFERENCE_MIGRATION : "Invalid Part placeholder.");
      return undefined;
    }
    matches.push(match); at = match.end;
  }
  return matches;
}

export function whole_part_reference(value: string): PartReference | undefined {
  if (!value.startsWith("%{") && !value.startsWith("^{")) return undefined;
  const match = scan_part_reference(value, 0);
  return match?.end === value.length ? match : undefined;
}

export function part_reference_text(reference: PartReference): string {
  return `${reference.namespace === "incoming" ? "%" : "^"}{${reference.reference}}`;
}

/** Connector sending syntax wins for the deliberately valid data:data spelling. */
export function is_part_receiving_attribute(tag: string, name: string): boolean {
  return !is_part_iterator_attribute(name) && (name.endsWith(":data") || name.endsWith(":doc"))
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
export function part_reference_checkpoint(value: string, cursor: number): Readonly<{ start: number; end: number; prefix: string; complete: boolean; optional?: true; namespace: "incoming" | "local" }> | undefined {
  let at = 0;
  while ((at = next_part_reference(value, at)) !== -1 && at + 2 <= cursor) {
    const match = scan_part_reference(value, at, true);
    if (match === undefined) return undefined;
    const complete = value[match.end - 1] === "}";
    const close = match.end - (complete ? 1 : 0);
    const end = close - (match.optional ? 1 : 0);
    if (cursor <= close) {
      if (scan_part_reference(value.slice(0, cursor), at, true) === undefined) return undefined;
      return { namespace: match.namespace, start: at + 2, end: close, prefix: value.slice(at + 2, Math.min(cursor, end)), complete,
        ...(match.optional ? { optional: true } : {}) };
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

export function part_structural_reference(node: HsonNode): PartReference | undefined {
  const attrs = node.$_attrs ?? {};
  if (Object.keys(attrs).some(name => name.startsWith("#{"))) throw new TypeError(PART_LOCAL_REFERENCE_MIGRATION);
  const keys = Object.keys(attrs).filter(name => name.startsWith("^{"));
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

export function has_part_reference(value: string): boolean { return /[%^]\{/.test(value); }
function next_part_reference(value: string, start: number): number {
  const incoming = value.indexOf("%{", start), local = value.indexOf("^{", start);
  // Legacy openers are invalid candidates, never executable references. Keeping
  // them in this walk also skips reference-looking text inside quoted selectors.
  const legacy = value.indexOf("#{", start);
  const next = incoming < 0 ? local : local < 0 ? incoming : Math.min(incoming, local);
  return next < 0 ? legacy : legacy < 0 ? next : Math.min(next, legacy);
}
