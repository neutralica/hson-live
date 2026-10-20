import { hsonLiveMap, type HsonSchema } from "hson-live";
import { DeckSchema, firstSchema } from "./fixtures/hson-schema-document/out/deck.js";
import type { LocusActionContext } from "hson-live/locus";
const deck = { slides: [{ id: "one", column1: [{ kind: "code", content: "source", language: "json" }] }] };
const map = hsonLiveMap.fromLibraries({ deck: { data: deck, schema: DeckSchema }, page: { document: '<html <head/> <body/>/>', schema: firstSchema } });
const locus = hsonLiveMap.locus.create({ shared: [{ name: "deck", definition: { data: deck, schema: DeckSchema } }, { name: "page", definition: { document: '<html <head/> <body/>/>', schema: firstSchema } }] });
locus.doc.must("page").render();
locus.doc.must("page").at([1]).asElement()!.attrs.keys();
// @ts-expect-error Deck document has exactly head and body.
locus.doc.must("page").at([2]);
// @ts-expect-error Impossible data path.
locus.data.must("deck").at(["slides", 0, "unknown"]);
// @ts-expect-error Indexed absence is preserved.
const requiredTitle: string = locus.data.must("deck").at(["slides", 0, "title"]).snap();
locus.data.must("deck").at(["slides", 0, "column1"]).asArray()!.array.map(block => {
  if (block.kind === "code") block.language satisfies "json" | "html" | "hson" | undefined;
  if (block.kind === "heading") {
    block.content satisfies string;
    // @ts-expect-error Discriminated Heading has no language.
    block.language;
  }
  return block.kind;
}) satisfies string[];
map.data.must("deck").at(["slides"]).array.push({ id: "two", column1: [] });
locus.data.must("deck").at(["slides"]).array.push({ id: "two", column1: [] }) satisfies Promise<void>;
// @ts-expect-error Bad block discriminant is rejected.
locus.data.must("deck").at(["slides"]).array.push({ id: "bad", column1: [{ kind: "wrong", content: "bad" }] });
locus.stage(writer => {
  writer.data.must("deck").at(["slides"]).array.push({ id: "three", column1: [] }) satisfies void;
  // @ts-expect-error Staged collections have commands only.
  writer.data.must("deck").at(["slides"]).array.map(value => value);
  // @ts-expect-error Staged locations have no callback update.
  writer.data.must("deck").at(["slides"]).update(() => []);
});
declare const context: LocusActionContext<typeof map>;
context.data.must("deck").at(["slides"]).array.map(slide => slide.id);
context.data.must("deck").at(["slides"]).at([0]).asObject()?.object.keys();
context.doc.must("page").at([1]).asElement()?.attrs.keys();
// @ts-expect-error Read contexts retain impossible path rejection.
context.data.must("deck").at(["wrong"]);
// @ts-expect-error Read-only context collections cannot mutate.
context.data.must("deck").at(["slides"]).array.push({ id: "bad", column1: [] });
// @ts-expect-error Read-only nested document locations cannot mutate.
context.doc.must("page").at([1]).asElement()?.attrs.set("id", "bad");
// @ts-expect-error Flat collection methods were removed.
map.data.must("deck").at(["slides"]).push({ id: "bad", column1: [] });
// @ts-expect-error Locus has no callback-based update.
locus.data.must("deck").at(["slides"]).update(() => []);

declare const mixedSchema: HsonSchema<{ optional?: number[]; choice: number[] | { n: number }; tuple: readonly [string, number] }, "data">;
const mixed = hsonLiveMap.locus.create({ shared: [{ name: "state", definition: { data: { choice: [], tuple: ["one", 1] }, schema: mixedSchema } }] });
const choice = mixed.data.must("state").at(["choice"]);
if (choice.kind() === "array") {
  // @ts-expect-error kind() observation cannot certify a changing location.
  choice.array;
}
choice.asArray()?.array.push(2);
choice.asObject()?.object.setKey("n", 2);
const optional = mixed.data.must("state").at(["optional"]);
// @ts-expect-error Optional collection needs validated refinement.
optional.array;
optional.asArray()?.array.push(2);
const tuple = mixed.data.must("state").at(["tuple"]).array;
tuple.toArray() satisfies readonly [string, number];
tuple.slice() satisfies readonly (string | number)[];
// @ts-expect-error A slice does not preserve the full tuple shape.
tuple.take(1) satisfies readonly [string, number];
// @ts-expect-error Tuple path cannot index past the end.
mixed.data.must("state").at(["tuple", 2]);

// Echo source discrimination preserves the collection authority boundary.
declare const echoLibrary: import("hson-live/echo").EchoLibrary;
if (echoLibrary.mode !== "document") {
  if (echoLibrary.source === "authority-projected") {
    const projected = echoLibrary.at([]).asArray();
    projected?.array.map(value => value);
    // @ts-expect-error Projected data has no collection mutation authority.
    projected?.array.push(1);
    // @ts-expect-error Projected data has no callback update authority.
    echoLibrary.at([]).update(value => value);
  } else {
    echoLibrary.at([]).asArray()?.array.push(1) satisfies import("hson-live/livemap").LiveMapCommit | undefined;
  }
}

map.batch(writer => {
  writer.data.must("deck").at([]).object.setKey("slides", []);
  writer.data.must("deck").at(["slides"]).array.push({ id: "required", column1: [] });
  const column = writer.data.must("deck").at(["slides", 0, "column2"]);
  // @ts-expect-error Both the slide and column may be absent.
  column.array.push({ kind: "paragraph", content: "x" });
  // @ts-expect-error Indexed slide absence must also be retained for required column1.
  writer.data.must("deck").at(["slides", 0, "column1"]).array;
  // @ts-expect-error An indexed slide does not have unconditional object capability.
  writer.data.must("deck").at(["slides", 0]).object;
  const refined = column.asArray();
  refined.array.push({ kind: "paragraph", content: "x" });
  refined.array.push({ kind: "code", content: "x", language: "hson" });
  // @ts-expect-error Refinement retains the Deck Block union.
  refined.array.push({ kind: "paragraph", content: "x", language: "hson" });
  // @ts-expect-error Refinement retains the field's element type.
  refined.array.push({ kind: "wrong", content: "x" });
  // @ts-expect-error Refinement does not grant snapshot access.
  refined.snap();
  // @ts-expect-error Refinement does not grant array observations.
  refined.array.map(value => value);
  writer.data.must("deck").at(["slides", 0]).asObject().object.setKey("title", "Title");
});
mixed.stage(writer => {
  const choice = writer.data.must("state").at(["choice"]);
  // @ts-expect-error A union is not certainly an array.
  choice.array;
  // @ts-expect-error A union is not certainly an object.
  choice.object;
  choice.asArray().array.push(1);
  choice.asObject().object.setKey("n", 1);
  // @ts-expect-error Object refinement retains value precision.
  choice.asObject().object.setKey("n", "wrong");
  // @ts-expect-error Optional staged values retain absence.
  writer.data.must("state").at(["optional"]).array;
  writer.data.must("state").at(["optional"]).asArray().array.push(1);
});
declare const unknownSchema: HsonSchema<{ value: unknown }, "data">;
const uncertain = hsonLiveMap.fromLibraries({ state: { data: { value: [] }, schema: unknownSchema } });
uncertain.batch(writer => {
  const value = writer.data.must("state").at(["value"]);
  // @ts-expect-error Unknown values cannot certify an array.
  value.array;
  // @ts-expect-error Unknown values cannot certify an object.
  value.object;
  value.asArray().array.push(1);
  value.asObject().object.setKey("key", 1);
});
