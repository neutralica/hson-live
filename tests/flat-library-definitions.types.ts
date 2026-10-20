import { hsonLiveMap, type HsonSchema, type LocusDefinitions } from "../src/index.js";
import type { JsonValue } from "../src/core/types.js";
declare const schema: HsonSchema<{ rows: readonly { title: string }[]; optional?: number }, "data">;
const definitions = { deck: { data: { rows: [] }, schema }, page: { document: "<main/>", css: "main{color:red}", access: "shared" },
  components: { parts: { button: { kind: "document", document: "<button/>", css: "button{color:red}" } } } } as const satisfies LocusDefinitions;
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
loc.admit({ broken: { data: [], css: "p{}" } });
// @ts-expect-error Parts cannot carry Library CSS.
loc.admit({ broken: { parts: {}, css: "p{}" } });
// @ts-expect-error Unknown metadata is unsupported.
loc.admit({ broken: { document: "<p/>", ownership: "shared" } });
// @ts-expect-error Local LiveMap has no hosted access semantics.
hsonLiveMap.fromLibraries({ page: { document: "<p/>", access: "shared" } });
hsonLiveMap.fromLibraries({ page: { document: "<p/>", css: "p{color:red}" } });
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
loc.admit({ bad: { parts: { button: { kind: "document", document: "<button/>", schema: undefined } } } });
