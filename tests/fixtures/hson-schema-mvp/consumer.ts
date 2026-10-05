import { AnyDataSchema, BlockSchema, InteractionFieldsSchema, RelationalUniqueSchema, TreeSchema, UserSchema } from "./producer.js";
import { type JsonFromSchema, HsonData, Hson, hsonCalc, hsonLiveMap, hsonTransform, type HsonNumber } from "hson-live";
import type { HsonCanonical } from "hson-live/hson";

const anyDataValue: JsonFromSchema<typeof AnyDataSchema> = { nested: ["text", 3, true, null] };
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
const blocks: HsonData<typeof BlockSchema> = Hson.data`<blocks [<kind "paragraph" text "body">, <kind "heading" text "title">, <kind "code" source "const x = 1">, <kind "list" items ["a"]>]>`;
type Block = JsonFromSchema<typeof BlockSchema>["blocks"][number];
function block_content(block: Block): string {
  if (block.kind === "paragraph" || block.kind === "heading") return block.text;
  if (block.kind === "code") return block.source;
  return block.items.join(", ");
}
// @ts-expect-error A discriminated branch cannot claim another branch's fields.
const wrongBlock: Block = { kind: "code", text: "body" };

const definitions = {
  user: {
    data: { name: "Ada", score: 37, age: 37, percent: 80, code: "ID-7", key: "abc", status: "ready", phase: "playing", turn: "player2", zero: 0, negativeZero: -0, signedZeroChoice: -0, flags: [true], pair: ["x", 2], account: { kind: "admin", level: 3 } },
    schema: UserSchema,
  },
  tree: {
    data: { value: "root", age: 2, children: [] },
    schema: TreeSchema,
  },
};
const libraries = hsonLiveMap.fromLibraries(definitions);
const libraryName: string = libraries.lib("user").at(["name"]).snap();
const librarySchema: typeof UserSchema = libraries.lib("user").schema.get();
libraries.lib("user").at(["name"]).set("Grace");
// @ts-expect-error Generated Schema-derived handle rejects a wrong value.
libraries.lib("user").at(["name"]).set(37);
// Dynamic names are type-safe unions and checked against the live registry at runtime.
const dynamicLibraryName: string = "users";
void dynamicLibraryName;
const hostedLibraries = hsonLiveMap.locus.create({
  shared: [
    { name: "user", definition: definitions.user },
    { name: "tree", definition: definitions.tree },
  ],
  actions: {
    async rename(context) {
      const currentName: string = context.lib("user").at(["name"]).snap();
      const noRawMap: "map" extends keyof typeof context ? true : false = false;
      void [currentName, noRawMap];
      {
        const draft = context.stage;
        draft.lib("user").at(["name"]).set("Lin");
        // @ts-expect-error Hosted stage retains generated Schema write types.
        draft.lib("user").at(["name"]).set(37);
      }
    },
  },
});
const hostedLibraryName: string = hostedLibraries.lib("user").at(["name"]).snap();
const owned = hsonLiveMap.locus.create({ shared: [{ name: "user", definition: definitions.user }],
  private: [{ name: "tree", definition: definitions.tree }], actions: {
  rename(context) {
    context.stage.lib("user").at(["name"]).set("Mira");
    // @ts-expect-error Owned actions retain generated Schema write types.
    context.stage.lib("user").at(["name"]).set(37);
  },
} });
owned.lib("user").at(["name"]).set("Mira");
owned.stage((loc) => { loc.lib("user").at(["name"]).set("Mira"); });
// @ts-expect-error Owned construction preserves generated Schema write types.
owned.lib("user").at(["name"]).set(37);

void authored;
void certified;
void numberEvidence;
void recursiveAuthored;
void recursiveCertified;
void interactionFields;
void certifiedInteractionFields;
void relationalUnique;
void blocks;
void block_content;
void wrongBlock;
void libraryName;
void librarySchema;
void hostedLibraryName;
