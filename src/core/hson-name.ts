import { HSON_SYS_PREFIX } from "./constants.js";

const BARE_NAME_START = /^[A-Za-z_:]$/;
const BARE_NAME_CHAR = /^[A-Za-z0-9:._-]$/;
const ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9:._-]*$/;

export function is_hson_bare_name_start(value: string): boolean {
  return BARE_NAME_START.test(value);
}

export function is_hson_bare_name_char(value: string): boolean {
  return BARE_NAME_CHAR.test(value);
}

/** Attribute, presence-flag, and metadata names share this unquoted grammar. */
export function is_valid_hson_attribute_name(value: string): boolean {
  return ATTRIBUTE_NAME.test(value);
}

/** Return whether one ordinary data name is outside Hson's structural namespace. */
export function is_valid_hson_data_name(value: unknown): value is string {
  return typeof value === "string" && !value.startsWith(HSON_SYS_PREFIX);
}

/** Require one ordinary canonical Hson data-object member name. */
export function assert_valid_hson_data_name(value: unknown): asserts value is string {
  if (is_valid_hson_data_name(value)) return;
  throw new TypeError(
    `Reserved Hson prefix ${JSON.stringify(HSON_SYS_PREFIX)} is not allowed in data object key ${JSON.stringify(value)}.`,
  );
}

export function is_bare_hson_name(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value);
}

export function quote_hson_name(value: string): string {
  let escaped = "";
  for (const char of value) {
    if (char === "\\") escaped += "\\\\";
    else if (char === "'") escaped += "\\'";
    else if (char === "\b") escaped += "\\b";
    else if (char === "\f") escaped += "\\f";
    else if (char === "\n") escaped += "\\n";
    else if (char === "\r") escaped += "\\r";
    else if (char === "\t") escaped += "\\t";
    else if (char.charCodeAt(0) < 0x20) escaped += `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
    else escaped += char;
  }
  return `'${escaped}'`;
}

export function serialize_hson_name(value: string): string {
  return is_bare_hson_name(value) ? value : quote_hson_name(value);
}
