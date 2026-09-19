import { Hson, type HsonData, type HsonDocument, type HsonCanonical, type HsonSchema } from "hson-live/hson";
import type { HsonCanonical as TransformCanonical } from "hson-live/transform";

declare const schema: HsonSchema;
const authored: HsonCanonical = Hson.canonical`<age 37>`;
const sameBrand: TransformCanonical = authored;
const checked: HsonCanonical = schema.certify(sameBrand);
const exact: HsonData = Hson.data.fromHson(authored);
const document: HsonDocument = Hson.document.fromHson(Hson.canonical`<main/>`);
// @ts-expect-error Runtime text must first cross an explicit HsonCanonical boundary.
Hson.document.fromHson("<main/>");
const materialized = Hson.data.materialize(exact);
// @ts-expect-error Canonical authoring does not expose aggregate subsystems.
Hson.liveTree;
// @ts-expect-error Arbitrary source text is not canonical input.
schema.certify("<age 37>");
void checked;
void materialized;
void Hson.document.toNode(document);
