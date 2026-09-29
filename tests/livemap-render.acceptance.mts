import assert from "node:assert/strict";
import { hsonLiveMap } from "../src/index.ts";

const map = hsonLiveMap.fromLibraries({
  page: { document: "<main/>" },
  second: { document: "<aside/>" },
  state: { data: { value: 1 } },
});
assert.equal(map.lib("page").render(), "<main></main>");
assert.equal(map.lib("second").render(), "<aside></aside>");
assert.equal(map.lib("page").render(), map.cut({ html: "page" }).html);
assert.equal("render" in map.lib("state"), false);
assert.equal(map.rev, 0);
process.stdout.write("Document library rendering acceptance passed.\n");
