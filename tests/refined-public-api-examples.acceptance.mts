import assert from "node:assert/strict";
import { Hson } from "hson-live/hson";
import { hsonLiveMap } from "hson-live/livemap";
import { hsonTransform } from "hson-live/transform";
import { reflect_document } from "hson-live/mirror";

const canonical = hsonTransform.fromTrustedHtml("<main><p>Ready</p></main>").toHson().serialize();
assert.match(hsonTransform.fromHson(canonical).toHtml().serialize(), /<main>/);

const map = hsonLiveMap.fromLibraries({ state: { json: { count: 0 }, schema: Hson.schema`<type "data" content <count "number">>` } });
const state = map.data.must("state");
state.at(["count"]).set(1);
assert.equal(state.snap(["count"]), 1);
const data = state.at(["count"]).hson();
assert.equal(typeof data, "string");
assert.equal(data === undefined ? undefined : Hson.data.fromSource((data)).materialize(), 1);

const documents = hsonLiveMap.fromLibraries({ page: { document: '<main "Ready"/>' } });
const page = documents.doc.must("page");
const binding = reflect_document(page);
assert.equal(binding.status, "active");
const html = binding.tree.find.must({ tag: "html" });
page.at([]).asElement()?.attrs.set("title", "canonical");
assert.equal(html.attrs.get("title"), "canonical");
assert.equal(binding.sourceRevision, page.rev);
html.attrs.set("title", "delegated");
assert.equal(page.at([]).asElement()?.attrs.get("title"), "delegated");
assert.equal(binding.sourceRevision, page.rev);
binding.dispose();
assert.equal(binding.status, "disposed");
