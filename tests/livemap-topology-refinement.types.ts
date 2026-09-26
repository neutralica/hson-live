import { Hson, hsonLiveMap, type HsonSchema } from "../src/index.js";

const mainShell = Hson.document`<main/>`;
const initialState = { count: 0 };
const schema = Hson.schema`<type "data" content <count "number">>`;

const map = hsonLiveMap.create();
hsonLiveMap.addLibraries(map, { home: { document: mainShell } });
map.lib("home").css.stylesheet("body { margin: 0; }");
hsonLiveMap.addLibraries(map, { state: { data: initialState, schema } });
map.lib("home").css;
const preciseSchema: HsonSchema = map.lib("state").schema.get();
void preciseSchema;
map.lib("state").snap();
// @ts-expect-error Known data roots do not expose document CSS.
map.lib("state").css;
// @ts-expect-error A document location is not the document-library root.
map.lib("home").at([0]).css;
// @ts-expect-error A statically known name cannot be admitted twice.
hsonLiveMap.addLibraries(map, { home: { data: initialState } });

declare const dynamicName: string;
const dynamicMap = hsonLiveMap.create();
hsonLiveMap.addLibraries(dynamicMap, { [dynamicName]: { document: mainShell } });
// @ts-expect-error A computed string name cannot make every library a document.
dynamicMap.lib("unrelated").css;

const constructedDynamic = hsonLiveMap.fromLibraries({ [dynamicName]: { document: mainShell } });
// @ts-expect-error Construction from a computed string name cannot claim every document.
constructedDynamic.lib("unrelated").css;

declare const typedSchema: HsonSchema<Readonly<{ count: number }>, "data">;
const typedMap = hsonLiveMap.create();
hsonLiveMap.addLibraries(typedMap, { exact: { data: { count: 1 }, schema: typedSchema } });
typedMap.lib("exact").at(["count"]).replace(2);
// @ts-expect-error The admitted Schema preserves the numeric data path.
typedMap.lib("exact").at(["count"]).replace("wrong");
