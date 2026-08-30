import { compile_hson_schema } from "../../../src/internal/hson-schema/compiler.js";

export type LocalHsonSchemaDiagnostic = Readonly<{ start: number; end: number; code: string; message: string }>;

/** Fast authoring feedback backed by the same pure compiler as the build analyzer. */
export function local_hson_schema_diagnostics(fileName: string, text: string): readonly LocalHsonSchemaDiagnostic[] {
  void fileName;
  const officialHson = new Set<string>(), officialSchema = new Set<string>();
  for (const match of text.matchAll(/import\s*{([^}]*)}\s*from\s*["'](hson-live(?:\/hson)?)["']/g)) {
    for (const raw of (match[1] ?? "").split(",")) {
      const binding = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      const imported = binding[0], local = binding[1] ?? binding[0];
      if (imported === "Hson" && local !== undefined) officialHson.add(local);
      if (imported === "HsonSchema" && local !== undefined) officialSchema.add(local);
    }
  }
  const diagnostics: LocalHsonSchemaDiagnostic[] = [];
  const declarationPattern = /(?:export\s+)?const\s+([$\w]+)\s*:\s*([$\w]+)\s*=\s*([$\w]+)\s*`([\s\S]*?)`\s*;/g;
  for (const match of text.matchAll(declarationPattern)) {
    const schemaType = match[2], tag = match[3], sourceText = match[4] ?? "", start = match.index;
    if (schemaType === undefined || !officialSchema.has(schemaType)) continue;
    if (tag === undefined || !officialHson.has(tag) || sourceText.includes("${")) {
      diagnostics.push(Object.freeze({ start, end: start + match[0].length, code: "UNSUPPORTED_HSON_SCHEMA_DECLARATION", message: "Hson Schema requires a direct substitution-free official Hson tagged template." }));
      continue;
    }
    const result = compile_hson_schema(sourceText);
    const templateStart = start + match[0].indexOf("`") + 1;
    if (!result.ok) for (const issue of result.issues) diagnostics.push(Object.freeze({ start: templateStart + (issue.range?.start ?? 0), end: templateStart + (issue.range?.end ?? sourceText.length), code: issue.code, message: issue.message }));
  }
  return Object.freeze(diagnostics);
}
