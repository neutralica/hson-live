import {
  read_embedded_hson_body,
  type EmbeddedHsonSource,
  type HostSourceRange,
} from "./embedded-hson-source.js";
import {
  map_static_hson_range,
  type StaticHsonSource,
} from "./static-hson-source.js";

export type AuthoredHsonSource = EmbeddedHsonSource | StaticHsonSource;

export function is_static_hson_source(source: AuthoredHsonSource): source is StaticHsonSource {
  return "kind" in source && source.kind === "javascript-string";
}

export function read_authored_hson_source(source: AuthoredHsonSource): string {
  return is_static_hson_source(source) ? source.runtimeText : read_embedded_hson_body(source);
}

export function authored_hson_occurrence_range(source: AuthoredHsonSource): HostSourceRange {
  return is_static_hson_source(source) ? source.literalRange : source.templateRange;
}

export function map_authored_hson_range(source: AuthoredHsonSource, runtimeRange: HostSourceRange): HostSourceRange | undefined {
  if (is_static_hson_source(source)) return map_static_hson_range(source, runtimeRange);
  const length = source.bodyRange.end - source.bodyRange.start;
  if (!Number.isInteger(runtimeRange.start) || !Number.isInteger(runtimeRange.end)
    || runtimeRange.start < 0 || runtimeRange.end < runtimeRange.start || runtimeRange.end > length) return undefined;
  return Object.freeze({ start: source.bodyRange.start + runtimeRange.start, end: source.bodyRange.start + runtimeRange.end });
}
