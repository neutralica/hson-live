import { Hson, type HsonCanonical, type HsonSchema } from "hson-live/hson";
import type { HsonCanonical as TransformCanonical } from "hson-live/transform";

declare const schema: HsonSchema;
const authored: HsonCanonical = Hson`<age 37>`;
const sameBrand: TransformCanonical = authored;
const checked: HsonCanonical = Hson.certify(schema, sameBrand);
// @ts-expect-error Canonical authoring does not expose aggregate subsystems.
Hson.liveTree;
// @ts-expect-error Arbitrary source text is not canonical input.
Hson.certify(schema, "<age 37>");
void checked;
