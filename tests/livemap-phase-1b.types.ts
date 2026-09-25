import { Hson, hsonLiveMap } from "../src/index.js";

const known = hsonLiveMap.fromLibraries({
  page: { document: Hson.document`<main/>` },
  state: { data: { count: 0 } },
});
known.lib("page").document.root();
known.lib("state").snap();
// @ts-expect-error A known data library has no document operations.
known.lib("state").document;
// @ts-expect-error A known document library has no projected data read.
known.lib("page").snap();

const dynamic = hsonLiveMap.create();
dynamic.lib.add({ page: { document: Hson.document`<main/>` }, state: { data: 0 } });
dynamic.commits.observe((commit) => {
  const admittedOrMutatedName: string | undefined = commit.operations[0]?.library;
  void admittedOrMutatedName;
});
const selected = dynamic.lib("page");
if (selected.mode === "document") selected.document.root();
else selected.snap();
// @ts-expect-error Kind-specific operations require narrowing on dynamic selection.
selected.document.root();
// @ts-expect-error The compressed form has no runtime kind evidence.
dynamic.lib.add({ compressed: Hson.document`<main/>` });
