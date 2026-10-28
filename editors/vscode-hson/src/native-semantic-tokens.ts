/** Codec for TypeScript's public SemanticClassificationFormat.TwentyTwenty.
 * This is the versioned wire format, not a legend inferred from VS Code's
 * provider registry. Shared by the existing tsserver plugin and the merger.
 * https://github.com/microsoft/TypeScript/blob/v5.9.3/src/services/classifier2020.ts
 * The protocol calls slot 11 `member`; VS Code exposes that slot as `method`.
 */
export const nativeTokenTypes = ["class", "enum", "interface", "namespace", "typeParameter", "type",
  "parameter", "variable", "enumMember", "property", "function", "method"];
export const nativeTokenModifiers = ["declaration", "static", "async", "readonly", "defaultLibrary", "local"];
export const NATIVE_SEMANTIC_COMMAND = "_hson.nativeSemanticTokens";
export const NATIVE_SEMANTIC_PROTOCOL = "typescript-2020-v1";
export const NATIVE_REQUEST_LIMIT = 50_000;
export const SEMANTIC_DOCUMENT_LIMIT = 1_000_000;

export type NativeToken = Readonly<{
  start: number; end: number; line: number; character: number; length: number; type: string; modifiers: string[];
}>;
export interface SemanticDocument {
  readonly lineCount: number;
  lineAt(line: number): Readonly<{ text: string; range: Readonly<{ start: Readonly<{ line: number; character: number }> }> }>;
  offsetAt(position: Readonly<{ line: number; character: number }>): number;
}
export type NativeRequest = Readonly<{ file: string; start: number; length: number; textHash: string; requestId: string }>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}
function uint(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
function splitsSurrogate(text: string, index: number): boolean {
  const before = text.charCodeAt(index - 1), after = text.charCodeAt(index);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/** Validate the complete stream before returning any tokens to the merger.
 * TS can return complete identifiers beyond a requested boundary because their
 * leading trivia intersects it. Chunk ownership is applied only after validation. */
export function decode_native_tokens(document: SemanticDocument, legend: unknown, data: unknown): NativeToken[] | undefined {
  if (!isRecord(legend) || !isStrings(legend.tokenTypes) || !isStrings(legend.tokenModifiers)
    || new Set(legend.tokenTypes).size !== legend.tokenTypes.length
    || new Set(legend.tokenModifiers).size !== legend.tokenModifiers.length
    || legend.tokenTypes.some(type => !nativeTokenTypes.includes(type))
    || legend.tokenModifiers.some(modifier => !nativeTokenModifiers.includes(modifier))
    || !(Array.isArray(data) || data instanceof Uint32Array) || data.length % 5 !== 0) return undefined;
  const result: NativeToken[] = [];
  let line = 0, character = 0, previousEnd = -1;
  for (let index = 0; index < data.length; index += 5) {
    const delta: unknown = data[index], column: unknown = data[index + 1], length: unknown = data[index + 2];
    const typeIndex: unknown = data[index + 3], bits: unknown = data[index + 4];
    if (!uint(delta) || !uint(column) || !uint(length) || length === 0 || !uint(typeIndex) || !uint(bits)
      || typeIndex >= legend.tokenTypes.length || bits >= 2 ** legend.tokenModifiers.length) return undefined;
    line += delta;
    character = delta === 0 ? character + column : column;
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(character) || line >= document.lineCount) return undefined;
    const physicalLine = document.lineAt(line), text = physicalLine.text;
    if (character + length > text.length || splitsSurrogate(text, character) || splitsSurrogate(text, character + length)) return undefined;
    const start = document.offsetAt(physicalLine.range.start) + character, end = start + length;
    if (start < previousEnd) return undefined;
    previousEnd = end;
    result.push({ start, end, line, character, length, type: legend.tokenTypes[typeIndex]!,
      modifiers: legend.tokenModifiers.filter((_, bit) => (bits & (1 << bit)) !== 0) });
  }
  return result;
}

/** A single plugin response owns both the 2020 codec and the encoded stream.
 * Content digest, request identity, and exact bounded span bind it to this read. */
export function decode_native_response(document: SemanticDocument, request: Omit<NativeRequest, "file">, value: unknown): NativeToken[] | undefined {
  if (!isRecord(value) || value.type !== "response" || value.success !== true || !isRecord(value.body)) return undefined;
  const body = value.body;
  if (body.protocol !== NATIVE_SEMANTIC_PROTOCOL || body.requestId !== request.requestId || body.textHash !== request.textHash
    || body.start !== request.start || body.length !== request.length || request.length > NATIVE_REQUEST_LIMIT
    || typeof body.project !== "string" || typeof body.projectVersion !== "string"
    || !isRecord(body.legend) || !isStrings(body.legend.tokenTypes) || !isStrings(body.legend.tokenModifiers)
    || body.legend.tokenTypes.join("\0") !== nativeTokenTypes.join("\0")
    || body.legend.tokenModifiers.join("\0") !== nativeTokenModifiers.join("\0")) return undefined;
  return decode_native_tokens(document, body.legend, body.data);
}

/** Bounded acquisition is shared by the extension and regression probes. A late
 * invalid packet or changed document invalidates the whole attempt. */
export async function read_native_tokens(document: SemanticDocument, textLength: number, textHash: string, requestId: string,
  read: (request: Omit<NativeRequest, "file">) => PromiseLike<unknown>, stale: () => boolean): Promise<NativeToken[] | undefined> {
  if (stale() || textLength > SEMANTIC_DOCUMENT_LIMIT) return undefined;
  const native: NativeToken[] = [];
  let project: unknown, projectVersion: unknown;
  try {
    for (let start = 0; start < textLength; start += NATIVE_REQUEST_LIMIT) {
      const request = { start, length: Math.min(NATIVE_REQUEST_LIMIT, textLength - start), textHash, requestId };
      const response = await read(request);
      if (stale()) return undefined;
      const tokens = decode_native_response(document, request, response);
      if (tokens === undefined) return undefined;
      if (!isRecord(response) || !isRecord(response.body)) return undefined;
      if (project !== undefined && (project !== response.body.project || projectVersion !== response.body.projectVersion)) return undefined;
      project = response.body.project; projectVersion = response.body.projectVersion;
      for (const token of tokens) {
        if (token.start < start || token.start >= start + request.length) continue;
        if (native.length && native[native.length - 1]!.end > token.start) return undefined;
        native.push(token);
      }
    }
    return stale() ? undefined : native;
  } catch { return undefined; }
}
