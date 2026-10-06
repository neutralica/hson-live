import { InteractionFieldsSchema, ReuseSchema, TreeSchema, UserSchema } from "./producer.js";
import { type JsonFromSchema, HsonData, Hson, type HsonNumber } from "hson-live";
import type { JsonValue } from "hson-live/hson";
import type { HsonCanonical } from "hson-live/hson";

declare const projected: JsonFromSchema<typeof UserSchema>;
declare const canonical: HsonCanonical;

const optionalRead: string | undefined = projected.nickname;
const indexedRead: boolean | undefined = projected.flags[0];
const tupleRead: number = projected.pair[1];
const refinedInteger: JsonFromSchema<typeof UserSchema>["age"] = projected.age;
const refinedBound: JsonFromSchema<typeof UserSchema>["percent"] = projected.percent;
const refinedString: JsonFromSchema<typeof UserSchema>["code"] = projected.code;
const refinedAlphabet: JsonFromSchema<typeof UserSchema>["key"] = projected.key;
const refinedUnique: JsonFromSchema<typeof UserSchema>["flags"] = projected.flags;
const finitePhase: "lobby" | "ready" | "playing" | "finished" = projected.phase;
const finiteTurn: "player1" | "player2" | null = projected.turn;
const signedZeroChoice: JsonFromSchema<typeof UserSchema>["signedZeroChoice"] = projected.signedZeroChoice;
declare const recursive: JsonFromSchema<typeof TreeSchema>;
declare const reuse: JsonFromSchema<typeof ReuseSchema>;
const recursiveChild: JsonFromSchema<typeof TreeSchema> | undefined = recursive.children[0];
const recursiveAge: JsonFromSchema<typeof TreeSchema>["age"] = recursive.age;
const sharedDefinitionCompatibility: typeof reuse.again = reuse.left;
declare const interactionFields: JsonFromSchema<typeof InteractionFieldsSchema>;
const localArgs: JsonValue = interactionFields.args;
const authoritativePayload: JsonValue = interactionFields.payload;

const fabricated: JsonFromSchema<typeof UserSchema> = { name: "Ada", score: 37, age: 37, percent: 80, code: "ID-7", key: "abc", status: "ready", phase: "lobby", turn: "player1", zero: 0, negativeZero: -0, signedZeroChoice: 0, flags: [true], pair: ["x", 2], account: { kind: "user", handle: "ada" } };
const spreadObject: JsonFromSchema<typeof UserSchema> = { ...projected };
const reconstructed: JsonFromSchema<typeof UserSchema> = { ...projected, name: projected.name, score: projected.score, age: projected.age, percent: projected.percent, code: projected.code, flags: projected.flags, pair: projected.pair, account: projected.account };
const spreadArray: JsonFromSchema<typeof UserSchema>["flags"] = [...projected.flags];
const mappedArray: JsonFromSchema<typeof UserSchema>["flags"] = projected.flags.map(Boolean);
const concatenatedArray: JsonFromSchema<typeof UserSchema>["flags"] = projected.flags.concat([]);
const plainInteger: JsonFromSchema<typeof UserSchema>["age"] = projected.score;
const crossRefinementShape: JsonFromSchema<typeof UserSchema>["percent"] = projected.age;
const arithmeticInteger: JsonFromSchema<typeof UserSchema>["age"] = projected.age + 1;
const dividedInteger: JsonFromSchema<typeof UserSchema>["age"] = projected.age / 1;
const mathInteger: JsonFromSchema<typeof UserSchema>["age"] = Math.abs(projected.age);
const concatenatedString: JsonFromSchema<typeof UserSchema>["code"] = projected.code + "";
const slicedString: JsonFromSchema<typeof UserSchema>["code"] = projected.code.slice(0);
const casedString: JsonFromSchema<typeof UserSchema>["code"] = projected.code.toUpperCase();
const plainAlphabet: JsonFromSchema<typeof UserSchema>["key"] = "abc";
// @ts-expect-error a plain number has no Hson number evidence
const ordinaryNumber: HsonNumber = 37;
// @ts-expect-error broad canonical Hson has no exact Schema proof
const broadHson: HsonData<typeof UserSchema> = canonical;
declare function consumeCertified(value: HsonData<typeof UserSchema>): void;
// @ts-expect-error proof acquisition is restricted to an analyzer-recognized module-scope const
consumeCertified(Hson.data`<name "Ada">`);
// Runtime certification grants this Schema's proof after validation.
consumeCertified(UserSchema.certify(canonical));
// @ts-expect-error optional means absence, not explicit undefined
const explicitUndefined: JsonFromSchema<typeof UserSchema> = { ...projected, nickname: undefined };
const fabricatedRecursive: JsonFromSchema<typeof TreeSchema> = { value: "root", age: 1, children: [] };
const plainReferencedAge: JsonFromSchema<typeof TreeSchema>["age"] = 1;
const unrelatedDefinitionShape: typeof reuse.right = reuse.left;
// @ts-expect-error broad canonical Hson cannot impersonate recursive Schema evidence
const broadRecursiveHson: HsonData<typeof TreeSchema> = canonical;

void optionalRead;
void indexedRead;
void tupleRead;
void refinedInteger;
void refinedBound;
void refinedString;
void refinedAlphabet;
void refinedUnique;
void finitePhase;
void finiteTurn;
void signedZeroChoice;
void fabricated;
void spreadObject;
void reconstructed;
void spreadArray;
void mappedArray;
void concatenatedArray;
void plainInteger;
void crossRefinementShape;
void arithmeticInteger;
void dividedInteger;
void mathInteger;
void concatenatedString;
void slicedString;
void casedString;
void plainAlphabet;
void ordinaryNumber;
void broadHson;
void explicitUndefined;
void recursiveChild;
void recursiveAge;
void sharedDefinitionCompatibility;
void localArgs;
void authoritativePayload;
void fabricatedRecursive;
void plainReferencedAge;
void unrelatedDefinitionShape;
void broadRecursiveHson;
void TreeSchema;
