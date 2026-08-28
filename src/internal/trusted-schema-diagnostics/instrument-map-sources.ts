import { discover_schema_validation_sources } from "./discover-validation-sources.js";
import { is_static_hson_source } from "../embedded-hson/authored-hson-source.js";

/** Explicit trusted-provider build step, never applied to an editor buffer or
 * installed as a project loader. Only the diagnostic copy is instrumented.
 * Ordinary application output is unchanged. No Schema definitions are rewritten.
 */
export function instrument_trusted_schema_map_sources(fileName: string, text: string, helperModuleUrl: string): string {
  const associations = discover_schema_validation_sources(fileName, text).filter(site => site.mapFlow !== undefined);
  if (associations.length === 0) return text;
  let name = "__hsonTrustedLifecycle";
  while (text.includes(name)) name += "_";
  const edits = new Map<number, { end: number; text: string }>();
  for (const [index, site] of associations.entries()) {
    const boundary = site.constructionCalleeRange!;
    if (!is_static_hson_source(site.source)) edits.set(site.source.tagRange.start, { end: site.source.tagRange.end,
      text: `${name}.tag(${JSON.stringify(site.templateId)}, ${text.slice(site.source.tagRange.start, site.source.tagRange.end)})` });
    // Replace only the callee, leaving nested inline authored templates intact.
    edits.set(boundary.start, { end: boundary.end,
      text: `${name}.${is_static_hson_source(site.source) ? "constructStatic" : "construct"}(${JSON.stringify(site.templateId)}, ${JSON.stringify(site.mapFlow!.constructionId)}, ${text.slice(boundary.start, boundary.end)})` });
    // Discovery supplies the receiver and argument ranges; no spelling guesses.
    edits.set(site.useCalleeRange!.start, { end: site.useCalleeRange!.end,
      text: `${name}.use(${index}, ${text.slice(site.mapRange!.start, site.mapRange!.end)})` });
  }
  let result = text;
  for (const [start, edit] of [...edits].sort(([a], [b]) => b - a)) result = result.slice(0, start) + edit.text + result.slice(edit.end);
  const descriptors = associations.map(site => ({ mapFlow: site.mapFlow, binding: site.binding }));
  return `import { create_trusted_schema_source_lifecycle as ${name}Factory } from ${JSON.stringify(helperModuleUrl)};\nconst ${name} = ${name}Factory(${JSON.stringify(descriptors)});\n${result}`;
}
