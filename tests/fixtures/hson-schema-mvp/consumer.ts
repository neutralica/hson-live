import { Hson, hsonCalc, hsonLiveMap, hsonLocus, hsonTransform, type HsonNumber } from "hson-live";
import type { HsonCanonical } from "hson-live/hson";
import { TreeSchema, UserSchema, type TreeSchemaHson, type UserSchemaHson } from "./producer.js";

const authored: UserSchemaHson = Hson`
  <name "Ada" score 37 age 37 percent 80 code "ID-7" status "ready" phase "lobby" turn "player1" zero 0 negativeZero -0 signedZeroChoice -0 flags [true, false] pair ["x", 2] account <kind "user" handle "ada">>
`;

const dynamic: HsonCanonical = hsonTransform.fromJson({ name: "Ada", score: 37, age: 37, percent: 80, code: "ID-7", status: "ready", phase: "finished", turn: null, zero: 0, negativeZero: -0, signedZeroChoice: 0, flags: [true], pair: ["x", 2], account: { kind: "admin", level: 3 } }).toHson().serialize();
const certified: UserSchemaHson = Hson.certify(UserSchema, dynamic);
const numberEvidence: HsonNumber = hsonCalc(37);
const recursiveAuthored: TreeSchemaHson = Hson`<value "root" age 2 children [<value "leaf" age 0 children []>]>`;
const recursiveDynamic: HsonCanonical = hsonTransform.fromJson({ value: "root", age: 3, children: [{ value: "leaf", age: 1, children: [] }] }).toHson().serialize();
const recursiveCertified: TreeSchemaHson = Hson.certify(TreeSchema, recursiveDynamic);

const libraries = hsonLiveMap.fromLibraries({
  user: {
    data: { name: "Ada", score: 37, age: 37, percent: 80, code: "ID-7", status: "ready", phase: "playing", turn: "player2", zero: 0, negativeZero: -0, signedZeroChoice: -0, flags: [true], pair: ["x", 2], account: { kind: "admin", level: 3 } },
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
// @ts-expect-error Statically declared Library names reject typos.
libraries.lib("users");
const hostedLibraries = hsonLocus.create({
  map: libraries,
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
void libraryName;
void librarySchema;
void hostedLibraryName;
