import { discover_hson_tagged_templates } from "../../../src/internal/embedded-hson/discover-hson-tagged-templates.js";

/** A template-body edit cannot change a Schema declaration in the same module.
 * Everything else is conservatively a provider revision, never hot-reloaded.
 */
export function schema_provider_source_changed(fileName: string, before: string, after: string): boolean {
  const outsideTemplates = (text: string): string => {
    let result = text;
    for (const source of [...discover_hson_tagged_templates(fileName, text).sources].reverse()) {
      result = result.slice(0, source.bodyRange.start) + "<editor-candidate>" + result.slice(source.bodyRange.end);
    }
    return result;
  };
  return outsideTemplates(before) !== outsideTemplates(after);
}
