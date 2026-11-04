import { hsonLiveMap, type HsonSchema, type LocusDefinitions } from "../src/index.js";
import type { JsonValue } from "../src/core/types.js";
declare const schema: HsonSchema<{ rows: readonly { title: string }[]; optional?: number }, "data">;
const definitions = { deck: { data: { rows: [] }, schema }, page: { document: "<main/>", stylesheet: "main{color:red}", access: "shared" },
  components: { parts: { button: { kind: "document", document: "<button hson:part/>", stylesheet: "button{color:red}" } } } } as const satisfies LocusDefinitions;
const loc = hsonLiveMap.locus.create(definitions);
loc.data.deck.schema.get() satisfies typeof schema;
loc.data.deck.at(["rows", 0, "title"]).snap() satisfies string | undefined;
loc.doc.page.render();
loc.parts.components.at(["button", "document"]).snap() satisfies string | undefined;
// @ts-expect-error Schema path precision remains exact.
loc.data.deck.at(["wrong"]);
// @ts-expect-error Contradictory families cannot depend on insertion order.
hsonLiveMap.locus.create({ broken: { data: 1, document: "<p/>" } });
// @ts-expect-error Explicit undefined family claims are contradictory in both optional modes.
hsonLiveMap.locus.create({ broken: { data: undefined, document: "<p/>" } });
// @ts-expect-error Missing family.
hsonLiveMap.locus.create({ broken: { access: "shared" } });
// @ts-expect-error No arbitrary Parts Schema.
hsonLiveMap.locus.create({ broken: { parts: {}, schema: undefined } });
// @ts-expect-error Data cannot carry document CSS.
loc.admit({ broken: { data: [], stylesheet: "p{}" } });
// @ts-expect-error Parts cannot carry Library CSS.
loc.admit({ broken: { parts: {}, stylesheet: "p{}" } });
// @ts-expect-error Unknown metadata is unsupported.
loc.admit({ broken: { document: "<p/>", ownership: "shared" } });
// @ts-expect-error Local LiveMap has no hosted access semantics.
hsonLiveMap.fromLibraries({ page: { document: "<p/>", access: "shared" } });
hsonLiveMap.fromLibraries({ page: { document: "<p/>", stylesheet: "p{color:red}" } });
// @ts-expect-error Configuration fields are separate from Library definitions.
hsonLiveMap.locus.create({ shared: [{ name: "x", definition: { data: 1 } }] });
// @ts-expect-error Construction configuration cannot claim an authority group.
hsonLiveMap.locus.create({}, { shared: [] });
// @ts-expect-error New access modes are unsupported.
loc.admit({ bad: { data: 1, access: "local" } });
const promise: Promise<void> = loc.admit({ incoming: { data: { rows: [] }, schema } });
const result: void = await promise;
// @ts-expect-error No public receipt.
result.libraries;
// @ts-expect-error Async admission leaves the original static inventory unchanged.
loc.data.incoming;
loc.data.must("incoming", schema).at(["rows", 0, "title"]).snap() satisfies string | undefined;
// @ts-expect-error Checked Schema rejects impossible paths after admission.
loc.data.must("incoming", schema).at(["missing"]);
// @ts-expect-error Obsolete admission method removed.
loc.addLibraries({ incoming: { data: 1 } });
// @ts-expect-error Admission is a single callable operation.
loc.admit.batch({ incoming: { data: 1 } });
declare const optional: { page: { document: string }; deck?: typeof definitions.deck };
const maybe = hsonLiveMap.locus.create(optional);
maybe.doc.page.render();
// @ts-expect-error Optional keys do not certify membership.
maybe.data.deck.schema.get();
declare const widened: LocusDefinitions;
const wide = hsonLiveMap.locus.create(widened);
// @ts-expect-error Widening cannot invent literal inventory.
wide.doc.page.render();
declare const either: { a: { data: [] } } | { b: { document: string } };
const union = hsonLiveMap.locus.create(either);
// @ts-expect-error A union cannot establish both alternatives.
union.data.a.snap();
const roots = hsonLiveMap.locus.create({ array: { data: [1] }, object: { data: { first: 1 } } });
roots.data.array.at([]).array.push("next");
roots.data.object.at([]).object.setKey("other", true);
roots.data.array.snap() satisfies readonly JsonValue[];
// @ts-expect-error Initial contents are not persistent field evidence.
roots.data.object.at(["first"]).snap() satisfies number;
hsonLiveMap.locus.create(definitions, { actions: { inspect(context) {
  context.data.deck.at(["rows"]).array.map(row => row.title);
  // @ts-expect-error The action context remains read-only.
  context.data.deck.at(["rows"]).array.push({ title: "forbidden" });
} } });
// @ts-expect-error Client-local initializer collision is rejected statically too.
hsonLiveMap.locus.create(definitions, { local: [{ name: "page", initializer: { data: 1 } }] });

// @ts-expect-error Local initializer definitions cannot carry hosted access metadata.
hsonLiveMap.locus.create({}, { local: [{ name: "ui", initializer: { data: 1, access: "shared" } }] });
// @ts-expect-error The initializer contract has the same exact family discrimination.
hsonLiveMap.locus.create({}, { local: [{ name: "ui", initializer: { data: undefined, document: "<main/>" } }] });
// @ts-expect-error Local records retain their existing fields.
hsonLiveMap.locus.create({}, { local: [{ name: "ui", initializer: { data: 1 }, access: "private" }] });
// @ts-expect-error An explicit undefined access value is not an omitted field in either compiler mode.
loc.admit({ bad: { data: 1, access: undefined } });
declare const uncertainAccess: { data: number; access: "private" | undefined };
// @ts-expect-error Required access evidence may not include unsupported values.
loc.admit({ bad: uncertainAccess });
declare const uncertainShape: { document: string } | { document: string; data: undefined };
// @ts-expect-error A possible contradictory definition must not be hidden by a valid union branch.
loc.admit({ bad: uncertainShape });
// @ts-expect-error Parts member Schema claims remain forbidden under either optional mode.
loc.admit({ bad: { parts: { button: { kind: "document", document: "<button hson:part/>", schema: undefined } } } });

const structured = { color: "red", "--tone": "blue", width: { value: 2, unit: "em" },
  "& > body": { marginTop: undefined }, "@:heading": { _hover: { color: "pink" } },
  $media: { screen: { "@:heading": { fontSize: 12 } } } } as const;
hsonLiveMap.fromLibraries({ page: { document: "<main @:heading/>", stylesheet: structured } });
loc.admit({ page: { document: "<main @:heading/>", stylesheet: structured } });
hsonLiveMap.locus.create({}, { local: [{ name: "ui", initializer: { document: "<main @:heading/>" }, stylesheet: structured }] });
// @ts-expect-error Generic Document admission retains declaration-key diagnostics.
hsonLiveMap.fromLibraries({ page: { document: "<main/>", stylesheet: { notAProperty: "red" } } });
// @ts-expect-error Relative blocks retain unknown-key diagnostics too.
loc.admit({ page: { document: "<main/>", stylesheet: { "& > p": { colour: "red" } } } });
// @ts-expect-error Media blocks retain nested declaration checks.
loc.admit({ page: { document: "<main/>", stylesheet: { $media: { screen: { colour: "red" } } } } });
// @ts-expect-error Local override stylesheets have the same exact CssMap grammar.
hsonLiveMap.locus.create({}, { local: [{ name: "ui", initializer: { document: "<main/>" }, stylesheet: { colour: "red" } }] });
// @ts-expect-error Structured CSS cannot weaken the Library envelope.
loc.admit({ page: { document: "<main/>", stylesheet: structured, extra: true } });

// Interfaces use the same recursive Data check as object literals.
import { hsonLiveMap as DedicatedMap } from "hson-live/livemap";
interface RecordData { readonly count: number; label?: string; }
declare const recordData: RecordData;
declare const interfaceUnion: RecordData | readonly RecordData[] | string | null;
{ const factory = hsonLiveMap;
  const admitted = factory.fromLibraries({ state: { data: recordData } });
  admitted.addLibraries({ other: { data: interfaceUnion } });
  const authority = factory.locus.create({ state: { data: interfaceUnion } });
  authority.admit({ other: { data: recordData } });
  const opaque: object = new Date();
  // @ts-expect-error Opaque objects supply no structural evidence.
  factory.fromLibraries({ state: { data: opaque } });
  // @ts-expect-error Dynamic admission uses the same check.
  admitted.addLibraries({ bad: { data: opaque } });
  // @ts-expect-error Hosted admission uses the same check.
  authority.admit({ bad: { data: opaque } });
  // @ts-expect-error Identifiable unsupported instances remain invalid.
  factory.fromLibraries({ bad: { data: new Date() } });
  // @ts-expect-error Functions remain invalid.
  factory.fromLibraries({ bad: { data: () => 1 } });
}

{ const factory = DedicatedMap;
  const admitted = factory.fromLibraries({ state: { data: recordData } });
  admitted.addLibraries({ other: { data: interfaceUnion } });
  const authority = factory.locus.create({ state: { data: interfaceUnion } });
  authority.admit({ other: { data: recordData } });
  const opaque: object = new Date();
  // @ts-expect-error Opaque objects supply no structural evidence.
  factory.fromLibraries({ state: { data: opaque } });
  // @ts-expect-error Dynamic admission uses the same check.
  admitted.addLibraries({ bad: { data: opaque } });
  // @ts-expect-error Hosted admission uses the same check.
  authority.admit({ bad: { data: opaque } });
  // @ts-expect-error Identifiable unsupported instances remain invalid.
  factory.fromLibraries({ bad: { data: new Date() } });
  // @ts-expect-error Functions remain invalid.
  factory.fromLibraries({ bad: { data: () => 1 } });
}
