import { Hson } from "../../hson-authoring.js";
import type { HsonCanonical } from "../../api/transform/transform.types.js";
import { capture_interpolation } from "./interpolation-capture.js";
import type { InterpolationSite } from "./interpolation-source.js";

/** Diagnostic-only capture of authored interpolation occurrences. */
export function create_trusted_schema_source_lifecycle() {
  return Object.freeze({
    interpolation(site: InterpolationSite, _aliases: readonly string[], tag: unknown) {
      if (tag !== Hson.canonical) throw new Error("Unsupported authored tag runtime identity.");
      return (strings: TemplateStringsArray, ...values: readonly (string | number | boolean | null)[]): HsonCanonical =>
        capture_interpolation(site, Hson.canonical, strings, values).canonical;
    },
  });
}
