import { Hson, hsonCalc, hsonTransform, type HsonNumber } from "hson-live";
import type { HsonCanonical } from "hson-live/hson";
import { UserSchema, type UserSchemaHson } from "./producer.js";

const authored: UserSchemaHson = Hson`
  <name "Ada" score 37 age 37 percent 80 code "ID-7" status "ready" zero 0 negativeZero -0 flags [true, false] pair ["x", 2] account <kind "user" handle "ada">>
`;

const dynamic: HsonCanonical = hsonTransform.fromJson({ name: "Ada", score: 37, age: 37, percent: 80, code: "ID-7", status: "ready", zero: 0, negativeZero: -0, flags: [true], pair: ["x", 2], account: { kind: "admin", level: 3 } }).toHson().serialize();
const certified: UserSchemaHson = Hson.certify(UserSchema, dynamic);
const numberEvidence: HsonNumber = hsonCalc(37);

void authored;
void certified;
void numberEvidence;
