import { HSON, type HsonCanonical } from "hson-live/hson";
import type { HsonCanonical as TransformCanonical } from "hson-live/transform";
import type { LiveMapSchema } from "hson-live/livemap";

declare const schema: LiveMapSchema;
const authored: HsonCanonical = HSON`<age 37>`;
const sameBrand: TransformCanonical = authored;
const checked: HsonCanonical = HSON.validate(schema, sameBrand);
// @ts-expect-error Canonical authoring does not expose aggregate subsystems.
HSON.liveTree;
// @ts-expect-error Arbitrary source text is not canonical input.
HSON.validate(schema, "<age 37>");
void checked;
