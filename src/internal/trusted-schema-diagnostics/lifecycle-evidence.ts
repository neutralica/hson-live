import { hson } from "../../hson.js";
import type { HsonCanonical } from "../../api/transform/transform.types.js";
import type { ClassifiedLiveMap } from "../../types/livemap.types.js";
import { require_document_root_schema } from "../../api/livemap/livemap.document.schema.js";
import { is_owned_projected_schema } from "../../api/livemap/livemap.schema.js";
import type { TrustedSchemaAssociationEvidence } from "./protocol.js";

export type TrustedSchemaTemplate = Readonly<{
  templateId: string;
  templateRevision: number;
  source: string;
  canonical: HsonCanonical;
}>;
export type TrustedSchemaApplication = Readonly<{
  applicationId: string;
  template: TrustedSchemaTemplate;
  map: ClassifiedLiveMap;
}>;
export type TrustedSchemaAttachment = Readonly<{
  schema: object;
  origin: unknown;
  evidence: TrustedSchemaAssociationEvidence;
  error?: unknown;
}>;

const TEMPLATES = new WeakMap<TemplateStringsArray, TrustedSchemaTemplate>();
const CAPTURED_TEMPLATES = new WeakSet<TrustedSchemaTemplate>();
const APPLICATIONS = new WeakMap<TrustedSchemaApplication, number>();
const ATTACHMENTS = new Map<string, TrustedSchemaAttachment>();
let nextTemplate = 0;
let nextApplication = 0;
let nextAttempt = 0;

/** Explicit private tag: direct, substitution-free occurrences only; never text-keyed. */
export function capture_trusted_schema_template(strings: TemplateStringsArray, ...values: readonly never[]): TrustedSchemaTemplate {
  if (strings.length !== 1 || values.length !== 0) throw new Error("D1 requires a substitution-free authored template.");
  const existing = TEMPLATES.get(strings);
  if (existing !== undefined) return existing;
  const template = Object.freeze({
    templateId: `template:${++nextTemplate}`, templateRevision: 1,
    source: strings.raw[0], canonical: hson(strings),
  });
  TEMPLATES.set(strings, template);
  CAPTURED_TEMPLATES.add(template);
  return template;
}

/** Construction owns the evidence; callers cannot assert a pre-existing map is direct. */
export function construct_trusted_schema_application(template: TrustedSchemaTemplate): TrustedSchemaApplication {
  if (!CAPTURED_TEMPLATES.has(template)) throw new Error("Unknown D1 template capture.");
  const map = hson.liveMap.fromHson(template.canonical);
  const application = Object.freeze({ applicationId: `application:${++nextApplication}`, template, map });
  APPLICATIONS.set(application, map.rev);
  return application;
}

/** Records the proposal before calling the unchanged, authoritative schema.use. */
export function attempt_trusted_schema_attachment(application: TrustedSchemaApplication, schemaId: string, schema: object): TrustedSchemaAttachment {
  const constructedRevision = APPLICATIONS.get(application);
  if (constructedRevision === undefined) throw new Error("Unknown D1 direct application.");
  const { map, template } = application;
  const attemptRevision = map.rev;
  const rootMode = map.mode === "element" || map.mode === "fragment" ? map.mode : "projected";
  const associationId = `association:${++nextAttempt}`;
  const base: Omit<TrustedSchemaAssociationEvidence, "correspondence" | "attachment"> = {
    associationId, applicationId: application.applicationId, schemaId, rootMode,
    templateId: template.templateId, templateRevision: template.templateRevision,
    source: template.source, canonical: template.canonical,
    constructedRevision, attemptRevision,
  };
  const correspondence = constructedRevision === attemptRevision ? "direct" : "unavailable";
  ATTACHMENTS.set(associationId, Object.freeze({ schema, origin: hson,
    evidence: Object.freeze({ ...base, correspondence, attachment: "attempted" }),
  }));
  let error: unknown;
  let attachment: "attached" | "rejected" = "attached";
  try {
    if (map.mode === "element") map.schema.use(require_document_root_schema(schema, "element").value);
    else if (map.mode === "fragment") map.schema.use(require_document_root_schema(schema, "fragment").value);
    else {
      if (!is_owned_projected_schema(schema)) throw new TypeError("Unrecognized projected Schema capability.");
      map.schema.use(schema);
    }
  } catch (cause) { attachment = "rejected"; error = cause; }
  const result: TrustedSchemaAttachment = Object.freeze({ schema, origin: hson, error,
    evidence: Object.freeze({ ...base, attachment,
      correspondence: correspondence === "direct" && map.rev === attemptRevision ? "direct" : "unavailable",
    }),
  });
  ATTACHMENTS.set(associationId, result);
  return result;
}

export function consume_trusted_schema_attachments(): readonly TrustedSchemaAttachment[] {
  const records = Object.freeze([...ATTACHMENTS.values()]);
  ATTACHMENTS.clear();
  return records;
}
