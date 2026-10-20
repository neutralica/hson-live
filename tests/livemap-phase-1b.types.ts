import { Hson, hsonLiveMap } from "../src/index.js";

const known = hsonLiveMap.fromLibraries({
  page: { document: Hson.document`<main/>` },
  state: { data: { count: 0 } },
});
known.doc.must("page").document.root();
known.data.must("state").snap();
// @ts-expect-error A known data library has no document operations.
known.data.must("state").document;
known.doc.must("page").snap();

const dynamic = hsonLiveMap.create();
dynamic.addLibraries({ page: { document: Hson.document`<main/>` }, state: { data: 0 } });
dynamic.commits.observe((commit) => {
  const admittedOrMutatedName: string | undefined = commit.operations[0]?.library;
  void admittedOrMutatedName;
});
const selected = dynamic.doc.must("page");
selected.document.root();
selected.snap();
// @ts-expect-error The compressed form has no runtime kind evidence.
dynamic.addLibraries({ compressed: Hson.document`<main/>` });
