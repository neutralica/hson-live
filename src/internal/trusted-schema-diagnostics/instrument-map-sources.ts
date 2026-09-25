import { discover_hson_tagged_templates } from "../embedded-hson/discover-hson-tagged-templates.js";
import { interpolation_site } from "./interpolation-source.js";
import { pathToFileURL } from "node:url";

/** Instrument only Hson interpolation capture in the diagnostic copy.
 * Schema is admitted with a named library, so there is no later map attachment
 * lifecycle to instrument.
 */
export function instrument_trusted_schema_map_sources(fileName: string, text: string, helperModuleUrl: string): string {
  const interpolated = discover_hson_tagged_templates(fileName, text).interpolated;
  if (interpolated.length === 0) return text;
  let name = "__hsonTrustedLifecycle";
  while (text.includes(name)) name += "_";
  let result = text;
  for (const source of [...interpolated].sort((a, b) => b.tagRange.start - a.tagRange.start)) {
    const descriptor = interpolation_site(source, pathToFileURL(fileName).href);
    result = result.slice(0, source.tagRange.start)
      + `${name}.interpolation(${JSON.stringify(descriptor)}, [], ${text.slice(source.tagRange.start, source.tagRange.end)})`
      + result.slice(source.tagRange.end);
  }
  return `import { create_trusted_schema_source_lifecycle as ${name}Factory } from ${JSON.stringify(helperModuleUrl)};\nconst ${name} = ${name}Factory();\n${result}`;
}
