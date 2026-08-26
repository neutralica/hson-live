export type HostSourceRange = Readonly<{
  start: number;
  end: number;
}>;

export type HostSourcePosition = Readonly<{
  offset: number;
  line: number;
  column: number;
}>;

export type EmbeddedHsonSource = Readonly<{
  fileName: string;
  hostText: string;
  tagRange: HostSourceRange;
  templateRange: HostSourceRange;
  bodyRange: HostSourceRange;
}>;

export type EmbeddedHsonSourceInvalidReason =
  | "descriptor-not-object"
  | "file-name-invalid"
  | "host-text-invalid"
  | "tag-range-invalid"
  | "template-range-invalid"
  | "body-range-invalid"
  | "tag-after-template"
  | "body-outside-template";

export type EmbeddedHsonSourceValidation =
  | Readonly<{
      status: "valid";
      source: EmbeddedHsonSource;
    }>
  | Readonly<{
      status: "invalid";
      reason: EmbeddedHsonSourceInvalidReason;
    }>;

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isOffset(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0;
}

function readRange(value: unknown, sourceLength: number): HostSourceRange | undefined {
  if (!isRecord(value)) return undefined;
  const start = value["start"];
  const end = value["end"];
  if (!isOffset(start) || !isOffset(end) || start > end || end > sourceLength) {
    return undefined;
  }
  return Object.freeze({ start, end });
}

/** Validate and freeze one exact original-host embedded HSON descriptor. */
export function validate_embedded_hson_source(
  value: unknown,
): EmbeddedHsonSourceValidation {
  if (!isRecord(value)) {
    return Object.freeze({ status: "invalid", reason: "descriptor-not-object" });
  }

  const fileName = value["fileName"];
  if (typeof fileName !== "string" || fileName.length === 0) {
    return Object.freeze({ status: "invalid", reason: "file-name-invalid" });
  }

  const hostText = value["hostText"];
  if (typeof hostText !== "string") {
    return Object.freeze({ status: "invalid", reason: "host-text-invalid" });
  }

  const tagRange = readRange(value["tagRange"], hostText.length);
  if (tagRange === undefined) {
    return Object.freeze({ status: "invalid", reason: "tag-range-invalid" });
  }
  const templateRange = readRange(value["templateRange"], hostText.length);
  if (templateRange === undefined) {
    return Object.freeze({ status: "invalid", reason: "template-range-invalid" });
  }
  const bodyRange = readRange(value["bodyRange"], hostText.length);
  if (bodyRange === undefined) {
    return Object.freeze({ status: "invalid", reason: "body-range-invalid" });
  }
  if (tagRange.end > templateRange.start) {
    return Object.freeze({ status: "invalid", reason: "tag-after-template" });
  }
  if (bodyRange.start < templateRange.start || bodyRange.end > templateRange.end) {
    return Object.freeze({ status: "invalid", reason: "body-outside-template" });
  }

  // Copying and freezing the ranges ensures the validated descriptor cannot be
  // detached from the exact host slices that were checked here.
  const source: EmbeddedHsonSource = Object.freeze({
    fileName,
    hostText,
    tagRange,
    templateRange,
    bodyRange,
  });
  return Object.freeze({ status: "valid", source });
}

export function read_embedded_hson_body(source: EmbeddedHsonSource): string {
  return source.hostText.slice(source.bodyRange.start, source.bodyRange.end);
}

/** Return the smallest Unicode-safe visible range at one UTF-16 source offset. */
export function source_point_range_at(
  sourceText: string,
  index: number,
): HostSourceRange | undefined {
  if (!isOffset(index) || index > sourceText.length) return undefined;
  if (index === sourceText.length) return Object.freeze({ start: index, end: index });
  const current = sourceText.charCodeAt(index);
  const next = sourceText.charCodeAt(index + 1);
  const previous = sourceText.charCodeAt(index - 1);
  const isHighSurrogate = current >= 0xD800 && current <= 0xDBFF;
  const isLowSurrogate = current >= 0xDC00 && current <= 0xDFFF;
  const nextIsLowSurrogate = next >= 0xDC00 && next <= 0xDFFF;
  const previousIsHighSurrogate = previous >= 0xD800 && previous <= 0xDBFF;
  if (isHighSurrogate && nextIsLowSurrogate) {
    return Object.freeze({ start: index, end: index + 2 });
  }
  if (isLowSurrogate && previousIsHighSurrogate) {
    return Object.freeze({ start: index - 1, end: index + 1 });
  }
  return Object.freeze({ start: index, end: index + 1 });
}

function buildLineStarts(hostText: string): readonly number[] {
  const starts = [0];
  let offset = 0;
  while (offset < hostText.length) {
    const codeUnit = hostText[offset];
    if (codeUnit === "\r") {
      offset += hostText[offset + 1] === "\n" ? 2 : 1;
      starts.push(offset);
    } else if (codeUnit === "\n") {
      offset += 1;
      starts.push(offset);
    } else {
      offset += 1;
    }
  }
  return starts;
}

function positionAt(
  lineStarts: readonly number[],
  offset: number,
): HostSourcePosition {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle];
    if (lineStart === undefined || lineStart > offset) high = middle - 1;
    else low = middle + 1;
  }
  const lineIndex = Math.max(0, high);
  const lineStart = lineStarts[lineIndex] ?? 0;
  return Object.freeze({
    offset,
    line: lineIndex + 1,
    column: offset - lineStart + 1,
  });
}

export type HostSourceLocator = Readonly<{
  positionAt(offset: number): HostSourcePosition | undefined;
}>;

/** Build one reusable line-start table for a host source. */
export function create_host_source_locator(hostText: string): HostSourceLocator | undefined {
  if (typeof hostText !== "string") return undefined;
  const lineStarts = buildLineStarts(hostText);
  return Object.freeze({
    positionAt(offset: number): HostSourcePosition | undefined {
      if (!isOffset(offset) || offset > hostText.length) return undefined;
      return positionAt(lineStarts, offset);
    },
  });
}

export function host_source_position_at(
  hostText: string,
  offset: number,
): HostSourcePosition | undefined {
  return create_host_source_locator(hostText)?.positionAt(offset);
}
