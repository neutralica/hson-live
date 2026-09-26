import { Hson, hsonLiveMap, type HsonSchema } from "../src/index.js";

const mainShell = Hson.document`<main/>`;
const initialState = { count: 0 };
const schema = Hson.schema`<type "data" content <count "number">>`;

const map = hsonLiveMap.create();
const commit = map.addLibraries({ home: { document: mainShell } });
void commit.operations;
map.lib("home").css.stylesheet("body { margin: 0; }");
map.addLibraries({ state: { data: initialState, schema } });
// @ts-expect-error Dynamically admitted libraries still require mode narrowing for data operations.
map.lib("state").snap();
// @ts-expect-error Admission is an operation on LiveMap, not its selector.
map.lib.add({ next: { data: 1 } });
// @ts-expect-error The factory does not admit libraries on an existing map.
hsonLiveMap.addLibraries(map, { next: { data: 1 } });

const known = hsonLiveMap.fromLibraries({
  home: { document: mainShell },
  state: { data: initialState, schema },
});
known.lib("home").css;
const preciseSchema: HsonSchema = known.lib("state").schema.get();
void preciseSchema;
known.lib("state").snap();
// @ts-expect-error Known data roots do not expose document CSS.
known.lib("state").css;
// @ts-expect-error A document location is not the document-library root.
known.lib("home").at([0]).css;
// @ts-expect-error A statically known name cannot be admitted twice.
known.addLibraries({ home: { data: initialState } });
known.addLibraries({ extra: { data: initialState } });

declare const dynamicName: string;
const constructedDynamic = hsonLiveMap.fromLibraries({ [dynamicName]: { document: mainShell } });
constructedDynamic.lib("unrelated").css;
// @ts-expect-error A computed string name cannot make every library a document.
constructedDynamic.lib("unrelated").document;

declare const typedSchema: HsonSchema<Readonly<{ count: number }>, "data">;
const typedMap = hsonLiveMap.fromLibraries({ exact: { data: { count: 1 }, schema: typedSchema } });
typedMap.lib("exact").at(["count"]).replace(2);
// @ts-expect-error The construction Schema preserves the numeric data path.
typedMap.lib("exact").at(["count"]).replace("wrong");
