// @hson-live-external-test
import assert from "node:assert/strict";
import {
  hsonLiveMap,
  hsonLocus,
  render_hosted_document,
  type DocumentLiveMap,
} from "../src/index.ts";
import {
  capture_locus_bootstrap,
  install_locus_bootstrap,
  install_locus_snapshot,
} from "../src/api/locus/index.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";

function document_map(source: string): DocumentLiveMap {
  const map = hsonLiveMap.fromNode(parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true }));
  if (map.mode !== "document") throw new Error("Expected a document map.");
  return map;
}

const authority = document_map(`<main <p @000005101 "snapshot"/>/>`);
authority.document.attrs.set({ kind: "path", path: [0] }, "data-rev", "one");
const locus = hsonLocus.create({ map: authority, logicalMapId: "snapshot-install", sessions: {} });
const ssr = render_hosted_document({ authority: locus });
const semantic = install_locus_snapshot(ssr.bootstrap);
const transport = install_locus_bootstrap(capture_locus_bootstrap(locus, "snapshot:install", "/socket"));

assert.equal(semantic.map.mode, "document");
assert.equal(semantic.map.rev, ssr.bootstrap.rev);
assert.deepEqual(semantic.map.capture(), authority.capture());
assert.deepEqual(semantic.map.capture(), transport.map.capture());
assert.deepEqual(semantic.recovery, transport.recovery);
assert.deepEqual(semantic.recovery, {
  logicalMapId: ssr.bootstrap.logicalMapId,
  cursor: {
    incarnationId: ssr.bootstrap.incarnationId,
    lastAppliedRev: ssr.bootstrap.rev,
  },
});
assert.deepEqual(Object.keys(semantic).sort(), ["map", "recovery"]);
assert.equal("bootstrap" in semantic, false);
assert.equal("socket" in semantic, false);
assert.equal("session" in semantic, false);
assert.equal("selector" in semantic, false);
assert.equal("endpoint" in semantic, false);

locus.dispose();

const emptyAuthority = document_map("");
const emptyLocus = hsonLocus.create({
  map: emptyAuthority,
  logicalMapId: "snapshot-install-empty",
  sessions: {},
});
const emptyBootstrap = capture_locus_bootstrap(
  emptyLocus,
  "snapshot:install:empty",
  "/empty-socket",
);
assert.equal(emptyBootstrap.state.payload, "");
const installedEmpty = install_locus_bootstrap(emptyBootstrap);
assert.equal(installedEmpty.map.mode, "document");
assert.equal(installedEmpty.map.rev, emptyAuthority.rev);
assert.deepEqual(installedEmpty.map.root(), { $_tag: "_hson_root", $_content: [] });
assert.deepEqual(installedEmpty.recovery, {
  logicalMapId: "snapshot-install-empty",
  cursor: {
    incarnationId: emptyBootstrap.incarnationId,
    lastAppliedRev: emptyAuthority.rev,
  },
});
emptyLocus.dispose();
process.stdout.write("Locus semantic snapshot installation acceptance passed.\n");
