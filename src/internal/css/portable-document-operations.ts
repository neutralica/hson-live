import type { LiveMapCssOp, LiveMapCssUnitOp } from "../../types/livemap.types.js";
import {
  decode_portable_document_stylesheet,
  encode_portable_document_stylesheet,
  type PortableDocumentStylesheet,
} from "./portable-document-stylesheet.js";

function fields(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid document CSS operation.");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Invalid document CSS operation prototype.");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(input);
  if (keys.some((key) => typeof key !== "string" || !required.includes(key) && !optional.includes(key))
    || required.some((key) => !Object.hasOwn(input, key))
    || keys.some((key) => typeof key === "string" && !("value" in descriptors[key]!))) {
    throw new TypeError("Invalid document CSS operation fields.");
  }
  return input as Record<string, unknown>;
}

function freeze_nested(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze_nested(child);
  Object.freeze(value);
}

function canonical_unit(input: unknown): LiveMapCssUnitOp {
  const header = fields(input, ["domain", "kind"], ["ruleKey", "scopes", "rule", "name", "definition"]);
  if (header.domain !== "css") throw new TypeError("Invalid document CSS operation domain.");
  if (header.kind === "clear-rules") {
    fields(input, ["domain", "kind"]);
    return { domain: "css", kind: "clear-rules" };
  }
  if (header.kind === "rule") {
    const value = fields(input, ["domain", "kind", "ruleKey", "scopes"], ["rule"]);
    const identity = decode_portable_document_stylesheet({
      rules: [{ ruleKey: value.ruleKey, selector: "x", scopes: value.scopes, declarations: [["color", "x"]] }],
      properties: [], keyframes: [],
    }).rules[0]!;
    if (!Object.hasOwn(value, "rule")) return { domain: "css", kind: "rule", ruleKey: identity.ruleKey, scopes: identity.scopes };
    const rule = encode_portable_document_stylesheet(decode_portable_document_stylesheet({
      rules: [value.rule], properties: [], keyframes: [],
    })).rules[0]!;
    if (rule.ruleKey !== identity.ruleKey || JSON.stringify(rule.scopes) !== JSON.stringify(identity.scopes)) {
      throw new TypeError("CSS rule operation identity disagrees with its definition.");
    }
    return { domain: "css", kind: "rule", ruleKey: identity.ruleKey, scopes: identity.scopes, rule };
  }
  if (header.kind === "property") {
    const value = fields(input, ["domain", "kind", "name"], ["definition"]);
    if (typeof value.name !== "string" || !value.name.startsWith("--") || value.name.length < 3) {
      throw new TypeError("Invalid document CSS @property name.");
    }
    if (!Object.hasOwn(value, "definition")) return { domain: "css", kind: "property", name: value.name };
    const definition = encode_portable_document_stylesheet(decode_portable_document_stylesheet({
      rules: [], properties: [value.definition], keyframes: [],
    })).properties[0]!;
    if (definition.name !== value.name) throw new TypeError("CSS @property operation name disagrees with its definition.");
    return { domain: "css", kind: "property", name: value.name, definition };
  }
  if (header.kind === "keyframes") {
    const value = fields(input, ["domain", "kind", "name"], ["definition"]);
    if (typeof value.name !== "string" || !value.name.trim() || value.name !== value.name.trim()) {
      throw new TypeError("Invalid document CSS keyframes name.");
    }
    if (!Object.hasOwn(value, "definition")) return { domain: "css", kind: "keyframes", name: value.name };
    const definition = encode_portable_document_stylesheet(decode_portable_document_stylesheet({
      rules: [], properties: [], keyframes: [value.definition],
    })).keyframes[0]!;
    if (definition.name !== value.name) throw new TypeError("CSS keyframes operation name disagrees with its definition.");
    return { domain: "css", kind: "keyframes", name: value.name, definition };
  }
  throw new TypeError("Invalid document CSS operation kind.");
}

/** Admit a detached canonical operation before publication or replay. */
export function canonical_portable_document_css_op(input: unknown): LiveMapCssOp {
  const header = fields(input, ["domain", "kind"], ["operations", "ruleKey", "scopes", "rule", "name", "definition"]);
  let result: LiveMapCssOp;
  if (header.kind === "batch") {
    const value = fields(input, ["domain", "kind", "operations"]);
    if (value.domain !== "css" || !Array.isArray(value.operations) || value.operations.length === 0) {
      throw new TypeError("CSS batch must contain operations.");
    }
    result = { domain: "css", kind: "batch", operations: value.operations.map(canonical_unit) };
  } else result = canonical_unit(input);
  freeze_nested(result);
  return result;
}

/** Apply a detached CSS commit unit. Decoding validates the complete candidate. */
export function apply_portable_document_css_op(
  current: PortableDocumentStylesheet,
  operation: LiveMapCssOp,
): PortableDocumentStylesheet {
  if (operation.kind === "batch") {
    if (!Array.isArray(operation.operations) || operation.operations.length === 0) {
      throw new TypeError("CSS batch must contain operations.");
    }
    return operation.operations.reduce((state, item) => apply_css_unit(state, item), current);
  }
  return apply_css_unit(current, operation);
}

function apply_css_unit(current: PortableDocumentStylesheet, operation: LiveMapCssUnitOp): PortableDocumentStylesheet {
  if (operation.domain !== "css") throw new TypeError("Invalid document CSS operation domain.");
  const encoded = encode_portable_document_stylesheet(current);
  if (operation.kind === "clear-rules") {
    return decode_portable_document_stylesheet({ ...encoded, rules: [] });
  }
  if (operation.kind === "rule") {
    const identity = JSON.stringify([operation.scopes, operation.ruleKey]);
    const rules = encoded.rules.filter((rule) => JSON.stringify([rule.scopes, rule.ruleKey]) !== identity);
    if (operation.rule !== undefined) {
      if (JSON.stringify([operation.rule.scopes, operation.rule.ruleKey]) !== identity) {
        throw new TypeError("CSS rule operation identity disagrees with its definition.");
      }
      const priorIndex = encoded.rules.findIndex((rule) => JSON.stringify([rule.scopes, rule.ruleKey]) === identity);
      if (priorIndex < 0) rules.push(operation.rule);
      else rules.splice(priorIndex, 0, operation.rule);
    }
    return decode_portable_document_stylesheet({ ...encoded, rules });
  }
  if (operation.kind === "property") {
    const properties = encoded.properties.filter((item) => item.name !== operation.name);
    if (operation.definition !== undefined) {
      if (operation.definition.name !== operation.name) throw new TypeError("CSS @property operation name disagrees with its definition.");
      properties.push(operation.definition);
    }
    return decode_portable_document_stylesheet({ ...encoded, properties });
  }
  const keyframes = encoded.keyframes.filter((item) => item.name !== operation.name);
  if (operation.definition !== undefined) {
    if (operation.definition.name !== operation.name) throw new TypeError("CSS keyframes operation name disagrees with its definition.");
    keyframes.push(operation.definition);
  }
  return decode_portable_document_stylesheet({ ...encoded, keyframes });
}
