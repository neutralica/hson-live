import {
  HSON_META_MARKUP_PREFIX,
  HSON_META_TRANSIT_PREFIX,
  _TRANSIT_PREFIX,
} from "../../../../core/constants.js";
import { is_valid_hson_attribute_name } from "../../../../core/hson-name.js";
import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";

const XML_NAME =
  /^[A-Za-z_:\u00C0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][\w.\-:\u00B7\u0300-\u036F\u203F-\u2040]*$/u;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

type AttributeToken = {
  name: string;
  value: string;
  valueSource: string;
};

type KeptAttribute = AttributeToken & {
  comparisonKey: string;
  classTokens?: string[];
};

function encode_hex(value: string): string {
  return Array.from(textEncoder.encode(value), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function decode_hex(value: string): string | undefined {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/.test(value)) {
    return undefined;
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  try {
    return textDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

export function ordinary_attr_transit_name(name: string): string {
  const lower = name.toLowerCase();
  if (
    !is_valid_hson_attribute_name(name)
    || lower.startsWith(HSON_META_MARKUP_PREFIX)
    || lower.startsWith(HSON_META_TRANSIT_PREFIX)
    || lower.startsWith(_TRANSIT_PREFIX)
  ) {
    _throw_transform_err(
      `invalid ordinary HSON attribute name "${name}"`,
      "ordinary-attribute-transit",
    );
  }
  return `${_TRANSIT_PREFIX}${encode_hex(name)}`;
}

export function decode_ordinary_attr_transit_name(name: string): string | undefined {
  if (!name.startsWith(_TRANSIT_PREFIX)) return undefined;
  return decode_hex(name.slice(_TRANSIT_PREFIX.length));
}

export function is_ordinary_attr_transit_name(name: string): boolean {
  return name.toLowerCase().startsWith(_TRANSIT_PREFIX);
}

function is_namespace_plumbing(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "xmlns" || lower.startsWith("xmlns:") || lower.startsWith("xml:");
}

function needs_private_transit(name: string): boolean {
  return name.includes(":") || !XML_NAME.test(name);
}

function find_tag_end(source: string, start: number): number {
  let quote: "'" | '"' | undefined;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
}

function is_start_tag(tag: string): boolean {
  return !tag.startsWith("</")
    && !tag.startsWith("<!")
    && !tag.startsWith("<?");
}

function read_attributes(tag: string): {
  head: string;
  close: string;
  attributes: AttributeToken[];
} | undefined {
  let index = 1;
  while (/\s/.test(tag[index] ?? "")) index += 1;
  while (index < tag.length && !/[\s/>]/.test(tag[index] ?? "")) index += 1;
  if (index <= 1) return undefined;
  const head = tag.slice(0, index);
  const attributes: AttributeToken[] = [];

  while (index < tag.length) {
    while (/\s/.test(tag[index] ?? "")) index += 1;
    if (tag[index] === ">" || (tag[index] === "/" && tag[index + 1] === ">")) {
      return {
        head,
        close: tag.slice(index),
        attributes,
      };
    }

    const nameStart = index;
    while (index < tag.length && !/[\s=/>]/.test(tag[index] ?? "")) index += 1;
    const name = tag.slice(nameStart, index);
    if (name.length === 0) {
      _throw_transform_err("malformed opening-tag attribute token", "ordinary-attribute-transit");
    }

    while (/\s/.test(tag[index] ?? "")) index += 1;
    if (tag[index] !== "=") {
      attributes.push({ name, value: name, valueSource: `"${name}"` });
      continue;
    }
    index += 1;
    while (/\s/.test(tag[index] ?? "")) index += 1;
    const quote = tag[index];
    if (quote !== "'" && quote !== '"') {
      _throw_transform_err(
        `attribute "${name}" must have a quoted value before transport`,
        "ordinary-attribute-transit",
      );
    }
    index += 1;
    const valueStart = index;
    while (index < tag.length && tag[index] !== quote) index += 1;
    if (index >= tag.length) {
      _throw_transform_err(
        `attribute "${name}" has an unterminated quoted value`,
        "ordinary-attribute-transit",
      );
    }
    const value = tag.slice(valueStart, index);
    index += 1;
    attributes.push({
      name,
      value,
      valueSource: `${quote}${value}${quote}`,
    });
  }
  return undefined;
}

function escape_quoted(value: string): string {
  return value
    .replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function normalize_attributes(attributes: readonly AttributeToken[]): KeptAttribute[] {
  const kept = new Map<string, KeptAttribute>();
  const order: string[] = [];

  for (const attribute of attributes) {
    const lower = attribute.name.toLowerCase();
    if (lower.startsWith(HSON_META_TRANSIT_PREFIX)) {
      _throw_transform_err(
        `externally authored private HSON metadata transit name "${attribute.name}" is forbidden`,
        "ordinary-attribute-transit",
      );
    }
    if (lower.startsWith(_TRANSIT_PREFIX)) {
      _throw_transform_err(
        `externally authored private ordinary-attribute transit name "${attribute.name}" is forbidden`,
        "ordinary-attribute-transit",
      );
    }

    const metadata = lower.startsWith(HSON_META_MARKUP_PREFIX);
    if (!metadata && !is_valid_hson_attribute_name(attribute.name)) {
      _throw_transform_err(
        `invalid HSON attribute name "${attribute.name}"`,
        "ordinary-attribute-transit",
      );
    }
    if (metadata && kept.has(lower)) {
      _throw_transform_err(
        `duplicate HSON metadata attribute "${attribute.name}"`,
        "ordinary-attribute-transit",
      );
    }

    if (!kept.has(lower)) order.push(lower);
    if (lower === "class" && !metadata) {
      const existing = kept.get(lower);
      const classTokens = existing?.classTokens ?? [];
      for (const token of attribute.value.split(/\s+/).filter(Boolean)) {
        if (!classTokens.includes(token)) classTokens.push(token);
      }
      kept.set(lower, {
        ...attribute,
        name: existing?.name ?? attribute.name,
        comparisonKey: lower,
        value: classTokens.join(" "),
        valueSource: `"${escape_quoted(classTokens.join(" "))}"`,
        classTokens,
      });
      continue;
    }

    kept.set(lower, {
      ...attribute,
      name: metadata ? lower : (kept.get(lower)?.name ?? attribute.name),
      comparisonKey: lower,
    });
  }

  return order.map((key) => kept.get(key)!);
}

function rewrite_start_tag(tag: string, encodeTransit: boolean): string {
  const parsed = read_attributes(tag);
  if (parsed === undefined) return tag;
  const attributes = normalize_attributes(parsed.attributes);
  let output = parsed.head;

  for (const attribute of attributes) {
    const lower = attribute.name.toLowerCase();
    const metadata = lower.startsWith(HSON_META_MARKUP_PREFIX);
    const namespace = is_namespace_plumbing(attribute.name);
    const outputName =
      encodeTransit && !metadata && !namespace && needs_private_transit(attribute.name)
        ? ordinary_attr_transit_name(attribute.name)
        : attribute.name;
    output += ` ${outputName}=${attribute.valueSource}`;
  }
  return `${output}${parsed.close}`;
}

/**
 * Apply the established raw-HTML duplicate policy while original semantic
 * names are still visible, then optionally encode XML-hostile ordinary names
 * with a self-decoding private spelling.
 */
export function normalize_html_source_attributes(
  source: string,
  options: Readonly<{ encodeTransit?: boolean }> = {},
): string {
  let output = "";
  let cursor = 0;
  while (cursor < source.length) {
    const lt = source.indexOf("<", cursor);
    if (lt < 0) return output + source.slice(cursor);
    output += source.slice(cursor, lt);
    const end = find_tag_end(source, lt);
    if (end < 0) return output + source.slice(lt);
    const tag = source.slice(lt, end + 1);
    output += is_start_tag(tag)
      ? rewrite_start_tag(tag, options.encodeTransit === true)
      : tag;
    cursor = end + 1;
  }
  return output;
}
