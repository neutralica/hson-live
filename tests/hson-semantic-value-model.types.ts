import { Hson, hsonLiveMap } from "hson-live";
// @ts-expect-error SchemaType is the sole public Schema value projection.
import type { HsonSchemaValue } from "hson-live";
import type {
  HsonCanonical, HsonData, HsonDocument, HsonSchemaData, SchemaType,
  LiveMapDocumentLibrary, LiveMapDataLibrary,
  HsonSchema,
} from "hson-live";
import { SameShapeOneSchema, SameShapeTwoSchema, UserSchema } from "./fixtures/hson-schema-mvp/producer.js";
import { PageSchema } from "./fixtures/hson-schema-document/producer.js";

declare const canonical: HsonCanonical;
declare const unproved: HsonData;
declare const document: HsonDocument;
declare const proved: HsonData<typeof UserSchema>;
declare const schemaData: HsonSchemaData;
declare const firstProof: HsonData<typeof SameShapeOneSchema>;
const documentSchemaMode: HsonSchema<unknown, "document"> = PageSchema;
void documentSchemaMode;
declare const documentValueProjection: SchemaType<typeof PageSchema>;
void documentValueProjection;

const dataCanonical: HsonCanonical = unproved;
const documentCanonical: HsonCanonical = document;
const proofBase: HsonData = proved;
const schemaBase: HsonData = schemaData;
const schemaCanonical: HsonCanonical = schemaData;
const portable: HsonSchemaData = UserSchema.toHson();
declare const projected: SchemaType<typeof SameShapeOneSchema>;
const sameShapedName: string = projected.name;
// @ts-expect-error Equal field shapes do not erase generated value proof identity.
const crossProjected: SchemaType<typeof SameShapeTwoSchema> = projected;
void dataCanonical; void documentCanonical; void proofBase; void schemaBase;
void schemaCanonical; void portable; void projected; void sameShapedName; void crossProjected;

// @ts-expect-error Context neutral Hson has no data classification.
const neutralAsData: HsonData = canonical;
// @ts-expect-error Data and document classifications differ.
const dataAsDocument: HsonDocument = unproved;
// @ts-expect-error Document and data classifications differ.
const documentAsData: HsonData = document;
// @ts-expect-error Unproved data cannot impersonate one Schema certificate.
const unprovedAsProved: HsonData<typeof UserSchema> = unproved;
// @ts-expect-error Identically shaped Schemas retain separate identities.
const crossIdentity: HsonData<typeof SameShapeTwoSchema> = firstProof;
// @ts-expect-error Arbitrary data does not define a validated Schema.
const dataAsSchema: HsonSchemaData = unproved;
// @ts-expect-error A document Schema cannot parameterize HsonData.
type WrongDataMode = HsonData<typeof PageSchema>;
// @ts-expect-error A data Schema cannot parameterize HsonDocument.
type WrongDocumentMode = HsonDocument<typeof UserSchema>;
// @ts-expect-error String operations drop semantic proof.
const sliced: HsonData = unproved.slice(0, 2);
// @ts-expect-error String concatenation drops semantic proof.
const appended: HsonData = unproved + "x";
// @ts-expect-error A document Schema rejects data candidates statically.
PageSchema.certify(unproved);
// @ts-expect-error A data Schema rejects document candidates statically.
UserSchema.certify(document);
// @ts-expect-error The Schema namespace, not Hson itself, owns certification.
Hson.certify(UserSchema, canonical);
// @ts-expect-error Semantic values are primitive strings, not public wrappers.
unproved.toHson();

void neutralAsData; void dataAsDocument; void documentAsData; void unprovedAsProved;
void crossIdentity; void dataAsSchema; void sliced; void appended;

const dataMap = hsonLiveMap.fromLibraries({ state: { data: Hson.data`<name "Ada">`, schema: SameShapeOneSchema } });
const governedData: LiveMapDataLibrary<SchemaType<typeof SameShapeOneSchema>> = dataMap.lib("state");
const documentMap = hsonLiveMap.fromLibraries({ page: { document: Hson.document`<main id=hero <header/> <section "body"/>/>`, schema: PageSchema } });
const governedDocument: LiveMapDocumentLibrary<SchemaType<typeof PageSchema>> = documentMap.lib("page");
// @ts-expect-error A document Schema cannot govern a data map.
dataMap.lib("state").schema.use(PageSchema);
// @ts-expect-error A data Schema cannot govern a document map.
documentMap.lib("page").schema.use(SameShapeOneSchema);
// @ts-expect-error Same-shaped Schemas do not share governed value proof.
const wrongDataEvidence: LiveMapDataLibrary<SchemaType<typeof SameShapeTwoSchema>> = governedData;
void governedDocument; void wrongDataEvidence;
