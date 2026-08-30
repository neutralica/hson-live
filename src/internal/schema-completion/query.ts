export type SchemaCompletionItem = Readonly<{
  id: string;
  label: string;
  kind: "member" | "literal" | "tag" | "attribute" | "flag";
  insertText: string;
  snippet: boolean;
  detail: string;
  required?: boolean;
  sortText: string;
}>;

export type SchemaCompletionResult = Readonly<{
  status: "available" | "unsupported";
  items: readonly SchemaCompletionItem[];
  range?: Readonly<{ start: number; end: number }>;
  timings?: Readonly<{ contextMs: number; parseMs: number; resolveMs: number; queryMs: number }>;
}>;

/** Historical callback-authored completion is retired. */
export function query_schema_completion(
  _schema: object,
  _source: string,
  _cursor: number,
  _unknownRanges: readonly Readonly<{ start: number; end: number }>[]= [],
): SchemaCompletionResult {
  return { status: "unsupported", items: [] };
}
