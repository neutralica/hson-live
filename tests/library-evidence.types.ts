import { hsonLiveMap, type HsonSchema } from "../src/index.js";
import type { JsonValue } from "../src/core/types.js";
import type { LocusActionContext, LocusDefinitions } from "../src/types/locus.core.types.js";
import type { ReadDataLocation } from "../src/types/governor.types.js";
import type { LiveMapKnownNames, LiveMapDefinitions, LiveMapLibraryDefinition } from "../src/types/livemap.types.js";

declare const schema: HsonSchema<{ rows: readonly { title: string }[]; optional?: { list: number[] }; unknown: unknown; choice: number[] | { count: number } }, "data">;
declare const otherSchema: HsonSchema<{ different: string }, "data">;
const definition = { data: { rows: [], unknown: [], choice: [] }, schema } as const satisfies LiveMapLibraryDefinition;
const definitions = { deck: { ...definition, access: "shared" }, page: { document: "<main/>" } } as const satisfies LocusDefinitions;
const loc = hsonLiveMap.locus.create(definitions);
loc.doc.page.render();
loc.data.deck.schema.get() satisfies typeof schema;
loc.data.deck.at(["rows", 0, "title"]).snap() satisfies string | undefined;
// @ts-expect-error Schema path precision survives shared inference.
loc.data.deck.at(["wrong"]);
// @ts-expect-error An indexed row may be missing.
loc.data.deck.at(["rows", 0, "title"]).snap() satisfies string;
const strong = loc.data.deck.at(["rows"]).asArray()!;
strong.snap() satisfies readonly { title: string }[];
const unknownArray = loc.data.deck.at(["unknown"]).asArray()!;
unknownArray.array.map(value => value satisfies JsonValue);
unknownArray.array.push({ fresh: true });
unknownArray.snap() satisfies readonly JsonValue[] | undefined;
// @ts-expect-error Runtime checks may expire.
unknownArray.snap() satisfies readonly JsonValue[];
const unknownObject = loc.data.deck.at(["unknown"]).asObject()!;
unknownObject.object.setKey("fresh", [1]);
unknownObject.snap() satisfies Readonly<Record<string, JsonValue>> | undefined;
// @ts-expect-error Runtime refinement has no precise fields.
unknownObject.at(["name"]).snap() satisfies string;
const choice = loc.data.deck.at(["choice"]).asObject()!;
choice.at(["count"]).snap() satisfies number | undefined;
// @ts-expect-error Ancestor shape evidence can expire too.
choice.at(["count"]).snap() satisfies number;
// @ts-expect-error Narrowing retains Schema member types.
choice.object.setKey("count", "bad");
const optional = loc.data.deck.at(["optional"]).present()!;
optional.at(["list"]).asArray()!.snap() satisfies number[] | undefined;
// @ts-expect-error Presence is transient when the Schema permits removal.
optional.snap() satisfies { list: number[] };

declare const maybeDefinitions: { deck?: typeof definition; page: { document: string } };
const maybe = hsonLiveMap.locus.create(maybeDefinitions);
maybe.doc.page.render();
// @ts-expect-error Optional definitions cannot establish guaranteed membership.
maybe.data.deck.at(["rows"]).array;
await maybe.admit({ deck: { data: { different: "new" }, schema: otherSchema } }) satisfies void;
maybe.data.must("deck", otherSchema).schema.get() satisfies typeof otherSchema;
maybe.data.must("deck", otherSchema).at(["different"]).snap() satisfies string;
// @ts-expect-error Checked Schema evidence rejects unrelated paths.
maybe.data.must("deck", otherSchema).at(["rows"]);
// @ts-expect-error The original inventory still has no certain governing evidence.
maybe.data.deck.snap() satisfies { rows: unknown[] };
declare const optionalKey: { page: { document: string }; deck?: typeof definition };
const optionalLoc = hsonLiveMap.locus.create(optionalKey);
optionalLoc.doc.page.render();
// @ts-expect-error Optional keyed entries cannot establish certain membership.
optionalLoc.data.deck.at(["rows"]).array;
optionalLoc.data.must("deck", schema).at(["rows"]).array.map(row => row.title);
declare const unionName: "first" | "second";
const unionLoc = hsonLiveMap.locus.create({ [unionName]: { ...definition, access: "shared" } });
// @ts-expect-error A union name does not establish both members.
unionLoc.data.first.at(["rows"]).array;
declare const widened: LocusDefinitions;
const wideLoc = hsonLiveMap.locus.create(widened);
// @ts-expect-error Widened definitions cannot manufacture literal membership.
wideLoc.data.deck.render();

declare const keyed: { required: typeof definition; possible?: typeof definition };
const local = hsonLiveMap.fromLibraries(keyed);
local.data.required.schema.get() satisfies typeof schema;
// @ts-expect-error An optional key cannot establish governing evidence.
local.data.possible.at(["rows"]).array;
const admitted = local.addLibraries({ possible: { data: { different: "fresh" }, schema: otherSchema } });
admitted.libraries.possible.schema.get() satisfies typeof otherSchema;
// @ts-expect-error A definitely existing key is still rejected.
local.addLibraries({ required: { data: {} } });
declare const wideKeyed: LiveMapDefinitions;
const wideMap = hsonLiveMap.fromLibraries(wideKeyed);
// @ts-expect-error No literals survive widening.
const name: LiveMapKnownNames<typeof wideMap> = "anything";
void name;

const roots = hsonLiveMap.fromLibraries({ array: { data: [1, "initial"] }, object: { data: { initial: 1 } } } as const);
roots.data.array.at([]).array.push({ changed: true });
roots.data.array.at([]).array.toArray() satisfies readonly JsonValue[];
// @ts-expect-error Initial values do not establish an immutable tuple.
roots.data.array.at([]).array.toArray() satisfies readonly [1, "initial"];
roots.data.array.at([]).asArray()!.snap() satisfies readonly JsonValue[];
roots.data.object.at([]).object.setKey("new", false);
roots.data.object.at([]).object.deleteKey("initial");
// @ts-expect-error Initial keys are not permanent members.
roots.data.object.at(["initial"]).snap() satisfies number;
// @ts-expect-error Root category does not prove any nested collection.
roots.data.object.at(["initial"]).array;
await loc.admit({ "array": { data: [], access: "shared" }, "object": { data: {}, access: "shared" } });
loc.data.must("array").at([]).asArray()!.array.push("new");
loc.data.must("object").at([]).asObject()!.object.setKey("new", 1);
roots.batch(writer => {
  writer.data.array.at([]).array.push("new");
  writer.data.object.at([]).object.setKey("new", 1);
});
declare const context: LocusActionContext<typeof roots>;
context.data.array.at([]).array.map(value => value);
context.data.object.at([]).object.keys();
// @ts-expect-error Root category does not grant write authority.
context.data.array.at([]).array.push(1);
declare const read: ReadDataLocation<unknown>;
const readArray = read.asArray()!;
readArray.array.map(value => value);
readArray.snap() satisfies readonly JsonValue[] | undefined;
// @ts-expect-error Read-only refinements cannot mutate.
readArray.array.push(1);
// @ts-expect-error Nested read-only refinements cannot mutate either.
readArray.at([0]).asObject()!.object.setKey("bad", 1);
// @ts-expect-error Generic refinements have no writable location methods.
read.asObject()!.replace({});

hsonLiveMap.locus.create(definitions, { actions: { inspect(context) {
  context.data.deck.at(["rows"]).array.map(row => row.title);
  // @ts-expect-error A read context has no direct setter after refinement.
  context.data.deck.at(["unknown"]).asArray()!.set([]);
} } });
hsonLiveMap.locus.create(maybeDefinitions, { actions: { inspect(context) {
  context.doc.page.render();
  // @ts-expect-error Contextual callbacks cannot certify an optional definition.
  context.data.deck.at(["rows"]).array;
} } });
// @ts-expect-error Flat construction retains the existing duplicate-name check.
hsonLiveMap.locus.create({ "duplicate": { ...definition, access: "shared" } }, { local: [{ name: "duplicate", initializer: definition }] });
// @ts-expect-error Flat construction retains Parts validation, including explicit undefined Schema claims.
hsonLiveMap.locus.create({ "parts": { parts: { p: { kind: "document", document: "<p hson:part/>", schema: undefined } }, access: "shared" } });
const uncertainLocal = hsonLiveMap.fromLibraries({ state: definition }).data.state.at(["choice"]).asArray()!;
uncertainLocal.watch(value => {
  value satisfies number[] | undefined;
  // @ts-expect-error A watcher must handle expired evidence.
  value satisfies number[];
});
uncertainLocal.update(value => {
  value satisfies number[] | undefined;
  return value ?? [];
});
const maybeChild = loc.data.deck.at(["optional"]).present()!.at(["list"]);
// @ts-expect-error Traversal preserves optional ancestry; refine the child before collection use.
maybeChild.array;
maybeChild.asArray()!.array.push(1);

// @ts-expect-error Flat definitions must not accept an unrelated bare map.
hsonLiveMap.locus.create(roots);

// Dictionary collection reads cannot turn requested names into required members.
roots.data.object.at([]).object.getKey("initial") satisfies JsonValue | undefined;
// @ts-expect-error The key may have been deleted.
roots.data.object.at([]).object.getKey("initial") satisfies JsonValue;
// @ts-expect-error Picking a broad object's key does not prove that it exists.
roots.data.object.at([]).object.pick(["initial"]).initial satisfies JsonValue;
