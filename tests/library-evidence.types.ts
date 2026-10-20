import { hsonLiveMap, type HsonSchema } from "../src/index.js";
import type { JsonValue } from "../src/core/types.js";
import type { LocusActionContext, LocusDefinitionOptions, LocusRuntimeLibraryAdditions } from "../src/types/locus.core.types.js";
import type { ReadDataLocation } from "../src/types/governor.types.js";
import type { LiveMapKnownNames, LiveMapDefinitions, LiveMapLibraryDefinition } from "../src/types/livemap.types.js";

declare const schema: HsonSchema<{ rows: readonly { title: string }[]; optional?: { list: number[] }; unknown: unknown; choice: number[] | { count: number } }, "data">;
declare const otherSchema: HsonSchema<{ different: string }, "data">;
const definition = { data: { rows: [], unknown: [], choice: [] }, schema } as const satisfies LiveMapLibraryDefinition;
const groups = { shared: [{ name: "deck", definition }], private: [{ name: "page", definition: { document: "<main/>" } }] } as const satisfies LocusRuntimeLibraryAdditions;
const loc = hsonLiveMap.locus.create(groups);
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

declare const maybeGroups: { shared?: typeof groups.shared; private: typeof groups.private };
const maybe = hsonLiveMap.locus.create(maybeGroups);
maybe.doc.page.render();
// @ts-expect-error Optional group cannot establish governing Schema or family.
maybe.data.deck.at(["rows"]).array;
const later = await maybe.addLibraries({ shared: [{ name: "deck", definition: { data: { different: "new" }, schema: otherSchema } }] });
later.libraries.deck.schema.get() satisfies typeof otherSchema;
later.libraries.deck.at(["different"]).snap() satisfies string;
// @ts-expect-error Absent construction evidence cannot govern a later admission.
later.libraries.deck.at(["rows"]);
// @ts-expect-error The earlier alias still has no certain governing evidence.
maybe.data.deck.snap() satisfies { rows: unknown[] };

declare const tuple: readonly [typeof groups.private[0], { name: "deck"; definition: typeof definition }?];
const tupleLoc = hsonLiveMap.locus.create({ shared: tuple });
tupleLoc.doc.page.render();
// @ts-expect-error Optional tuple entry cannot establish certain membership.
tupleLoc.data.deck.at(["rows"]).array;
const tupleReceipt = await loc.addLibraries({ shared: tuple });
tupleReceipt.libraries.page.render();
// @ts-expect-error Admission and construction share certainty rules.
tupleReceipt.libraries.deck.at(["rows"]);
tupleReceipt.libraries.deck?.at(["rows"]).array.map(row => row.title);
declare const list: readonly { name: "deck"; definition: typeof definition }[];
const listLoc = hsonLiveMap.locus.create({ shared: list });
// @ts-expect-error A list may be empty.
listLoc.data.deck.at(["rows"]).array;
declare const unionName: "first" | "second";
const unionLoc = hsonLiveMap.locus.create({ shared: [{ name: unionName, definition }] });
// @ts-expect-error A union name does not establish both members.
unionLoc.data.first.at(["rows"]).array;
declare const widened: LocusDefinitionOptions;
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
const rootReceipt = await loc.addLibraries({ shared: [{ name: "array", definition: { data: [] } }, { name: "object", definition: { data: {} } }] });
rootReceipt.libraries.array.at([]).array.push("new");
rootReceipt.libraries.object.at([]).object.setKey("new", 1);
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

hsonLiveMap.locus.create({ ...groups, actions: { inspect(context) {
  context.data.deck.at(["rows"]).array.map(row => row.title);
  // @ts-expect-error A read context has no direct setter after refinement.
  context.data.deck.at(["unknown"]).asArray()!.set([]);
} } });
hsonLiveMap.locus.create({ ...maybeGroups, actions: { inspect(context) {
  context.doc.page.render();
  // @ts-expect-error Contextual callbacks cannot certify an optional group.
  context.data.deck.at(["rows"]).array;
} } });
// @ts-expect-error Presence overloads retain the existing duplicate-name check.
hsonLiveMap.locus.create({ shared: [{ name: "duplicate", definition }], local: [{ name: "duplicate", initializer: definition }] });
// @ts-expect-error Presence overloads retain Parts validation, including explicit undefined Schema claims.
hsonLiveMap.locus.create({ shared: [{ name: "parts", definition: { parts: { p: { kind: "document", document: "<p/>", schema: undefined } } } }] });
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

// @ts-expect-error Empty grouped options must not accept an unrelated bare map.
hsonLiveMap.locus.create(roots);

// Dictionary collection reads cannot turn requested names into required members.
roots.data.object.at([]).object.getKey("initial") satisfies JsonValue | undefined;
// @ts-expect-error The key may have been deleted.
roots.data.object.at([]).object.getKey("initial") satisfies JsonValue;
// @ts-expect-error Picking a broad object's key does not prove that it exists.
roots.data.object.at([]).object.pick(["initial"]).initial satisfies JsonValue;
