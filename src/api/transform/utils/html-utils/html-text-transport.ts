import { escape_html_text } from "./escape-html.js";
import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";

const TEXT_PREFIX = "hson-text:";
const RAW_PREFIX = "/*hson-raw:";

/** UTF-16 code-unit encoding retains NUL and lone surrogates without UTF-8 repair. */
function hex16(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return encoded;
}

function unhex16(value: string, operation: string): string {
  if (value.length % 4 !== 0 || !/^[0-9a-f]*$/.test(value)) {
    _throw_transform_err("malformed reserved Hson text payload", operation);
  }
  let decoded = "";
  for (let index = 0; index < value.length; index += 4) {
    decoded += String.fromCharCode(Number.parseInt(value.slice(index, index + 4), 16));
  }
  return decoded;
}

function xml_display(value: string): string {
  let display = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x0d) {
      display += "\r";
    } else if (code >= 0xd800 && code <= 0xdbff
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      display += value[index] + value[index + 1];
      index += 1;
    } else if ((code < 0x20 && code !== 0x09 && code !== 0x0a)
      || (code >= 0xd800 && code <= 0xdfff)
      || code === 0xfffe || code === 0xffff) {
      display += "\ufffd";
    } else {
      display += value[index];
    }
  }
  return escape_html_text(display).replaceAll("\r", "&#13;");
}

/** One reserved boundary annotation per semantic string leaf; text stays HTML text. */
export function encode_html_text_leaf(value: string): string {
  return "<!--" + TEXT_PREFIX + hex16(value) + "-->" + xml_display(value);
}

/** A lone, unambiguous ordinary HTML text node needs no boundary annotation. */
export function can_melt_html_text_leaf(value: string): boolean {
  return value.length > 0 && value.trim() === value && value !== '""'
    && !/[\u0000-\u001f\ud800-\udfff\ufffe\uffff]/.test(value);
}

/** Undefined means an unrelated HTML comment, including browser-plan markers. */
export function decode_html_text_boundary(comment: string, operation: string): string | undefined {
  if (!comment.startsWith(TEXT_PREFIX)) {
    if (comment.startsWith("hson-text")) {
      _throw_transform_err("malformed reserved Hson text boundary", operation);
    }
    return undefined;
  }
  return unhex16(comment.slice(TEXT_PREFIX.length), operation);
}

/** ASCII, less-than-free RAWTEXT token; every nonempty body has one wire mode. */
export function encode_html_raw_text(values: readonly string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return RAW_PREFIX + hex16(values[0]) + "*/";
  return RAW_PREFIX + "a:" + hex16(JSON.stringify(values)) + "*/";
}

/** Trusted RAWTEXT ingress only. External/untrusted HTML never enters here. */
export function decode_html_raw_text(raw: string, operation: string): readonly string[] {
  if (raw === "") return [];
  if (!raw.startsWith(RAW_PREFIX)) {
    if (raw.includes("/*hson-raw:")) {
      _throw_transform_err("malformed or misplaced reserved Hson raw-text token", operation);
    }
    // Trusted ingress also accepts native HTML source with literal RAWTEXT.
    return [raw];
  }
  const match = /^\/\*hson-raw:(a:)?([0-9a-f]*)\*\/$/.exec(raw);
  if (match === null) _throw_transform_err("malformed reserved Hson raw-text token", operation);
  const payload = unhex16(match[2], operation);
  if (match[1] === undefined) return [payload];
  let values: unknown;
  try {
    values = JSON.parse(payload);
  } catch {
    _throw_transform_err("malformed reserved Hson raw-text array", operation);
  }
  if (!Array.isArray(values) || values.length < 2 || !values.every((value) => typeof value === "string")) {
    _throw_transform_err("malformed reserved Hson raw-text array", operation);
  }
  return values;
}
