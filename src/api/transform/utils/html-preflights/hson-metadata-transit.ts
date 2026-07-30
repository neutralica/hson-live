import {
  HSON_META_MARKUP_PREFIX,
  HSON_META_TRANSIT_PREFIX,
} from "../../../../core/constants.js";
import { hson_metadata_candidate_key } from "../../../../core/hson-metadata.js";
import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

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

export function hson_metadata_transit_name(markupName: string): string {
  const candidate = hson_metadata_candidate_key(markupName);
  if (candidate === undefined || candidate.length === 0) {
    _throw_transform_err(
      `invalid HSON metadata markup name "${markupName}"`,
      "hson-metadata-transit",
    );
  }
  return `${HSON_META_TRANSIT_PREFIX}${encode_hex(candidate)}`;
}

export function decode_hson_metadata_transit_name(
  transitName: string,
): string | undefined {
  if (!transitName.startsWith(HSON_META_TRANSIT_PREFIX)) return undefined;
  const key = decode_hex(transitName.slice(HSON_META_TRANSIT_PREFIX.length));
  return key === undefined ? undefined : `${HSON_META_MARKUP_PREFIX}${key}`;
}

export function is_hson_metadata_transit_name(name: string): boolean {
  return name.startsWith(HSON_META_TRANSIT_PREFIX);
}

/**
 * Encode every syntactic `hson:<candidate>` attribute before XML parsing.
 * Exact registry admission intentionally happens after DOM enumeration.
 */
export function encode_hson_metadata_transit(src: string): string {
  let output = "";
  let cursor = 0;
  while (cursor < src.length) {
    const lt = src.indexOf("<", cursor);
    if (lt < 0) return output + src.slice(cursor);
    output += src.slice(cursor, lt);
    const end = find_tag_end(src, lt);
    if (end < 0) return output + src.slice(lt);
    const tag = src.slice(lt, end + 1);
    output += is_start_tag(tag) ? encode_start_tag(tag) : tag;
    cursor = end + 1;
  }
  return output;
}

/**
 * Restore metadata transit spellings produced internally before an XML-shaped
 * sanitizer pass. Caller-authored transit names must already have been
 * rejected by the source-aware attribute boundary.
 */
export function decode_hson_metadata_transit(src: string): string {
  let output = "";
  let cursor = 0;
  while (cursor < src.length) {
    const lt = src.indexOf("<", cursor);
    if (lt < 0) return output + src.slice(cursor);
    output += src.slice(cursor, lt);
    const end = find_tag_end(src, lt);
    if (end < 0) return output + src.slice(lt);
    const tag = src.slice(lt, end + 1);
    output += is_start_tag(tag) ? decode_start_tag(tag) : tag;
    cursor = end + 1;
  }
  return output;
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

function encode_start_tag(tag: string): string {
  let index = 1;
  while (/\s/.test(tag[index] ?? "")) index += 1;
  while (index < tag.length && !/[\s/>]/.test(tag[index] ?? "")) index += 1;
  let output = tag.slice(0, index);

  while (index < tag.length) {
    const char = tag[index];
    if (char === ">" || (char === "/" && tag[index + 1] === ">")) {
      return output + tag.slice(index);
    }
    if (/\s/.test(char ?? "")) {
      output += char;
      index += 1;
      continue;
    }

    const nameStart = index;
    while (index < tag.length && !/[\s=/>]/.test(tag[index] ?? "")) index += 1;
    const name = tag.slice(nameStart, index);
    if (name.startsWith(HSON_META_TRANSIT_PREFIX)) {
      _throw_transform_err(
        `externally authored private HSON metadata transit name "${name}" is forbidden`,
        "hson-metadata-transit",
      );
    }
    output += name.startsWith(HSON_META_MARKUP_PREFIX)
      ? hson_metadata_transit_name(name)
      : name;

    while (index < tag.length && /\s/.test(tag[index] ?? "")) {
      output += tag[index];
      index += 1;
    }
    if (tag[index] !== "=") continue;
    output += "=";
    index += 1;
    while (index < tag.length && /\s/.test(tag[index] ?? "")) {
      output += tag[index];
      index += 1;
    }
    const quote = tag[index];
    if (quote === "'" || quote === '"') {
      const valueStart = index;
      index += 1;
      while (index < tag.length && tag[index] !== quote) index += 1;
      if (index < tag.length) index += 1;
      output += tag.slice(valueStart, index);
      continue;
    }
    const valueStart = index;
    while (index < tag.length && !/[\s>]/.test(tag[index] ?? "")) index += 1;
    output += tag.slice(valueStart, index);
  }
  return output;
}

function decode_start_tag(tag: string): string {
  let index = 1;
  while (/\s/.test(tag[index] ?? "")) index += 1;
  while (index < tag.length && !/[\s/>]/.test(tag[index] ?? "")) index += 1;
  let output = tag.slice(0, index);

  while (index < tag.length) {
    const char = tag[index];
    if (char === ">" || (char === "/" && tag[index + 1] === ">")) {
      return output + tag.slice(index);
    }
    if (/\s/.test(char ?? "")) {
      output += char;
      index += 1;
      continue;
    }

    const nameStart = index;
    while (index < tag.length && !/[\s=/>]/.test(tag[index] ?? "")) index += 1;
    const name = tag.slice(nameStart, index);
    if (name.startsWith(HSON_META_TRANSIT_PREFIX)) {
      const decoded = decode_hson_metadata_transit_name(name);
      if (decoded === undefined) {
        _throw_transform_err(
          `malformed private HSON metadata transit name "${name}"`,
          "hson-metadata-transit",
        );
      }
      output += decoded;
    } else {
      output += name;
    }

    while (index < tag.length && /\s/.test(tag[index] ?? "")) {
      output += tag[index];
      index += 1;
    }
    if (tag[index] !== "=") continue;
    output += "=";
    index += 1;
    while (index < tag.length && /\s/.test(tag[index] ?? "")) {
      output += tag[index];
      index += 1;
    }
    const quote = tag[index];
    if (quote === "'" || quote === '"') {
      const valueStart = index;
      index += 1;
      while (index < tag.length && tag[index] !== quote) index += 1;
      if (index < tag.length) index += 1;
      output += tag.slice(valueStart, index);
      continue;
    }
    const valueStart = index;
    while (index < tag.length && !/[\s>]/.test(tag[index] ?? "")) index += 1;
    output += tag.slice(valueStart, index);
  }
  return output;
}
