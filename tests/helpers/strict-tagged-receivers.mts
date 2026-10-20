import assert from "node:assert/strict";
import { Hson, hsonLiveMap, encode_ssr_bootstrap, decode_ssr_bootstrap, SsrBootstrapCodecError } from "../../src/index.ts";
import { ViewStateSnapshotCodecError } from "../../src/api/livemap/livemap.document.view-state-codec.error.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { make_portable_aggregate_snapshot, make_portable_aggregate_commit } from "../../src/api/livemap/livemap.hosted.ts";
import { make_livemap_mirror_from_portable_aggregate_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { resolve_locus_document_action } from "../../src/api/locus/locus.document-actions.ts";
import { livemap_identity_epoch_accounting } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { acquire_document_identity } from "./livemap-identity-internal.mts";
import { canonical_hson_graph_equal } from "../../src/core/canonical-hson-equal.ts";
import { corrupt_tagged_payload, exact_tagged_payload, invalid_tagged_graphs, tagged_node } from "./tagged-codec-fixture.mts";

/** The same malformed inner-payload controls execute in Node and actual Workers. */
export function strict_tagged_receiver_controls(): Readonly<{ snapshotRejections: number; actionRejections: number; replayRejections: number }> {
  const Page = Hson.schema`<type "document">`;
  const source = hsonLiveMap.fromLibraries({ state: { data: { items: ["a", "b"] } }, page: { document: "<main/>", schema: Page } });
  const target = hsonLiveMap.fromLibraries({ state: { data: { items: ["old", "state"] } }, page: { document: "<main/>", schema: Page } });
  const page = target.doc.must("page");
  if (page.mode !== "document") throw new Error("Expected page.");
  const subject = acquire_document_identity(page.document, { kind: "path", path: [0] });
  const engine = internal_livemap_aggregate_authority(target);
  const snapshot = source.capture();
  const portable = make_portable_aggregate_snapshot(internal_livemap_aggregate_authority(source).captureHosted());
  const before = target.capture();
  const ownedBefore = engine.captureHosted();
  const accounting = livemap_identity_epoch_accounting(page);
  const identities = engine.libraries();
  const graph = page.root();
  let published = 0;
  const stop = target.commits.observe(() => { published += 1; });
  const unchanged = () => {
    assert.deepEqual(target.capture(), before);
    assert.deepEqual(engine.captureHosted(), ownedBefore);
    assert.deepEqual(engine.libraries(), identities);
    assert.equal(target.doc.must("page"), page);
    assert.equal(subject.active, true);
    assert.deepEqual(livemap_identity_epoch_accounting(page), accounting);
    assert.equal(canonical_hson_graph_equal(page.root(), graph), true);
    assert.equal(published, 0);
  };
  let snapshotRejections = 0;
  for (const name of ["state", "page"]) {
    for (const kind of ["empty metadata", "nested empty metadata", ...(name === "state" ? ["permuted array" as const] : [])] as const) {
      const invalid = { ...snapshot, libraries: snapshot.libraries.map(entry => entry.name === name
        ? { ...entry, root: { ...entry.root, payload: corrupt_tagged_payload(entry.root.payload, kind) } } : entry) };
      assert.throws(() => target.restore(invalid));
      assert.throws(() => install_libraries_snapshot(invalid));
      assert.throws(() => encode_ssr_bootstrap(invalid));
      // Independent outer-wire construction; no encoder gets to repair the inner graph.
      const wire = JSON.parse(Buffer.from(encode_ssr_bootstrap(snapshot), "base64url").toString("utf8"));
      assert.deepEqual(decode_ssr_bootstrap(Buffer.from(JSON.stringify(wire)).toString("base64url")),
        { kind: "libraries", bootstrap: snapshot });
      const originalWire = structuredClone(wire);
      const entry = wire.payload.libraries.find((library: { name: string }) => library.name === name);
      assert.ok(entry);
      const originalPayload = entry.rootPayload;
      entry.rootPayload = corrupt_tagged_payload(originalPayload, kind);
      assert.notEqual(entry.rootPayload, originalPayload);
      const invalidPayload = entry.rootPayload;
      entry.rootPayload = originalPayload;
      assert.deepEqual(wire, originalWire); // Only the targeted rootPayload changes.
      entry.rootPayload = invalidPayload;
      assert.throws(() => decode_ssr_bootstrap(Buffer.from(JSON.stringify(wire)).toString("base64url")), cause => {
        if (!(cause instanceof SsrBootstrapCodecError) || cause.phase !== "decode"
          || cause.code !== "SSR_BOOTSTRAP_PAYLOAD_INVALID"
          || !(cause.cause instanceof ViewStateSnapshotCodecError)
          || cause.cause.code !== "VIEW_STATE_SNAPSHOT_GRAPH_INVALID") return false;
        return kind === "permuted array" || (cause.cause.cause instanceof Error
          && "code" in cause.cause.cause && cause.cause.cause.code === "HSON_EMPTY_METADATA");
      });
      const badPortable = { ...portable, libraries: portable.libraries.map(entry => entry.name === name
        ? { ...entry, root: { ...entry.root, payload: corrupt_tagged_payload(entry.root.payload, kind) } } : entry) };
      assert.throws(() => make_livemap_mirror_from_portable_aggregate_internal(badPortable));
      // Portable input cannot manufacture private hosted restore authority.
      assert.throws(() => engine.restoreHosted({ ...ownedBefore, libraries: ownedBefore.libraries.map(entry => entry.name === name
        ? { ...entry, root: { ...entry.root, payload: corrupt_tagged_payload(entry.root.payload, kind) } } : entry) }));
      unchanged();
      snapshotRejections += 1;
    }
  }
  let actionRejections = 0;
  for (const invalid of invalid_tagged_graphs) {
    const content = { format: "hson-graph-portable", payload: exact_tagged_payload(invalid.value) };
    for (const action of ["insert", "replace"] as const) {
      const resolution = resolve_locus_document_action(page, `document.content.${action}`, {
        target: { kind: "path", path: [] }, index: 0, [action === "insert" ? "content" : "replacement"]: content,
      });
      assert.equal(resolution.kind, "invalid", `${action}: ${invalid.name}`);
      unchanged();
      actionRejections += 1;
    }
  }
  stop();
  target.restore(snapshot);
  assert.equal(canonical_hson_graph_equal(target.data.must("state").root(), source.data.must("state").root()), true);
  subject.dispose();
  const validContent = { format: "hson-graph-portable", payload: exact_tagged_payload(tagged_node("span")) };
  for (const action of ["insert", "replace"] as const) {
    const ready = resolve_locus_document_action(page, `document.content.${action}`, {
      target: { kind: "path", path: [] }, index: 1, [action === "insert" ? "content" : "replacement"]: validContent,
    });
    assert.equal(ready.kind, "ready");
    if (ready.kind !== "ready") throw new Error("Expected valid document action.");
    ready.execute();
  }
  assert.equal(canonical_hson_graph_equal(page.root(), { $_tag: "_hson_root", $_content: [
    { $_tag: "main", $_content: [] }, { $_tag: "span", $_content: [] },
  ] }), true);

  const author = hsonLiveMap.fromLibraries({ page: { document: "<main/>", schema: Page } });
  const authority = internal_livemap_aggregate_authority(author);
  const client = make_livemap_mirror_from_portable_aggregate_internal(make_portable_aggregate_snapshot(authority.captureHosted()));
  const clientEngine = internal_livemap_aggregate_authority(client);
  let hosted: Parameters<typeof make_portable_aggregate_commit>[0] | undefined;
  const unsubscribe = authority.observe(commit => { hosted = commit.hosted; });
  const authorPage = author.doc.must("page");
  if (authorPage.mode !== "document") throw new Error("Expected author page.");
  authorPage.document.content.insert({ kind: "path", path: [] }, 1, { $_tag: "span", $_content: [] });
  unsubscribe();
  if (!hosted) throw new Error("Expected hosted commit.");
  const validCommit = make_portable_aggregate_commit(hosted);
  if (!validCommit) throw new Error("Expected portable graph commit.");
  const clientBefore = client.capture();
  let replayRejections = 0;
  for (const invalid of invalid_tagged_graphs) {
    const commit = { ...validCommit, operations: validCommit.operations.map(operation => {
      const representation = JSON.parse(operation.payload);
      representation.content = exact_tagged_payload(invalid.value);
      return { ...operation, payload: JSON.stringify(representation) };
    }) };
    assert.throws(() => clientEngine.replayClientHosted(commit));
    assert.deepEqual(client.capture(), clientBefore);
    replayRejections += 1;
  }
  clientEngine.replayClientHosted(validCommit);
  assert.equal(canonical_hson_graph_equal(client.doc.must("page").root(), authorPage.root()), true);
  return Object.freeze({ snapshotRejections, actionRejections, replayRejections });
}
