import assert from "node:assert/strict";
import { hsonLiveMap, encode_ssr_bootstrap, decode_ssr_bootstrap } from "../../src/index.ts";
import { part_collection_definition_internal as collection } from "../../src/api/livemap/livemap.parts.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { set_livemap_quid_candidate_source_for_tests as allocation } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { locus_map_internal } from "../../src/internal/governor-maps.ts";
import { client_projection_map } from "../helpers/client-projection.mts";
import { admit_authority_projection_snapshot } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { DocumentSsrError } from "../../src/internal/document-cut.error.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";

/** Public hosted construction and retained-session cut, shared by Node/Worker/Chrome. */
export async function hosted_styled_part_fixture(document = '<button id="%{id}" "Styled"/>') {
  const locus = hsonLiveMap.locus.create({
    private: [{ name: "PRIVATE_PARTS_SENTINEL", definition: collection({
      button: { kind: "document", document, css: 'button{color:rgb(12,34,56)}' },
      unused: { kind: "document", document: '<i "PRIVATE_UNUSED_SENTINEL"/>', css: 'i{color:rgb(98,76,54)}' },
    }) }],
    shared: [
      { name: "page", definition: { document: '<html <head/> <body <hson-part @:a lib="PRIVATE_PARTS_SENTINEL" at="button" id="hosted-a"/> <hson-part @:b lib="PRIVATE_PARTS_SENTINEL" at="button" id="hosted-b"/> <button id="hosted-outside" "Outside"/>/>/>' } },
      { name: "ungranted", definition: { document: '<aside "UNGRANTED_DOCUMENT_SENTINEL"/>' } },
    ],
    authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
  });
  try {
    const session = await locus.session.create({ libraries: ["page", "PRIVATE_PARTS_SENTINEL"] });
    return { locus, session, cut: session.now({ html: "page" }) };
  } catch (cause) {
    locus.dispose();
    throw cause;
  }
}

export async function hosted_styled_part_ssr_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await check("hosted private styled Parts share captured CSS and exact receiving subject markers with local cuts", async () => {
    const { locus, session, cut } = await hosted_styled_part_fixture();
    try {
      const map = locus_map_internal(locus);
      const local = map.cut({ data: [], documents: ["page"], html: "page" });
      const page = cut.libs.libraries[0]!;
      assert.deepEqual(cut.libs.libraries.map(entry => entry.name), ["page"]);
      assert.deepEqual(page.quads, [{ name: "a", path: [0,0,1,0,0] }, { name: "b", path: [0,0,1,0,1] }]);
      assert.deepEqual(page.root, local.libs.libraries[0]!.root);
      assert.deepEqual(page.css, local.libs.libraries[0]!.css);
      assert.deepEqual(page.quads, local.libs.libraries[0]!.quads);
      assert.equal(cut.html, local.html);
      for (const name of ["a", "b"]) {
        assert.ok(cut.html.includes(`@scope ([hson\\:quad="${name}"])`));
        assert.ok(cut.html.includes(`<button hson:quad="${name}" id="hosted-${name}">`));
      }
      assert.match(cut.html, /<button id="hosted-outside">Outside<\/button>/);
      assert.equal((cut.html.match(/ hson:quad=/g) ?? []).length, 2);
      const encoded = encode_ssr_bootstrap(cut), decoded = decode_ssr_bootstrap(encoded);
      assert.equal(decoded.kind, "hosted-projection");
      if (decoded.kind !== "hosted-projection") throw Error("Expected hosted projection.");
      assert.deepEqual(decoded.bootstrap.libs, cut.libs);
      const client = client_projection_map({ authority: decoded.bootstrap.libs, local: {} });
      assert.throws(() => client.lib("PRIVATE_PARTS_SENTINEL"), /Unknown/);
      assert.throws(() => client.lib("ungranted"), /Unknown/);
      assert.equal(client.lib("page").mode, "document");
      const recovered = client.cut({ html: "page" });
      assert.equal(recovered.html, cut.html, "Source-free portable installation retains first-paint correspondence.");
      const transport = JSON.stringify(decoded.bootstrap);
      for (const artifact of [cut.html, JSON.stringify(cut), transport]) {
        for (const hidden of ["PRIVATE_PARTS_SENTINEL", "PRIVATE_UNUSED_SENTINEL", "UNGRANTED_DOCUMENT_SENTINEL",
          "hson-part", "%{id}", "hson:quid", "hson\\:quid", "identityEpoch", "issuedQuids"]) {
          assert.equal(artifact.includes(hidden), false, hidden);
        }
        for (const quid of enumerate_livemap_issued_quids(owner(map).identityEpoch().issued())) {
          assert.equal(artifact.includes(quid), false, quid);
        }
      }
      assert.equal(session.now({ html: "page" }).html, recovered.html);
    } finally { locus.dispose(); }
  });
  await check("repeated hosted cuts observe one captured revision without allocating identity or mutating ownership", async () => {
    const { locus, session, cut } = await hosted_styled_part_fixture();
    const map = locus_map_internal(locus), aggregate = owner(map), before = map.capture();
    const identity = aggregate.libraries()[aggregate.hostedRegistry().libraries.findIndex(entry => entry.name === "page")]!;
    const root = aggregate.root(identity), overlay = aggregate.documentOverlay(identity), ledger = aggregate.identityEpoch().issued();
    let allocations = 0, commits = 0;
    const off = map.commits.observe(() => { commits++; });
    allocation(aggregate.identityEpoch().owner, () => { allocations++; throw Error("Unexpected hosted render allocation"); });
    try {
      for (let repeat = 0; repeat < 3; repeat++) assert.deepEqual(session.now({ html: "page" }), cut);
      assert.equal(allocations, 0); assert.equal(commits, 0);
      assert.equal(aggregate.root(identity), root); assert.equal(aggregate.documentOverlay(identity), overlay);
      assert.equal(aggregate.identityEpoch().issued(), ledger); assert.deepEqual(map.capture(), before);
    } finally { allocation(aggregate.identityEpoch().owner, undefined); off(); locus.dispose(); }
  });
  await check("invalid portable correspondence rejects at existing admission before hosted rendering", async () => {
    const { locus, cut } = await hosted_styled_part_fixture();
    try {
      const page = cut.libs.libraries[0]!, quads = page.quads!;
      for (const invalid of [undefined, [], quads.slice(0, 1),
        [{ ...quads[0]!, path: [0,0,1,0,99] }, quads[1]!],
        [quads[0]!, { ...quads[1]!, path: quads[0]!.path }],
        [quads[0]!, { ...quads[1]!, name: "foreign" }]]) {
        const { quads: _quads, ...withoutQuads } = page;
        const candidate = { ...cut.libs, libraries: [{ ...withoutQuads, ...(invalid === undefined ? {} : { quads: invalid }) }] };
        assert.throws(() => admit_authority_projection_snapshot(candidate), /malformed/);
      }
    } finally { locus.dispose(); }
  });
  await check("hosted subject planning rejects authored marker collisions and retains parser closure", async () => {
    for (const [document, reason] of [
      ['<button HSON:QUAD="forged" id="%{id}"/>', /reserved portable document subject carrier/],
      ['<noscript id="%{id}"/>', /parsing depends on the native scripting flag/],
    ] as const) {
      await assert.rejects(() => hosted_styled_part_fixture(document), error => {
        assert.ok(error instanceof DocumentSsrError); assert.equal(error.phase, "realize");
        assert.ok(error.cause instanceof Error); assert.match(error.cause.message, reason);
        return true;
      });
    }
  });
  await check("ordinary hosted unscoped CSS leaves authored QUAD rendering unchanged", async () => {
    const locus = hsonLiveMap.locus.create({ shared: [{ name: "page", definition: {
      document: '<html <head/> <body <button @:ordinary "Ordinary"/>/>/>' },
      css: 'button{color:red}' }],
      authorizeProjection: () => ({ libraries: ["page"] }) });
    try {
      const session = await locus.session.create({ libraries: ["page"] }), cut = session.now({ html: "page" });
      assert.doesNotMatch(cut.html, /hson:quad/); assert.match(cut.html, /button\{color:red;\}/);
      assert.equal(cut.html, locus_map_internal(locus).cut({ html: "page" }).html);
    } finally { locus.dispose(); }
  });
}
