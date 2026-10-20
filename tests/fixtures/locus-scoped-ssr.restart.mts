import assert from "node:assert/strict";
import { hsonLiveMap } from "hson-live/livemap";
import { FileCheckpointAdapter } from "../helpers/file-checkpoint-adapter.mts";
import { definition, assert_cut } from "./locus-scoped-ssr-cases.mts";
const [file, revision] = process.argv.slice(2);
assert.ok(file && revision);
const locus = await hsonLiveMap.locus.resume({ ...definition, logicalMapId: "h2-restart", persistence: new FileCheckpointAdapter(file) });
try {
  const session = await locus.session.create({ libraries: ["page", "flat", "later", "bare"] });
  assert.equal(locus.rev, Number(revision));
  const page = session.now({ html: "page" }); assert_cut(JSON.parse(JSON.stringify(page)), 3);
  assert.match(page.html, /title="tail"/); assert.match(page.html, /color:purple/);
  assert_cut(JSON.parse(JSON.stringify(session.now({ html: "later" }))), 5);
  assert_cut(JSON.parse(JSON.stringify(session.now({ html: "bare" }))), 0);
  const flat = session.now({ html: "flat" }); assert_cut(JSON.parse(JSON.stringify(flat))); assert.match(flat.html, /title="checkpoint"/);
  assert.equal(flat.libs.libraries.find(e => e.name === "flat")!.scopes, undefined);
  await locus.stage(w => { w.doc.must("page").at([]).asElement().attrs.set("title", "restart"); });
  assert.match(session.now({ html: "page" }).html, /title="restart"/);
  console.log("h2-restart-ok");
} finally { locus.dispose(); }
