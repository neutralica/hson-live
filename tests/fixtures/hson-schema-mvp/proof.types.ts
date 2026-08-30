import { Hson, type HsonNumber } from "hson-live";
import type { HsonCanonical } from "hson-live/hson";
import { UserSchema, type UserSchemaHson, type UserSchemaValue } from "./producer.js";

declare const certified: UserSchemaValue;
declare const canonical: HsonCanonical;

const optionalRead: string | undefined = certified.nickname;
const indexedRead: boolean | undefined = certified.flags[0];
const tupleRead: HsonNumber = certified.pair[1];

// @ts-expect-error ordinary structural objects have no composite proof
const fabricated: UserSchemaValue = { name: "Ada", score: 37, flags: [true], pair: ["x", 2], account: { kind: "user", handle: "ada" } };
// @ts-expect-error object spread erases the root proof
const spreadObject: UserSchemaValue = { ...certified };
// @ts-expect-error reconstruction erases the root proof
const reconstructed: UserSchemaValue = { name: certified.name, score: certified.score, flags: certified.flags, pair: certified.pair, account: certified.account };
// @ts-expect-error array spread erases collection proof
const spreadArray: UserSchemaValue["flags"] = [...certified.flags];
// @ts-expect-error array transforms erase collection proof
const mappedArray: UserSchemaValue["flags"] = certified.flags.map(Boolean);
// @ts-expect-error a plain number has no Hson number evidence
const ordinaryNumber: HsonNumber = 37;
// @ts-expect-error broad canonical Hson has no exact Schema proof
const broadHson: UserSchemaHson = canonical;
declare function consumeCertified(value: UserSchemaHson): void;
// @ts-expect-error proof acquisition is restricted to an analyzer-recognized module-scope const
consumeCertified(Hson`<name "Ada">`);
// @ts-expect-error an unbound validation result remains broad outside the recognized declaration form
consumeCertified(Hson.validate(UserSchema, canonical));
// @ts-expect-error optional means absence, not explicit undefined
const explicitUndefined: UserSchemaValue = { ...certified, nickname: undefined };

void optionalRead;
void indexedRead;
void tupleRead;
void fabricated;
void spreadObject;
void reconstructed;
void spreadArray;
void mappedArray;
void ordinaryNumber;
void broadHson;
void explicitUndefined;
