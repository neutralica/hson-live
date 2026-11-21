import { resolve_projected_hson_location } from "../../src/api/livemap/livemap.editor.js";
import { is_ordered_projected_object, type OrderedProjectedValue } from "../../src/core/ordered-projected-value.js";
import { compile_hson_schema } from "../../src/internal/hson-schema/compiler.js";
import type {
  HsonSourceRange, ParsedHsonWithProvenance,
} from "../../src/internal/hson-source-provenance/hson-source-provenance.js";
import { parse_hson_with_provenance } from "../../src/internal/hson-source-provenance/parse-hson-with-provenance.js";
import { lower_schema_definition, SchemaLoweringError, type LoweredDefinition } from "./lower-definition.js";
import { read_schema_source, SchemaSourceError } from "./source-reader.js";

type Path = readonly (string | number)[];

// Union and graph diagnostics can identify an individual generated expression
// by range, even when the issue path identifies its enclosing definition.
function pathForCoverage(parsed: ParsedHsonWithProvenance, sought: HsonSourceRange,
  node: OrderedProjectedValue, path: Path): Path | undefined {
  const location = resolve_projected_hson_location(parsed.value, path);
  const range = location && parsed.provenance.range({ kind: "node", path: location.valuePath, role: "coverage" });
  if (range) {
    if (range.start === sought.start && range.end === sought.end) return path;
    if (range.start > sought.start || range.end < sought.end) return undefined;
  }
  if (node === null || typeof node !== "object") return undefined;
  const entries = is_ordered_projected_object(node) ? node.entries : node.entries();
  for (const [key, child] of entries) {
    const found = pathForCoverage(parsed, sought, child, [...path, key]);
    if (found) return found;
  }
}

/**
 * Private development entry. Syntax and lowering errors throw SchemaSourceError.
 * Compiler issues retain their ordinary path and generated range alongside an
 * authoredRange. On success, schema1Source can also be used with HsonSchema.fromHson.
 */
export function compile_schema_source(source: string) {
  const read = read_schema_source(source);
  let lowered: LoweredDefinition;
  try {
    lowered = lower_schema_definition(read.root);
  } catch (cause) {
    if (!(cause instanceof SchemaLoweringError)) throw cause;
    throw new SchemaSourceError(source, read.rangeOf(cause.origin)!, "SCHEMA_LOWERING",
      cause.message, cause.origin, cause);
  }
  const compilation = compile_hson_schema(lowered.schema1Source);
  const result = { ...read, ...lowered };
  if (compilation.ok) return { ...result, ok: true, compiled: compilation.value } as const;

  let generated: ParsedHsonWithProvenance | undefined;
  const issues = compilation.issues.map(issue => {
    let path = issue.path;
    if (issue.range && (!path.length || issue.code === "INVALID_SCHEMA_GRAPH")) {
      generated ??= parse_hson_with_provenance(lowered.schema1Source);
      path = pathForCoverage(generated, issue.range, lowered.orderedDefinition, []) ?? path;
    }
    const origin = lowered.originAt(path);
    return { ...issue, origin, authoredRange: read.rangeOf(origin)! };
  });
  return { ...result, ok: false, issues } as const;
}
