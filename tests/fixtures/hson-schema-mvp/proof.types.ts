import { Hson, type HsonNumber } from "hson-live";
import type { HsonCanonical } from "hson-live/hson";
import { TreeSchema, UserSchema, type ReuseSchemaType, type TreeSchemaHson, type TreeSchemaType, type UserSchemaHson, type UserSchemaType } from "./producer.js";

declare const certified: UserSchemaType;
declare const canonical: HsonCanonical;

const optionalRead: string | undefined = certified.nickname;
const indexedRead: boolean | undefined = certified.flags[0];
const tupleRead: HsonNumber = certified.pair[1];
const refinedInteger: UserSchemaType["age"] = certified.age;
const refinedBound: UserSchemaType["percent"] = certified.percent;
const refinedString: UserSchemaType["code"] = certified.code;
const refinedUnique: UserSchemaType["flags"] = certified.flags;
declare const recursive: TreeSchemaType;
declare const reuse: ReuseSchemaType;
const recursiveChild: TreeSchemaType | undefined = recursive.children[0];
const recursiveAge: TreeSchemaType["age"] = recursive.age;
const sharedDefinitionCompatibility: typeof reuse.again = reuse.left;

// @ts-expect-error ordinary structural objects have no composite proof
const fabricated: UserSchemaType = { name: "Ada", score: 37, age: 37, percent: 80, code: "ID-7", flags: [true], pair: ["x", 2], account: { kind: "user", handle: "ada" } };
// @ts-expect-error object spread erases the root proof
const spreadObject: UserSchemaType = { ...certified };
// @ts-expect-error reconstruction erases the root proof
const reconstructed: UserSchemaType = { name: certified.name, score: certified.score, age: certified.age, percent: certified.percent, code: certified.code, flags: certified.flags, pair: certified.pair, account: certified.account };
// @ts-expect-error array spread erases collection proof
const spreadArray: UserSchemaType["flags"] = [...certified.flags];
// @ts-expect-error array transforms erase collection proof
const mappedArray: UserSchemaType["flags"] = certified.flags.map(Boolean);
// @ts-expect-error concat erases exact collection-node evidence
const concatenatedArray: UserSchemaType["flags"] = certified.flags.concat([]);
// @ts-expect-error a finite Hson number does not carry integer refinement evidence
const plainInteger: UserSchemaType["age"] = certified.score;
// @ts-expect-error distinct numeric refinement nodes are nominally distinct
const wrongNumericProof: UserSchemaType["percent"] = certified.age;
// @ts-expect-error arithmetic erases integer evidence
const arithmeticInteger: UserSchemaType["age"] = certified.age + 1;
// @ts-expect-error division erases integer evidence
const dividedInteger: UserSchemaType["age"] = certified.age / 1;
// @ts-expect-error Math operations erase integer evidence
const mathInteger: UserSchemaType["age"] = Math.abs(certified.age);
// @ts-expect-error concatenation erases constrained string evidence
const concatenatedString: UserSchemaType["code"] = certified.code + "";
// @ts-expect-error slice erases constrained string evidence
const slicedString: UserSchemaType["code"] = certified.code.slice(0);
// @ts-expect-error case conversion erases constrained string evidence
const casedString: UserSchemaType["code"] = certified.code.toUpperCase();
// @ts-expect-error a plain number has no Hson number evidence
const ordinaryNumber: HsonNumber = 37;
// @ts-expect-error broad canonical Hson has no exact Schema proof
const broadHson: UserSchemaHson = canonical;
declare function consumeCertified(value: UserSchemaHson): void;
// @ts-expect-error proof acquisition is restricted to an analyzer-recognized module-scope const
consumeCertified(Hson`<name "Ada">`);
// @ts-expect-error an unbound validation result remains broad outside the recognized declaration form
consumeCertified(Hson.certify(UserSchema, canonical));
// @ts-expect-error optional means absence, not explicit undefined
const explicitUndefined: UserSchemaType = { ...certified, nickname: undefined };
// @ts-expect-error recursive generated evidence cannot be supplied structurally or through a caller generic
const fabricatedRecursive: TreeSchemaType = { value: "root", age: hsonCalc(1), children: [] };
// @ts-expect-error the referenced Age refinement is not obscured by ref
const plainReferencedAge: TreeSchemaType["age"] = hsonCalc(1);
// @ts-expect-error structurally equal but declaration-distinct definitions retain separate proof identity
const unrelatedDefinitionProof: typeof reuse.right = reuse.left;
// @ts-expect-error broad canonical Hson cannot impersonate recursive Schema evidence
const broadRecursiveHson: TreeSchemaHson = canonical;

void optionalRead;
void indexedRead;
void tupleRead;
void refinedInteger;
void refinedBound;
void refinedString;
void refinedUnique;
void fabricated;
void spreadObject;
void reconstructed;
void spreadArray;
void mappedArray;
void concatenatedArray;
void plainInteger;
void wrongNumericProof;
void arithmeticInteger;
void dividedInteger;
void mathInteger;
void concatenatedString;
void slicedString;
void casedString;
void ordinaryNumber;
void broadHson;
void explicitUndefined;
void recursiveChild;
void recursiveAge;
void sharedDefinitionCompatibility;
void fabricatedRecursive;
void plainReferencedAge;
void unrelatedDefinitionProof;
void broadRecursiveHson;
void TreeSchema;
