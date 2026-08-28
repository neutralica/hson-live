import { HSON } from "../../hson-authoring.js";
import { hsonLiveMap } from "../../api/livemap/livemap.facade.js";
import type { HsonCanonical } from "../../api/transform/transform.types.js";
import type { ClassifiedLiveMap } from "../../types/livemap.types.js";
import type { TrustedSchemaMapFlow, TrustedSchemaSourceBinding } from "./protocol.js";
import { capture_trusted_schema_template, construct_trusted_schema_application, attempt_trusted_schema_attachment,
  captured_interpolation_template, capture_trusted_schema_static_source, construct_trusted_schema_static_application, type TrustedSchemaTemplate, type TrustedSchemaApplication } from "./lifecycle-evidence.js";
import { capture_interpolation } from "./interpolation-capture.js";
import type { InterpolationSite } from "./interpolation-source.js";

type Site = Readonly<{ mapFlow: TrustedSchemaMapFlow; binding: TrustedSchemaSourceBinding }>;

/** Source-site metadata is only a lookup key. The D1 helpers own occurrence,
 * construction, revision and attempted-attachment evidence. No equality recovery.
 * This session is private to an explicitly instrumented trusted diagnostic copy.
 */
export function create_trusted_schema_source_lifecycle(sites: readonly Site[]) {
  const templates = new Map<string, TrustedSchemaTemplate>();
  const applications = new WeakMap<object, Readonly<{ application: TrustedSchemaApplication; constructionId: string }>>();
  const repeated = new Set<string>();
  const interpolationIds = new Set<string>();
  const untracked = new WeakMap<object, ClassifiedLiveMap>();
  return Object.freeze({
    interpolation(site: InterpolationSite, aliases: readonly string[], tag: unknown) {
      if (tag !== HSON) throw new Error("Unsupported authored tag runtime identity.");
      return (strings: TemplateStringsArray, ...values: readonly (string | number | boolean | null)[]): HsonCanonical => {
        const result = capture_interpolation(site, HSON, strings, values);
        const template = result.capture === undefined ? undefined : captured_interpolation_template(result.capture);
        for (const id of aliases) {
          interpolationIds.add(id);
          if (templates.has(id)) repeated.add(id);
          if (template !== undefined && !repeated.has(id)) templates.set(id, template);
        }
        return result.canonical;
      };
    },
    tag(templateId: string, tag: unknown) {
      if (tag !== HSON) throw new Error("Unsupported authored tag runtime identity.");
      return (strings: TemplateStringsArray): HsonCanonical => {
        const template = capture_trusted_schema_template(strings);
        templates.set(templateId, template);
        return template.canonical;
      };
    },
    construct(templateId: string, constructionId: string, constructor: unknown) {
      if (constructor !== hsonLiveMap.fromHson) throw new Error("Unsupported LiveMap construction runtime identity.");
      return (canonical: HsonCanonical): ClassifiedLiveMap => {
        const template = templates.get(templateId);
        if (interpolationIds.has(templateId) && (template === undefined || repeated.has(templateId))) {
          const map = hsonLiveMap.fromHson(canonical);
          untracked.set(map, map);
          return map;
        }
        if (template === undefined || template.kind !== "tagged" || canonical !== template.canonical) throw new Error("Missing exact authored occurrence capture.");
        const application = construct_trusted_schema_application(template);
        applications.set(application.map, { application, constructionId });
        return application.map;
      };
    },
    constructStatic(templateId: string, constructionId: string, constructor: unknown) {
      if (constructor !== hsonLiveMap.fromHson) throw new Error("Unsupported LiveMap construction runtime identity.");
      return (source: string): ClassifiedLiveMap => {
        if (typeof source !== "string") throw new Error("Static fromHson construction did not receive a string.");
        const existing = templates.get(templateId);
        const template = existing === undefined ? capture_trusted_schema_static_source(source) : existing;
        if (template.kind !== "static" || template.source !== source) throw new Error("Static source occurrence changed during trusted module execution.");
        templates.set(templateId, template);
        const application = construct_trusted_schema_static_application(template);
        applications.set(application.map, { application, constructionId });
        return application.map;
      };
    },
    use(index: number, map: object) {
      return (schema: object): ClassifiedLiveMap => {
        const site = sites[index];
        const captured = applications.get(map);
        if (site !== undefined && interpolationIds.has(site.mapFlow.templateId) && captured === undefined) {
          // Ambiguous captures cannot acquire lifecycle authority. Still execute
          // the actual application operation, including its original failure.
          const actual = untracked.get(map);
          if (actual === undefined) throw new Error("Missing actual map construction.");
          return Reflect.apply(actual.schema.use, actual.schema, [schema]);
        }
        if (site === undefined || captured === undefined || captured.constructionId !== site.mapFlow.constructionId
          || captured.application.template !== templates.get(site.mapFlow.templateId)) throw new Error("Missing actual map/source lifecycle.");
        // As in D1, a rejected proposal remains recorded and the diagnostic copy
        // can collect other independent contracts. This is not application output.
        attempt_trusted_schema_attachment(captured.application, `source:${index}`, schema, site);
        return captured.application.map;
      };
    },
  });
}
