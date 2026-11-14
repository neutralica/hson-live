import type { HsonNode } from "../core/types.js";
import { is_event_attachment_attribute } from "../core/authored-event-names.js";

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

export const PART_QUALIFIERS = ["data", "doc", "str", "num"] as const;
export type PartQualifier = typeof PART_QUALIFIERS[number];
export type PartArgumentKind = "scalar" | PartQualifier;
export type PartScalarQualifier = "str" | "num";
export const is_part_scalar_qualifier = (kind: PartArgumentKind | undefined): kind is PartScalarQualifier =>
  kind === "str" || kind === "num";
export function is_part_scalar_argument(argument: ReturnType<typeof part_argument_name>):
  argument is Readonly<{ name: string; kind: PartScalarQualifier }> {
  return is_part_scalar_qualifier(argument?.kind);
}
const part_qualifier = (spelling: string | undefined): PartQualifier | undefined =>
  PART_QUALIFIERS.find(kind => kind === spelling);

/** Normalize sending suffixes; coordinates are never bindings. */
export function part_argument_name(raw: string): Readonly<{ name: string; kind: PartArgumentKind }> | undefined {
  const [name, suffix, extra] = raw.split(":");
  if (name === undefined || extra !== undefined || !is_part_parameter_name(name)
    || !is_part_argument_attribute(raw) || !is_part_argument_attribute(name)) return undefined;
  const kind = suffix === undefined ? "scalar" : part_qualifier(suffix);
  return kind === undefined ? undefined : { name, kind };
}

export function part_argument_issue(raw: string): string {
  const direction = part_direction_issue("hson-part", raw);
  if (direction !== undefined) return direction;
  const [name, suffix, extra] = raw.split(":");
  if (name !== undefined && is_part_parameter_name(name) && suffix !== undefined && extra === undefined && part_qualifier(suffix) === undefined) {
    return `Unknown Part argument qualifier ${JSON.stringify(suffix)} in ${JSON.stringify(raw)}.`;
  }
  return `Invalid hson-part parameter ${JSON.stringify(raw)}.`;
}

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

export function part_placeholder_matches(value: string, invalid?: (message: string) => void, literalSigils?: ReadonlySet<number>): readonly PartReference[] | undefined {
  const matches: PartReference[] = [];
  let at = 0;
  while ((at = next_part_reference(value, at)) !== -1) {
    if (literalSigils?.has(at)) { at++; continue; }
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

/** Receiving prefixes apply only to definition elements, never connectors. */
export function is_part_receiving_attribute(tag: string, name: string): boolean {
  return tag.toLowerCase() !== "hson-part" && name.includes(":") && part_qualifier(name.split(":")[0]) !== undefined;
}

/** Call only in governed Part contexts; ordinary HTML attributes keep their meaning.
 * Overlapping names such as data:data are interpreted by their receiving/sending position. */
export function part_direction_issue(tag: string, name: string, flag = false): string | undefined {
  if (is_part_iterator_attribute(name)) return undefined;
  const fields = name.split(":");
  if (fields.length < 2) return undefined;
  const prefix = part_qualifier(fields[0]), suffix = part_qualifier(fields.at(-1));
  if (tag.toLowerCase() === "hson-part") {
    if (prefix !== undefined && suffix === undefined) return `Part sending arguments use parameter:type; replace ${JSON.stringify(name)} with ${JSON.stringify(`${name.slice(prefix.length + 1)}:${prefix}`)}.`;
  } else if ((suffix === "data" || suffix === "doc") && prefix === undefined
    && !(flag && is_event_attachment_attribute(name))) {
    // Keep the existing structured migration. Scalar receivers have a known
    // prefix. A scalar suffix alone can also be an ordinary attribute name.
    return `Part receiving declarations use type:local; replace ${JSON.stringify(name)} with ${JSON.stringify(`${suffix}:${name.slice(0, -suffix.length - 1)}`)}.`;
  }
  return undefined;
}

/** A receiving declaration binds one incoming root, never a selected subtree. */
export type PartReceivingDeclaration = Readonly<{ name: string; kind: PartQualifier; reference: PartReference }>;
export function part_receiving_declaration(raw: string, value: unknown): PartReceivingDeclaration {
  const [prefix, name, extra] = raw.split(":");
  const kind = part_qualifier(prefix);
  const reference = typeof value === "string" ? whole_part_reference(value) : undefined;
  if (kind === undefined || name === undefined || extra !== undefined || !is_part_parameter_name(name)) {
    throw new TypeError(`Invalid Part receiving declaration ${JSON.stringify(raw)}.`);
  }
  if (reference === undefined || reference.namespace !== "incoming" || reference.path.length !== 0) {
    throw new TypeError(`Part receiving declaration ${JSON.stringify(raw)} requires one whole incoming argument reference.`);
  }
  if (is_part_iterator_attribute(`${reference.name}:`)) {
    const label = is_part_scalar_qualifier(kind) ? "Typed" : "Structured";
    throw new TypeError(`${label} Part input ${JSON.stringify(reference.name)} cannot be sent as ${JSON.stringify(`${reference.name}:${kind}`)}: ${JSON.stringify(`${reference.name}:`)} is reserved for Part iteration. Rename the incoming parameter in %{${reference.name}}; the local binding may keep its name.`);
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
export function part_placeholder_placement_issue(contentTags: readonly string[], attribute?: Readonly<{ name: string; value: unknown }>, tag?: string): string | undefined {
  if (contentTags.some(tag => ["script", "style"].includes(tag.toLowerCase()))) return "Part placeholders in script/style content are unsupported.";
  if (attribute !== undefined) {
    const argument = tag?.toLowerCase() === "hson-part" ? part_argument_name(attribute.name) : undefined;
    if ((argument === undefined || argument.kind === "scalar") && /^on/i.test(attribute.name) && typeof attribute.value === "string") return "Part placeholders in event-handler attributes are unsupported.";
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
