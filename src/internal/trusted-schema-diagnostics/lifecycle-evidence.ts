import { hson } from "../../hson.js";
import { HSON } from "../../hson-authoring.js";
import { hsonLiveMap } from "../../api/livemap/livemap.facade.js";
import type { HsonCanonical } from "../../api/transform/transform.types.js";
import type { ClassifiedLiveMap } from "../../types/livemap.types.js";
import { require_document_root_schema } from "../../api/livemap/livemap.document.schema.js";
import { is_owned_projected_schema } from "../../api/livemap/livemap.schema.js";
import type { TrustedSchemaAssociationEvidence, TrustedSchemaMapFlow, TrustedSchemaSourceBinding } from "./protocol.js";

type TrustedSchemaTemplateBase = Readonly<{
  templateId: string;
  templateRevision: number;
  source: string;
}>;
export type TrustedSchemaTaggedTemplate = TrustedSchemaTemplateBase & Readonly<{ kind: "tagged"; canonical: HsonCanonical }>;
export type TrustedSchemaStaticTemplate = TrustedSchemaTemplateBase & Readonly<{ kind: "static"; canonical: string }>;
export type TrustedSchemaTemplate = TrustedSchemaTaggedTemplate | TrustedSchemaStaticTemplate;
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
  isCurrent?: () => boolean;
}>;

const TEMPLATES = new WeakMap<TemplateStringsArray, TrustedSchemaTaggedTemplate>();
const CAPTURED_TEMPLATES = new WeakSet<TrustedSchemaTemplate>();
const APPLICATIONS = new WeakMap<TrustedSchemaApplication, number>();
const ATTACHMENTS = new Map<string, TrustedSchemaAttachment>();
let nextTemplate = 0;
let nextApplication = 0;
let nextAttempt = 0;

/** Explicit private tag: direct, substitution-free occurrences only; never text-keyed. */
export function capture_trusted_schema_template(strings: TemplateStringsArray, ...values: readonly never[]): TrustedSchemaTaggedTemplate {
  if (strings.length !== 1 || values.length !== 0) throw new Error("D1 requires a substitution-free authored template.");
  const existing = TEMPLATES.get(strings);
  if (existing !== undefined) return existing;
  const template = Object.freeze({
    kind: "tagged", templateId: `template:${++nextTemplate}`, templateRevision: 1,
    source: strings.raw[0], canonical: HSON(strings),
  });
  TEMPLATES.set(strings, template);
  CAPTURED_TEMPLATES.add(template);
  return template;
}

/** Construction owns the evidence; callers cannot assert a pre-existing map is direct. */
export function construct_trusted_schema_application(template: TrustedSchemaTaggedTemplate): TrustedSchemaApplication {
  if (!CAPTURED_TEMPLATES.has(template)) throw new Error("Unknown D1 template capture.");
  const map = hson.liveMap.fromHson(template.canonical);
  const application = Object.freeze({ applicationId: `application:${++nextApplication}`, template, map });
  APPLICATIONS.set(application, map.rev);
  return application;
}

/** Capture one instrumented static source occurrence; text is not its identity. */
export function capture_trusted_schema_static_source(source: string): TrustedSchemaStaticTemplate {
  const template = Object.freeze({
    kind: "static",
    templateId: `static:${++nextTemplate}`,
    templateRevision: 1,
    source,
    // Lifecycle authority is the source occurrence plus actual map/revision;
    // this field is descriptive protocol evidence and is never an identity key.
    canonical: source,
  });
  CAPTURED_TEMPLATES.add(template);
  return template;
}

/** Exact static-string construction for an instrumented LiveMap fromHson call. */
export function construct_trusted_schema_static_application(template: TrustedSchemaStaticTemplate): TrustedSchemaApplication {
  if (!CAPTURED_TEMPLATES.has(template)) throw new Error("Unknown static source occurrence capture.");
  const map = hsonLiveMap.fromHson(template.source);
  const application = Object.freeze({ applicationId: `application:${++nextApplication}`, template, map });
  APPLICATIONS.set(application, map.rev);
  return application;
}

/** Records the proposal before calling the unchanged, authoritative schema.use. */
export function attempt_trusted_schema_attachment(application: TrustedSchemaApplication, schemaId: string, schema: object, source?: Readonly<{ mapFlow: TrustedSchemaMapFlow; binding: TrustedSchemaSourceBinding }>): TrustedSchemaAttachment {
  const constructedRevision = APPLICATIONS.get(application);
  if (constructedRevision === undefined) throw new Error("Unknown D1 direct application.");
  const { map, template } = application;
  const attemptRevision = map.rev;
  const rootMode = map.mode === "element" || map.mode === "fragment" ? map.mode : "projected";
  const associationId = `association:${++nextAttempt}`;
  const base: Omit<TrustedSchemaAssociationEvidence, "correspondence" | "attachment"> = {
    mapFlow: source === undefined ? undefined : Object.freeze({ ...source.mapFlow }),
    binding: source === undefined ? undefined : Object.freeze({ ...source.binding }),
    validationAttempted: map.schema.get() === undefined,
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
  const result: TrustedSchemaAttachment = Object.freeze({ schema, origin: hson, error, isCurrent: () => map.rev === attemptRevision,
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
