import assert from "node:assert/strict";
import { hsonLiveMap, hsonTransform, encode_ssr_bootstrap, decode_ssr_bootstrap } from "../../src/index.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { set_livemap_quid_candidate_source_for_tests as allocation } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { locus_map_internal } from "../../src/internal/governor-maps.ts";
import { client_projection_map } from "../helpers/client-projection.mts";
import { admit_authority_projection_snapshot } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { DocumentSsrError } from "../../src/internal/document-cut.error.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { normalize_document_root } from "../../src/api/livemap/livemap.document.ts";
import { encode_hosted_root } from "../../src/api/livemap/livemap.hosted.ts";

async function hosted_subject_fixture(page: string, css?: string) {
  const locus = hsonLiveMap.locus.create({ "PRIVATE_PARTS_SENTINEL": { ...{ parts: {
      button: { kind: "document", document: '<button id="%{id}" "Styled"/>', css: 'button{color:rgb(12,34,56)}' },
      unused: { kind: "document", document: '<i "PRIVATE_UNUSED_SENTINEL"/>', css: 'i{color:rgb(98,76,54)}' },
    } }, access: "private" }, "page": { document: page, ...(css === undefined ? {} : { css }), access: "shared" }, "ungranted": { document: '<aside "UNGRANTED_DOCUMENT_SENTINEL"/>', access: "shared" } }, { authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
  try {
    const session = await locus.session.create({ libraries: ["page", "PRIVATE_PARTS_SENTINEL"] });
    return { locus, session };
  } catch (cause) {
    locus.dispose();
    throw cause;
  }
}

/** Actual scoped occurrences exercise hosted first paint without flattening. */
export function hosted_styled_part_fixture() {
  return hosted_subject_fixture('<html <head/> <body <hson-part @:a lib="PRIVATE_PARTS_SENTINEL" at="button" id="hosted-a"/> <hson-part @:b lib="PRIVATE_PARTS_SENTINEL" at="button" id="hosted-b"/> <button id="hosted-outside" "Outside"/>/>/>');
}

/** Authored flat subjects, not a conversion of scoped state. Keep public
 * snapshot/bootstrap/Echo and Chrome first-paint coverage on this supported path. */
export async function hosted_flat_subject_fixture(document = '<button @:a id="hosted-a" "Styled"/> <button @:b id="hosted-b" "Styled"/>') {
  const fixture = await hosted_subject_fixture(`<html <head/> <body ${document} <button id="hosted-outside" "Outside"/>/>/>`,
    '@scope ([hson\\:quad="a"]){:scope{color:rgb(12,34,56)}}@scope ([hson\\:quad="b"]){:scope{color:rgb(12,34,56)}}');
  try { return { ...fixture, cut: fixture.session.now({ html: "page" }) }; }
  catch (cause) { fixture.locus.dispose(); throw cause; }
}

export async function hosted_styled_part_ssr_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await check("styled Part occurrences deliver coherent scoped state and hosted HTML", async () => {
    const { locus, session } = await hosted_styled_part_fixture();
    try {
      const map = locus_map_internal(locus), aggregate = owner(map);
      const identity = aggregate.libraries()[aggregate.hostedRegistry().libraries.findIndex(entry => entry.name === "page")]!;
      const scopes = aggregate.documentScopes(identity);
      assert.ok(scopes); assert.equal(scopes.occurrences.length, 2);
      assert.notEqual(scopes.occurrences[0]!.lifetime, scopes.occurrences[1]!.lifetime);
      assert.deepEqual(scopes.occurrences.map(scope => scope.parent), [null, null]);
      const state = aggregate.scopedDocumentState(identity);
      assert.deepEqual(state.scopes.document, [
        { name: "a", kind: "part", path: [0,0,1,0,0] },
        { name: "b", kind: "part", path: [0,0,1,0,1] },
      ]);
      assert.deepEqual(state.scopes.occurrences.map(scope => scope.root), [[0,0,1,0,0], [0,0,1,0,1]]);
      const expected = normalize_document_root(hsonTransform.fromHson('<html <head/> <body <button id="hosted-a" "Styled"/> <button id="hosted-b" "Styled"/> <button id="hosted-outside" "Outside"/>/>/>').toNode());
      assert.deepEqual(state.root, expected);
      assert.doesNotMatch(JSON.stringify(state.root), /hson-part|%\{id\}|PRIVATE_UNUSED_SENTINEL/);
      for (const [index, name] of ["a", "b"].entries()) {
        const subject = aggregate.documentQuad(identity, name, undefined);
        assert.ok(subject); assert.equal(subject.quid, scopes.occurrences[index]!.rootQuid);
        assert.deepEqual(subject.path, state.scopes.occurrences[index]!.root);
      }
      const css = locus.doc.must("page").css.snapshot();
      assert.equal((css.match(/color:rgb\(12,34,56\)/g) ?? []).length, 2);
      for (const scope of scopes.occurrences) assert.ok(css.includes(`@scope ([hson\\:quid="${scope.rootQuid}"])`));
      const now = session.now(), page = now.libs.libraries[0]!;
      assert.equal("html" in now, false);
      assert.deepEqual(now.libs.libraries.map(entry => entry.name), ["page"]);
      assert.equal(now.libs.revision, locus.rev);
      assert.deepEqual(now.libs.authority, aggregate.hostedPosition().authority);
      assert.deepEqual(page.root, encode_hosted_root(state.root));
      assert.deepEqual(page.scopes, state.scopes);
      assert.deepEqual(page.css, state.css);
      assert.equal(page.quads, undefined);
      assert.ok(page.scopes);
      assert.deepEqual(page.scopes.subjects.map(subject => subject.path), state.scopes.occurrences.map(scope => scope.root));
      assert.deepEqual(page.css?.order.map(entry => entry.owner),
        page.scopes.subjects.map(subject => `[hson\\:quad="${subject.name}"]`));
      assert.doesNotMatch(JSON.stringify(now), /PRIVATE_PARTS_SENTINEL|PRIVATE_UNUSED_SENTINEL|UNGRANTED_DOCUMENT_SENTINEL/);
      const rendered = session.now({ html: "page" });
      assert.deepEqual(rendered.libs, now.libs);
      assert.match(rendered.html, /<button hson:quad=/);
      assert.doesNotMatch(rendered.html, /hson-part|hson:quid|PRIVATE_UNUSED_SENTINEL/);
      assert.throws(() => map.capture(), /Scoped document capture/);
      assert.throws(() => map.cut({ documents: ["page"], data: [], html: "page" }), /Scoped document/);
      assert.throws(() => aggregate.captureDocumentSsr(identity, []), /Scoped document SSR/);
      assert.equal(aggregate.documentScopes(identity), scopes);
      assert.deepEqual(aggregate.scopedDocumentState(identity), state);
    } finally { locus.dispose(); }
  });
  await check("repeated scoped hosted HTML captures publish nothing and preserve occurrence lifetimes", async () => {
    const { locus, session } = await hosted_styled_part_fixture();
    const map = locus_map_internal(locus), aggregate = owner(map), before = aggregate.inspect();
    const identity = aggregate.libraries()[aggregate.hostedRegistry().libraries.findIndex(entry => entry.name === "page")]!;
    const root = aggregate.root(identity), overlay = aggregate.documentOverlay(identity), ledger = aggregate.identityEpoch().issued();
    const scopes = aggregate.documentScopes(identity), css = aggregate.stylesheet(identity), position = aggregate.hostedPosition();
    let allocations = 0, commits = 0, observations = 0;
    const off = map.commits.observe(() => { commits++; });
    const stop = aggregate.observeAuthorityPosition(() => { observations++; }, "installed");
    allocation(aggregate.identityEpoch().owner, () => { allocations++; throw Error("Unexpected scoped capture allocation"); });
    try {
      const expected = session.now({ html: "page" });
      for (let repeat = 0; repeat < 3; repeat++) assert.deepEqual(session.now({ html: "page" }), expected);
      assert.equal(allocations, 0); assert.equal(commits, 0); assert.equal(observations, 0);
      assert.equal(aggregate.root(identity), root); assert.equal(aggregate.documentOverlay(identity), overlay);
      assert.equal(aggregate.identityEpoch().issued(), ledger); assert.equal(aggregate.documentScopes(identity), scopes);
      assert.equal(aggregate.stylesheet(identity), css); assert.deepEqual(aggregate.hostedPosition(), position);
      assert.deepEqual(aggregate.inspect(), before);
    } finally { allocation(aggregate.identityEpoch().owner, undefined); off(); stop(); locus.dispose(); }
  });
  await check("flat hosted subjects share captured CSS and exact markers through bootstrap and Echo reconstruction", async () => {
    const { locus, session, cut } = await hosted_flat_subject_fixture();
    try {
      const map = locus_map_internal(locus);
      const aggregate = owner(map), identity = aggregate.libraries()[aggregate.hostedRegistry().libraries.findIndex(entry => entry.name === "page")]!;
      assert.equal(aggregate.documentScopes(identity), undefined);
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
      assert.throws(() => client.data.must("PRIVATE_PARTS_SENTINEL"), /Unknown/);
      assert.throws(() => client.doc.must("ungranted"), /Unknown/);
      assert.equal(client.doc.must("page").mode, "document");
      const receiving = owner(client);
      assert.equal(receiving.documentScopes(receiving.libraries()[0]!), undefined);
      for (const quid of enumerate_livemap_issued_quids(owner(map).identityEpoch().issued())) {
        assert.equal(receiving.identityEpoch().issued().has(quid), false);
      }
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
    const { locus, session, cut } = await hosted_flat_subject_fixture();
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
    const { locus, cut } = await hosted_flat_subject_fixture();
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
      ['<button @:a HSON:QUAD="forged"/> <button @:b/>', /reserved portable document subject carrier/],
      ['<noscript @:a/> <button @:b/>', /parsing depends on the native scripting flag/],
    ] as const) {
      await assert.rejects(() => hosted_flat_subject_fixture(document), error => {
        assert.ok(error instanceof DocumentSsrError); assert.equal(error.phase, "realize");
        assert.ok(error.cause instanceof Error); assert.match(error.cause.message, reason);
        return true;
      });
    }
  });
  await check("ordinary hosted unscoped CSS leaves authored QUAD rendering unchanged", async () => {
    const locus = hsonLiveMap.locus.create({ "page": { document: '<html <head/> <body <button @:ordinary "Ordinary"/>/>/>', css: 'button{color:red}', access: "shared" } }, { authorizeProjection: () => ({ libraries: ["page"] }) });
    try {
      const session = await locus.session.create({ libraries: ["page"] }), cut = session.now({ html: "page" });
      assert.doesNotMatch(cut.html, /hson:quad/); assert.match(cut.html, /button\{color:red;\}/);
      assert.equal(cut.html, locus_map_internal(locus).cut({ html: "page" }).html);
    } finally { locus.dispose(); }
  });
}
