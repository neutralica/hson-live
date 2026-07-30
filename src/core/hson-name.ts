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
