import { Hson, hsonLiveMap } from "hson-live";
// @ts-expect-error JsonFromSchema is the sole public Schema value projection.
import type { HsonSchemaValue } from "hson-live";
import type {
  HsonCanonical, HsonData, HsonDocument, HsonSchemaData, HsonFromSchema, JsonFromSchema,
  LiveMapDocumentLibrary, LiveMapDataLibrary, LiveMapStagedWriter, Locus,
  HsonSchema,
} from "hson-live";
import { SameShapeOneSchema, SameShapeTwoSchema, UserSchema } from "./fixtures/hson-schema-mvp/out/producer.js";
import { PageSchema } from "./fixtures/hson-schema-document/out/producer.js";

declare const canonical: HsonCanonical;
declare const unproved: HsonData;
declare const document: HsonDocument;
declare const proved: HsonData<typeof UserSchema>;
declare const schemaData: HsonSchemaData;
declare const firstProof: HsonData<typeof SameShapeOneSchema>;
const documentSchemaMode: HsonSchema<unknown, "document"> = PageSchema;
void documentSchemaMode;
declare const documentValueProjection: DocumentSchemaGraph<typeof PageSchema>;
void documentValueProjection;

const dataCanonical: HsonCanonical = unproved;
const documentCanonical: HsonCanonical = document;
const proofBase: HsonData = proved;
const schemaBase: HsonData = schemaData;
const schemaCanonical: HsonCanonical = schemaData;
const portable: HsonSchemaData = UserSchema.toHson();
declare const projected: JsonFromSchema<typeof SameShapeOneSchema>;
const sameShapedName: string = projected.name;
const crossProjected: JsonFromSchema<typeof SameShapeTwoSchema> = projected;
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
const governedData: LiveMapDataLibrary<JsonFromSchema<typeof SameShapeOneSchema>, "state", typeof SameShapeOneSchema> = dataMap.lib("state");
const documentMap = hsonLiveMap.fromLibraries({ page: { document: Hson.document`<main id=hero <header/> <section "body"/>/>`, schema: PageSchema } });
const governedDocument: LiveMapDocumentLibrary<DocumentSchemaGraph<typeof PageSchema>> = documentMap.lib("page");
// @ts-expect-error A document Schema cannot govern a data map.
dataMap.lib("state").schema.use(PageSchema);
// @ts-expect-error A data Schema cannot govern a document map.
documentMap.lib("page").schema.use(SameShapeOneSchema);
// @ts-expect-error Governing Schema handles retain declaration identity.
const wrongDataEvidence: LiveMapDataLibrary<JsonFromSchema<typeof SameShapeTwoSchema>, "state", typeof SameShapeTwoSchema> = governedData;
void governedDocument; void wrongDataEvidence;

type DocumentSchemaGraph<S extends import("hson-live").HsonSchema<unknown, "document">> = S extends import("hson-live").HsonSchema<infer TGraph, "document"> ? TGraph : never;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type DeckHson = HsonFromSchema<typeof UserSchema>;
type DeckJson = JsonFromSchema<typeof UserSchema>;
type DataRepresentation = Assert<Equal<DeckHson, HsonData<typeof UserSchema>>>;
type DocumentRepresentation = Assert<Equal<HsonFromSchema<typeof PageSchema>, HsonDocument<typeof PageSchema>>>;
declare const deckJson: DeckJson;
const deckHson: DeckHson = proved;
// @ts-expect-error A document Schema is not a JSON value Schema.
type PageJson = JsonFromSchema<typeof PageSchema>;
// @ts-expect-error Hson proof text is not a JSON value.
const jsonFromHson: DeckJson = deckHson;
// @ts-expect-error JSON values are not Hson proof text.
const hsonFromJson: DeckHson = deckJson;
// @ts-expect-error Document graph evidence is not Hson source.
const graphFromHson: DocumentSchemaGraph<typeof PageSchema> = Hson.document`<main/>`;
void jsonFromHson; void hsonFromJson; void graphFromHson;

// Document evidence also remains available through staged and Governor inference.
declare const documentWriter: LiveMapStagedWriter<typeof documentMap, void>;
documentWriter.lib("page").at([0, 0]).replace("new body");
// @ts-expect-error The document's main element has only one section child.
documentWriter.lib("page").at([1]);
// @ts-expect-error A text location does not expose element attributes.
documentWriter.lib("page").at([0, 0]).attrs;
// @ts-expect-error A text location accepts text, not a graph node.
documentWriter.lib("page").at([0, 0]).replace(documentMap.lib("page").root());
declare const documentLocus: Locus<typeof documentMap>;
const governorSchema: typeof PageSchema = documentLocus.lib("page").schema.get();
void governorSchema;
