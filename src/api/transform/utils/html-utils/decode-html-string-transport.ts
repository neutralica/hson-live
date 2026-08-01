import { _throw_transform_err } from "../sys-utils/throw-transform-err.utils.js";

/** Decode the JSON-string payload carried by an explicit `<_hson_str>` tag. */
export function decode_html_string_transport(raw: string, operation: string): string {
  try {
    const decoded: unknown = JSON.parse(raw);
    if (typeof decoded === "string") return decoded;
  } catch (cause) {
    _throw_transform_err(
      "<_hson_str> transport payload must be one JSON string",
      operation,
      raw,
      cause,
    );
  }
  return _throw_transform_err(
    "<_hson_str> transport payload must be one JSON string",
    operation,
    raw,
  );
}
