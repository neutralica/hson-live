// @hson-live-external-test
import assert from "node:assert/strict";
import {
  hsonLiveMap,
  hsonLocus,
  render_hosted_document,
  type DocumentLiveMap,
} from "../src/index.ts";
import {
  install_locus_bootstrap,
  install_locus_snapshot,
} from "../src/api/locus/index.ts";
import { capture_locus_bootstrap } from "../src/api/locus/locus.bootstrap.ts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_node } from "../src/internal/exact-runtime-node-admission.ts";

function document_map(source: string): DocumentLiveMap {
  const map = admit_exact_runtime_livemap_node(parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true }));
  if (map.mode !== "document") throw new Error("Expected a document map.");
  return map;
}

const authority = document_map(`<main <p @000005101 "snapshot"/>/>`);
authority.document.attrs.set({ kind: "path", path: [0] }, "data-rev", "one");
const locus = hsonLocus.create({   map: authority, logicalMapId: "snapshot-install", sessions: {} });
assert.throws(() => render_hosted_document({ authority: locus } as never), /authorized Locus session/i);
const bootstrap = capture_locus_bootstrap(locus, "snapshot:install", "/socket");
const semantic = install_locus_snapshot({ logicalMapId: bootstrap.logicalMapId,
  incarnationId: bootstrap.incarnationId, rev: bootstrap.rev, mode: "document",
  format: bootstrap.state.format, payload: bootstrap.state.payload });
const transport = install_locus_bootstrap(bootstrap);

assert.equal(semantic.map.mode, "document");
assert.equal(semantic.map.rev, bootstrap.rev);
assert.deepEqual(semantic.map.capture({ identity: "strip" }), authority.capture({ identity: "strip" }));
assert.deepEqual(semantic.map.capture(), transport.map.capture());
assert.deepEqual(semantic.recovery, transport.recovery);
assert.deepEqual(semantic.recovery, {
  logicalMapId: bootstrap.logicalMapId,
  cursor: {
    incarnationId: bootstrap.incarnationId,
    lastAppliedRev: bootstrap.rev,
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
assert.equal(emptyBootstrap.state.format, "hson-client-snapshot-v1");
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
