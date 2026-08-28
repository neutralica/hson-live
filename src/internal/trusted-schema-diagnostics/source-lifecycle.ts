import { HSON } from "../../hson-authoring.js";
import { hsonLiveMap } from "../../api/livemap/livemap.facade.js";
import type { HsonCanonical } from "../../api/transform/transform.types.js";
import type { ClassifiedLiveMap } from "../../types/livemap.types.js";
import type { TrustedSchemaMapFlow, TrustedSchemaSourceBinding } from "./protocol.js";
import { capture_trusted_schema_template, construct_trusted_schema_application, attempt_trusted_schema_attachment,
  type TrustedSchemaTemplate, type TrustedSchemaApplication } from "./lifecycle-evidence.js";

type Site = Readonly<{ mapFlow: TrustedSchemaMapFlow; binding: TrustedSchemaSourceBinding }>;

/** Source-site metadata is only a lookup key. The D1 helpers own occurrence,
 * construction, revision and attempted-attachment evidence. No equality recovery.
 * This session is private to an explicitly instrumented trusted diagnostic copy.
 */
export function create_trusted_schema_source_lifecycle(sites: readonly Site[]) {
  const templates = new Map<string, TrustedSchemaTemplate>();
  const applications = new WeakMap<object, Readonly<{ application: TrustedSchemaApplication; constructionId: string }>>();
  return Object.freeze({
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
        if (template === undefined || canonical !== template.canonical) throw new Error("Missing exact authored occurrence capture.");
        const application = construct_trusted_schema_application(template);
        applications.set(application.map, { application, constructionId });
        return application.map;
      };
    },
    use(index: number, map: object) {
      return (schema: object): ClassifiedLiveMap => {
        const site = sites[index];
        const captured = applications.get(map);
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
