import { authored_event_completion_checkpoint } from "../hson-declarative.js";
import { AUTHORED_EVENT_FLAGS, AUTHORED_EVENT_TAG } from "../../core/authored-event-names.js";
import { is_hson_bare_name_char, is_valid_hson_attribute_name } from "../../core/hson-name.js";
import { map_static_hson_range, static_hson_literal_correspondence } from "../embedded-hson/static-hson-source.js";
import { event_destination_domain, type EventRange } from "../event-authoring-source.js";
import {
  AUTHORED_EVENT_NAMES, EVENT_ARGUMENT_QUALIFIERS, FORMDATA_OPERATIONS, formdata_operation,
  native_event_class, native_event_paths, native_event_scalar_qualifier,
} from "../event-argument-plan.js";
import { scan_formdata_operation } from "../event-operation-source.js";
import type { EventLiteral, PartSourceFacts } from "../hson-schema/part-source.js";
import { part_scalar_operand } from "../part-scalar.js";
import { scan_part_reference } from "../part-placeholder.js";
import type { HsonEditorCandidate } from "./query.js";

export type EventCompletion = Readonly<{ candidate: HsonEditorCandidate; range: EventRange; cursorInInsert?: number }>;

const actionDestinations = ["host:", "local:"] as const;
type EventCompletionContext = Readonly<{
  destinations: readonly typeof actionDestinations[number][];
  partReferences: boolean;
  actionNames?: readonly string[];
}>;
// The public tag admits both destinations and Part reference syntax. It
// establishes no binding or destination key at a future attachment.
const tagContext: EventCompletionContext = { destinations: actionDestinations, partReferences: true };

function event_completion_context(facts: PartSourceFacts, literal: EventLiteral): EventCompletionContext {
  const uses = facts.eventLiterals.get(literal);
  const owners = facts.eventOwners.get(literal);
  const actionNames = new Set<string>();
  // A reusable producer can have several owners. Only an unambiguous owner
  // supplies declaration-specific suggestions; both destination grammars remain legal.
  if (owners?.size === 1) for (const action of facts.actionDeclarations) {
    const name = action.domain + ":" + action.name;
    if (owners.has(action.owner) && is_valid_hson_attribute_name(name)) actionNames.add(name);
  }
  return { destinations: actionDestinations, actionNames: [...actionNames],
    partReferences: !uses?.has("document") || uses.has("part") || !facts.inlineEventLiterals.has(literal) };
}

export function tagged_event_completion_context(facts: PartSourceFacts, file: string, start: number): EventCompletionContext {
  const evidence = [...facts.eventLiterals].find(([literal]) => literal.getSourceFile().fileName === file
    && literal.getStart() === start);
  return evidence === undefined || evidence[1].size === 0 ? tagContext : event_completion_context(facts, evidence[0]);
}

export function query_hson_event_completion(facts: PartSourceFacts, file: string, offset: number): readonly EventCompletion[] {
  const evidence = [...facts.eventLiterals].find(([literal]) => literal.getSourceFile().fileName === file
    && literal.getStart() < offset && offset < literal.getEnd()
    && !("template" in literal.parent && literal.parent.template === literal));
  if (evidence === undefined) return [];
  const [literal] = evidence;
  const host = literal.getSourceFile();
  const correspondence = static_hson_literal_correspondence(host.text, host, literal);
  if (correspondence === undefined) return [];
  const cursor = offset === correspondence.bodyRange.end ? literal.text.length
    : correspondence.spans.find(span => span.hostRange.start === offset)?.runtimeRange.start;
  if (cursor === undefined) return [];
  const quote = host.text[correspondence.bodyRange.start - 1];
  const encode = (value: string): string => {
    if (quote === '"') return JSON.stringify(value).slice(1, -1);
    let escaped = value.replace(/./gsu, char => char === '"' ? char : JSON.stringify(char).slice(1, -1));
    if (quote === "'") escaped = escaped.replace(/'/g, "\\'");
    if (quote === "`") escaped = escaped.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    return escaped;
  };
  return map_event_completions(complete_authored_event(literal.text, cursor, event_completion_context(facts, literal)),
    range => map_static_hson_range(correspondence, range), encode);
}

/** Source and insertion encodings are independent. Map the requested cursor through the same encoding as the edit. */
export function map_event_completions(edits: readonly EventCompletion[], map: (range: EventRange) => EventRange | undefined,
  encode: (text: string) => string = text => text): readonly EventCompletion[] {
  return edits.flatMap(edit => {
    const range = map(edit.range);
    if (range === undefined) return [];
    const { insertText } = edit.candidate;
    return [{ range, candidate: { ...edit.candidate, insertText: encode(insertText) },
      ...(edit.cursorInInsert === undefined ? {} : { cursorInInsert: encode(insertText.slice(0, edit.cursorInInsert)).length }) }];
  });
}

export function complete_authored_event(source: string, cursor: number, context = tagContext): readonly EventCompletion[] {
  const observation = authored_event_completion_checkpoint(source, cursor);
  const slot = observation?.slot;
  if (slot === undefined || observation === undefined) return [];
  const result: EventCompletion[] = [];
  const add = (label: string, insertText: string, detail: string, cursorInInsert?: number,
    range = slot.range, kind: HsonEditorCandidate["kind"] = "syntax"): void => {
    result.push({ range, cursorInInsert, candidate: { label, kind, insertText, detail, sortText: String(result.length).padStart(4, "0") } });
  };
  const prefix = source.slice(slot.range.start, cursor);
  switch (slot.kind) {
    case "head": {
      const head = (slot.hasOpener ? "" : "<") + AUTHORED_EVENT_TAG;
      const empty = /^\s*$/.test(source.slice(slot.range.end));
      add(AUTHORED_EVENT_TAG, empty ? head + "  <>>" : head, "Authored Event declaration", empty ? head.length + 1 : undefined);
      break;
    }
    case "header": {
      const item = slot.item;
      const others = observation.flags.filter(flag => flag !== item);
      const selector = others.some(flag => flag.raw.startsWith("on:"));
      const destination = others.some(flag => event_destination_domain(flag.raw) !== undefined);
      const hasFlag = (name: string) => others.some(flag => flag.raw === name);
      const before = item === undefined && cursor > 0 && !/[ \t\r\n]/.test(source[cursor - 1]!) ? " " : "";
      const after = item === undefined && is_hson_bare_name_char(source[cursor] ?? "") ? " " : "";
      const header = (label: string, text: string, detail: string, caret?: number) =>
        add(label, before + text + after, detail, caret === undefined ? undefined : before.length + caret);
      if (!item?.valued) {
        if (!selector) for (const name of AUTHORED_EVENT_NAMES.keys()) {
          if (name.startsWith(prefix)) header(name, name, "Native Event selector");
        }
        if (!destination) for (const domain of context.destinations) {
          if (domain.startsWith(prefix)) header(domain, domain, "Enter the Action key", domain.length);
        }
        // At the right edge the grammar also permits inserting the next flag.
        // A longer declared key still replaces the complete destination token.
        const keyToken = item ?? observation.flags.find(flag => flag.end === cursor && event_destination_domain(flag.raw) !== undefined);
        const hasOtherDestination = observation.flags.some(flag => flag !== keyToken && event_destination_domain(flag.raw) !== undefined);
        if (!hasOtherDestination) for (const name of context.actionNames ?? []) {
          if (keyToken === undefined || item !== undefined) {
            if (name.startsWith(prefix)) header(name, name, "Authored Action declaration");
          } else if (name !== keyToken.raw && name.startsWith(keyToken.raw)) {
            add(name, name, "Authored Action declaration", undefined, keyToken);
          }
        }
        for (const [name, detail] of AUTHORED_EVENT_FLAGS) {
          if (name.startsWith(prefix) && !hasFlag(name) && !(name === "document" && hasFlag("window"))
            && !(name === "window" && hasFlag("document"))) header(name, name, detail);
        }
        if (item === undefined) header("name:type=value", ":", "Enter a named Event argument, then choose its qualifier", 0);
      }
      if (item?.argument !== undefined && item.raw.includes(":") && !observation.arguments.some(other => other !== item && other.argument === item.argument)) {
        const name = item.argument;
        const colon = item.raw.indexOf(":");
        const domain = !item.valued && (item.raw.startsWith("on:") || event_destination_domain(item.raw) !== undefined);
        const typePrefix = colon < 0 || cursor <= item.start + colon ? "" : prefix.slice(colon + 1);
        // A bare destination key stays available to native typing. A valued
        // spelling, even one named host/local/on, always uses argument grammar.
        if (!domain) {
          for (const type of EVENT_ARGUMENT_QUALIFIERS) {
            if (!type.startsWith(typePrefix)) continue;
            const label = `${name}:${type}`;
            add(label, label + (item.valued ? "" : "="), "Typed Event argument");
          }
        }
      }
      if (slot.outcome !== undefined
        && observation.flags.some(flag => AUTHORED_EVENT_NAMES.has(flag.raw))
        && observation.flags.some(flag => event_destination_domain(flag.raw) !== undefined && !flag.raw.endsWith(":"))) {
        const edit = slot.outcome === "missing" ? "<>>" : "<>";
        add(edit, (item === undefined ? before : " ") + edit, "Required empty Event outcome", undefined, { start: cursor, end: cursor });
      }
      break;
    }
    case "outcome":
      if (observation.flags.some(flag => AUTHORED_EVENT_NAMES.has(flag.raw))
        && observation.flags.some(flag => event_destination_domain(flag.raw) !== undefined)) add("<>", " <>", "Required empty Event outcome");
      break;
    case "outcomeClose":
      add(">>", ">>", "Close the empty outcome and Event declaration");
      break;
    case "declarationClose":
      add(">", ">", "Close the Event declaration");
      break;
    case "operand": {
      const { operand, reference } = slot;
      const family = observation.family;
      const qualifier = operand.qualifier;
      const fits = (kind: Parameters<typeof native_event_scalar_qualifier>[0]) => qualifier === "data" || qualifier === native_event_scalar_qualifier(kind);
      if (operand.form === "data") {
        const start = operand.start + 1, end = operand.end - Number(operand.closed);
        if (cursor < start || cursor > end) break;
        const inner = source.slice(start, end);
        const prefix = source.slice(start, cursor).trimStart();
        const empty = inner.trim() === "";
        if (!empty && !/^[ \t]*[a-z]+[ \t]*$/.test(inner)) break;
        const range = empty ? { start: cursor, end: cursor } : {
          start: start + inner.length - inner.trimStart().length, end: start + inner.trimEnd().length,
        };
        if (cursor < range.start || cursor > range.end) break;
        const values = qualifier === "bool" ? ["true", "false"] : qualifier === "arr" ? ["[]"]
          : qualifier === "data" ? ["null", "true", "false", "[]", "<>"] : [];
        for (const text of values) {
          if (text.startsWith(prefix)) add(text, text + (operand.closed ? "" : "}"), `:${qualifier} literal`,
            text === "[]" || text === "<>" ? 1 : undefined, range, "literal");
        }
        break;
      }
      if (operand.form === "missing") {
        const range = { start: cursor, end: cursor };
        const space = /^\w/.test(source[cursor] ?? "") ? " " : "";
        const literal = (text: string, at?: number) => add(text, text + space, `:${qualifier} literal`, at, range, "literal");
        if (qualifier === "str") literal('""', 1);
        if (qualifier === "num") literal('"0"', 2);
        if (qualifier === "bool") for (const text of ['"true"', '"false"', "{true}", "{false}"]) literal(text);
        if (qualifier === "arr" || qualifier === "data") literal("{[]}", 2);
        if (qualifier === "data") { literal("{<>}", 2); literal("{null}"); }
        if (context.partReferences) {
          add("%{name}", "%{}" + space, "Incoming Part reference syntax", 2, range, "reference");
          add("^{name}", "^{}" + space, "Local Part reference syntax", 2, range, "reference");
        }
        if (family !== undefined) {
          const paths = [...native_event_paths(family)].some(([, kind]) => fits(kind));
          if (paths) add(family, `^{${family}.}` + space, `Native ${native_event_class(family)} lookup`, family.length + 3, range, "reference");
          if (family === "formdata") {
            for (const method of FORMDATA_OPERATIONS) {
              const operation = formdata_operation(method, "");
              if (operation === undefined || !fits(operation.valueKind)) continue;
              const text = `^{formdata:${method}("")}`;
              add(`formdata:${method}`, text + space, "Native FormData operation", text.indexOf('"') + 1, range, "reference");
            }
          }
        }
        break;
      }
      if (reference === undefined) break;
      if (reference.escapedSigil) {
        if (reference.quoteMissing && qualifier === "str" && reference.cursor === reference.source.length
          && !/[<>]/.test(reference.source) && (context.partReferences || !reference.hasPartReference)) {
          add('"', '"', "Close the string literal", undefined, { start: cursor, end: cursor });
        }
        break;
      }
      const value = reference.source;
      const at = reference.cursor;
      const encode = (text: string) => reference.quoted ? JSON.stringify(text).slice(1, -1) : text;
      const quote = reference.quoteMissing ? '"' : "";
      const referenceEdit = (label: string, text: string, detail: string, range: EventRange, caret?: number) => {
        if (reference.quoteMissing && /[ \t\r\n<>]/.test(value)) return;
        const opener = value.slice(0, 2);
        const keep = range.start === 0 && (opener === "^{" || opener === "%{") && text.startsWith(opener) ? 2 : 0;
        const mapped = reference.map({ ...range, start: range.start + keep });
        if (mapped !== undefined) add(label, encode(text.slice(keep)) + quote, detail,
          caret === undefined ? undefined : encode(text.slice(keep, caret)).length, mapped, "reference");
      };
      const whole = { start: 0, end: value.length };
      if (reference.quoted && qualifier === "bool" && /^[A-Za-z]*$/.test(value)) {
        const range = reference.map(whole);
        if (range !== undefined) for (const text of ["true", "false"]) {
          if (text.startsWith(value.slice(0, at))) add(text, text + quote, "Boolean literal", undefined, range, "literal");
        }
      }
      if (reference.quoted && qualifier === "num" && value === "") {
        add("0", "0" + quote, "Finite number literal", undefined, { start: cursor, end: cursor }, "literal");
      }
      if (reference.quoteMissing && at === value.length && qualifier === "num") {
        try {
          if (part_scalar_operand("num", value).kind === "literal") {
            add('"', '"', "Close the finite number literal", undefined, { start: cursor, end: cursor });
          }
        } catch { /* An incomplete or invalid numeric prefix has no safe closer. */ }
      }
      if (context.partReferences && (value === "%" || value === "^")) {
        referenceEdit(value + "{name}", value + "{}", "Part reference syntax", whole, 2);
      }
      if (reference.operation !== undefined) {
        if (family !== "formdata") break;
        const { complete, field, methodEnd } = reference.operation;
        const methodStart = "^{formdata:".length;
        const methodPrefix = value.slice(methodStart, Math.min(at, methodEnd));
        const suffix = value.slice(methodEnd);
        const literal = field === undefined ? '""' : value.slice(field.start, field.end);
        for (const method of FORMDATA_OPERATIONS) {
          const operation = formdata_operation(method, "");
          if (operation === undefined || !fits(operation.valueKind)) continue;
          const text = `^{formdata:${method}(${literal})}`;
          if (at >= methodStart && at <= methodEnd + Number(suffix === "(") && method.startsWith(methodPrefix)
            && (complete || ["", "}", "("].includes(suffix) || field !== undefined && /^\("[\s\S]*"\)?$/.test(suffix))) {
            referenceEdit(`formdata:${method}`, text, "Native FormData operation", whole, field === undefined ? text.indexOf('"') + 1 : undefined);
          } else if (!complete && at === value.length && value.slice(methodStart, methodEnd) === method) {
            const closing = [")}", "}", '")}'].find(suffix => {
              try { return scan_formdata_operation(value + suffix, 0)?.reference.end === value.length + suffix.length; }
              catch { return false; }
            });
            if (closing !== undefined) referenceEdit("Close FormData operation", closing, "Complete the operation punctuation", { start: at, end: at });
          }
        }
        break;
      }
      if (reference.quoteMissing && at === value.length && qualifier === "str" && !/[<>]/.test(value)
        && (context.partReferences || !reference.hasPartReference)
        && (!value.startsWith("%{") && !value.startsWith("^{") || scan_part_reference(value, 0)?.end === value.length)) {
        add('"', '"', "Close the string literal", undefined, { start: cursor, end: cursor });
      }
      const { parsed, checkpoint } = reference.part ?? {};
      if (family === "formdata" && checkpoint?.start === 2 && "formdata".startsWith(checkpoint.prefix)
        && /^\^\{[A-Za-z]*}?$/.test(value)) {
        for (const method of FORMDATA_OPERATIONS) {
          const operation = formdata_operation(method, "");
          if (operation === undefined || !fits(operation.valueKind)) continue;
          const text = `^{formdata:${method}("")}`;
          referenceEdit(`formdata:${method}`, text, "Native FormData operation", whole, text.indexOf('"') + 1);
        }
      }
      if (parsed === undefined || parsed.end !== value.length) {
        if (value === "^" && family !== undefined && [...native_event_paths(family)].some(([, kind]) => fits(kind))) {
          referenceEdit(family, `^{${family}.}`, "Native Event lookup", whole, family.length + 3);
        }
        break;
      }
      if (checkpoint && checkpoint.start === 2 && parsed.namespace === "local" && family !== undefined) {
        if (/^[A-Za-z]*$/.test(parsed.reference) && family.startsWith(checkpoint.prefix)
          && [...native_event_paths(family)].some(([, kind]) => fits(kind))) {
          referenceEdit(family, `^{${family}.}`, "Native Event lookup", whole, family.length + 3);
        }
        for (const [path, kind] of native_event_paths(family)) {
          if (!fits(kind)) continue;
          const spellings = path.split(".").reduce<string[]>((choices, part) =>
            choices.flatMap(choice => [choice + "." + part, choice + "[" + JSON.stringify(part) + "]"]), [family]);
          const spelling = spellings.find(choice => choice.startsWith(checkpoint.prefix));
          if (spelling !== undefined) {
            const text = "^{" + spelling + (parsed.optional ? "?}" : "}");
            referenceEdit(family + "." + path, text, `${native_event_class(family)} ${kind === "number" ? "finite number" : kind}`, whole);
          }
        }
      }
      if (context.partReferences && checkpoint && checkpoint.start === 2 && (parsed.namespace !== "local" || parsed.name !== family)) {
        if (parsed.name === "") {
          referenceEdit(value[0] + "{name}", value[0] + "{}", "Enter a Part reference source name", whole, 2);
        } else if (at === value.length && !checkpoint.complete) {
          const closing = ["}", "]}", '"]}'].find(suffix =>
            scan_part_reference(value + suffix, 0)?.end === value.length + suffix.length);
          if (closing !== undefined) referenceEdit("Close Part reference", closing, "Complete the Part reference punctuation", { start: at, end: at });
        }
      }
      break;
    }
  }
  return result;
}
