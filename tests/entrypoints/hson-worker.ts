import { Hson, type HsonCanonical } from "hson-live/hson";
import type { HsonCanonical as TransformCanonical } from "hson-live/transform";
import type { LiveMapSchema } from "hson-live/livemap";

declare const schema: LiveMapSchema;
const authored: HsonCanonical = Hson`<age 37>`;
const sameBrand: TransformCanonical = authored;
const checked: HsonCanonical = Hson.validate(schema, sameBrand);
// @ts-expect-error Canonical authoring does not expose aggregate subsystems.
Hson.liveTree;
// @ts-expect-error Arbitrary source text is not canonical input.
Hson.validate(schema, "<age 37>");
void checked;
