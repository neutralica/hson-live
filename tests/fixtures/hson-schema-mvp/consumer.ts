import { AnyDataSchema, InteractionFieldsSchema, RelationalUniqueSchema, TreeSchema, UserSchema } from "./producer.js";
import { type SchemaType, HsonData, Hson, hsonCalc, hsonLiveMap, hsonLocus, hsonTransform, type HsonNumber } from "hson-live";
import type { HsonCanonical } from "hson-live/hson";

const anyDataValue: SchemaType<typeof AnyDataSchema> = { nested: ["text", 3, true, null] };
const anyDataCertified: HsonData<typeof AnyDataSchema> = AnyDataSchema.certify(Hson.data`["text", 3, true, null]`);
void anyDataValue;
void anyDataCertified;

const authored: HsonData<typeof UserSchema> = Hson.data`
  <name "Ada" score 37 age 37 percent 80 code "ID-7" key "abc" status "ready" phase "lobby" turn "player1" zero 0 negativeZero -0 signedZeroChoice -0 flags [true, false] pair ["x", 2] account <kind "user" handle "ada">>
`;

const dynamic: HsonCanonical = hsonTransform.fromJson({ name: "Ada", score: 37, age: 37, percent: 80, code: "ID-7", key: "abc", status: "ready", phase: "finished", turn: null, zero: 0, negativeZero: -0, signedZeroChoice: 0, flags: [true], pair: ["x", 2], account: { kind: "admin", level: 3 } }).toHson().serialize();
const certified: HsonData<typeof UserSchema> = UserSchema.certify(dynamic);
const numberEvidence: HsonNumber = hsonCalc(37);
const recursiveAuthored: HsonData<typeof TreeSchema> = Hson.data`<value "root" age 2 children [<value "leaf" age 0 children []>]>`;
const recursiveDynamic: HsonCanonical = hsonTransform.fromJson({ value: "root", age: 3, children: [{ value: "leaf", age: 1, children: [] }] }).toHson().serialize();
const recursiveCertified: HsonData<typeof TreeSchema> = TreeSchema.certify(recursiveDynamic);
const interactionFields: HsonData<typeof InteractionFieldsSchema> = Hson.data`<args <target "browser" options [null, true, -0, <nested []>]> payload <action "rename" values ["Ada", "Grace"]>>`;
const dynamicInteractionFields: HsonCanonical = hsonTransform.fromJson({ args: [], payload: { arbitrary: { nested: [1, false, null] } } }).toHson().serialize();
const certifiedInteractionFields: HsonData<typeof InteractionFieldsSchema> = InteractionFieldsSchema.certify(dynamicInteractionFields);
const relationalUnique: HsonData<typeof RelationalUniqueSchema> = Hson.data`<cells [<position "top-right" body "a">, <position "top-left" body "b">]>`;

const libraries = hsonLiveMap.fromLibraries({
  user: {
    data: { name: "Ada", score: 37, age: 37, percent: 80, code: "ID-7", key: "abc", status: "ready", phase: "playing", turn: "player2", zero: 0, negativeZero: -0, signedZeroChoice: -0, flags: [true], pair: ["x", 2], account: { kind: "admin", level: 3 } },
    schema: UserSchema,
  },
  tree: {
    data: { value: "root", age: 2, children: [] },
    schema: TreeSchema,
  },
});
const libraryName: string = libraries.lib("user").at(["name"]).snap();
const librarySchema: typeof UserSchema = libraries.lib("user").schema.get();
libraries.lib("user").at(["name"]).set("Grace");
// @ts-expect-error Generated Schema-derived handle rejects a wrong value.
libraries.lib("user").at(["name"]).set(37);
// Dynamic names are type-safe unions and checked against the live registry at runtime.
const dynamicLibraryName: string = "users";
void dynamicLibraryName;
const hostedLibraries = hsonLocus.create({
  map: libraries,
  exposure: [
    { library: "user", exposure: "client-public" },
    { library: "tree", exposure: "client-public" },
  ],
  actions: {
    async rename(context) {
      await context.mutate((draft) => {
        draft.lib("user").at(["name"]).set("Lin");
        // @ts-expect-error Hosted managed drafts retain generated Schema mutation types.
        draft.lib("user").at(["name"]).set(37);
      });
    },
  },
});
const hostedLibraryName: string = hostedLibraries.map.lib("user").at(["name"]).snap();

void authored;
void certified;
void numberEvidence;
void recursiveAuthored;
void recursiveCertified;
void interactionFields;
void certifiedInteractionFields;
void relationalUnique;
void libraryName;
void librarySchema;
void hostedLibraryName;
