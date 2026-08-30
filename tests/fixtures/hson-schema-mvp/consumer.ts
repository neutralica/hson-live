import { Hson, hsonCalc, hsonTransform, type HsonNumber } from "hson-live";
import type { HsonCanonical } from "hson-live/hson";
import { TreeSchema, UserSchema, type TreeSchemaHson, type UserSchemaHson } from "./producer.js";

const authored: UserSchemaHson = Hson`
  <name "Ada" score 37 age 37 percent 80 code "ID-7" status "ready" zero 0 negativeZero -0 flags [true, false] pair ["x", 2] account <kind "user" handle "ada">>
`;

const dynamic: HsonCanonical = hsonTransform.fromJson({ name: "Ada", score: 37, age: 37, percent: 80, code: "ID-7", status: "ready", zero: 0, negativeZero: -0, flags: [true], pair: ["x", 2], account: { kind: "admin", level: 3 } }).toHson().serialize();
const certified: UserSchemaHson = Hson.certify(UserSchema, dynamic);
const numberEvidence: HsonNumber = hsonCalc(37);
const recursiveAuthored: TreeSchemaHson = Hson`<value "root" age 2 children [<value "leaf" age 0 children []>]>`;
const recursiveDynamic: HsonCanonical = hsonTransform.fromJson({ value: "root", age: 3, children: [{ value: "leaf", age: 1, children: [] }] }).toHson().serialize();
const recursiveCertified: TreeSchemaHson = Hson.certify(TreeSchema, recursiveDynamic);

void authored;
void certified;
void numberEvidence;
void recursiveAuthored;
void recursiveCertified;
