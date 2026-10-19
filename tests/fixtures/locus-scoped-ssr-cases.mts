import assert from "node:assert/strict";
import { hsonLiveMap } from "../../src/api/livemap/index.ts";
import { hsonTransform } from "../../src/api/transform/index.ts";
import { encode_ssr_bootstrap, decode_ssr_bootstrap } from "../../src/api/ssr/index.ts";
import { hsonLiveHost } from "../../src/api/livehost/index.ts";
import type { LocusSessionHtmlNow, LocusProjectionAuthorizer } from "../../src/api/locus/index.ts";
import { deferred, MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import { locus_map_internal } from "../../src/internal/governor-maps.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { set_livemap_quid_candidate_source_for_tests } from "../../src/api/livemap/livemap.quid-allocation.ts";

export const page = { document: '<html @:page <head/> <body <hson-part @:left lib="parts" at="panel" id="left"/> <hson-part @:right lib="parts" at="panel" id="right"/> <hson-part lib="parts" at="global"/> <p @:outside id="outside" "Outside"/>/>/>' };
const authorizeProjection: LocusProjectionAuthorizer = ({ requested, connection }) => ({
  libraries: connection?.principalId === "denied" ? ["data"] : requested.libraries,
});
export const definition = {
  private: [{ name: "parts", definition: { parts: {
    panel: { kind: "document", document: '<section @:root id="%{id}" <hson-part @:child at="leaf"/>/>', css: ':scope{border:3px solid black}' },
    leaf: { kind: "document", document: '<button @:root <span @:label "Visible"/>/>',
      css: ':scope{--tone:rgb(10,20,30);padding:7px}[hson\\:quad="label"]{color:var(--tone)}' },
    global: { kind: "document", document: '<aside "Bare"/>', css: '@keyframes pulse{from{opacity:0}to{opacity:1}}@property --tone{syntax:"<color>";inherits:true;initial-value:red}' },
    bare: { kind: "document", document: '<aside "Bare"/>' },
    unused: { kind: "document", document: '<i "PRIVATE_TEMPLATE"/>', css: 'i{--private:PRIVATE_CSS}' },
  } } }, { name: "secret", definition: { document: '<html <head/> <body "PRIVATE_DOCUMENT"/>/>' }, css: 'body{--private:PRIVATE_LIBRARY_CSS}' }],
  shared: [{ name: "page", definition: page, css: 'p{color:red}p{CoLoR:rgb(40,50,60)}#left{--own:11px}#right{--own:13px}section{margin-left:var(--own)}' },
    { name: "flat", definition: { document: '<html <head/> <body <p "Flat"/>/>/>' }, css: 'p{color:navy}' },
    { name: "bare", definition: { document: '<main <hson-part lib="parts" at="bare"/>/>' } },
    { name: "data", definition: { data: { n: 0 } } }], authorizeProjection,
} as const;
export function node(source: string) {
  const value = hsonTransform.fromHson(source).toNode().$_content[0];
  if (typeof value !== "object" || value === null) throw Error("Expected element");
  return value;
}
export function assert_cut(cut: LocusSessionHtmlNow, occurrences?: number) {
  const library = cut.libs.libraries.find(entry => entry.name === cut.document)!;
  assert.ok(library);
  if (occurrences !== undefined) assert.equal(library.scopes!.occurrences.length, occurrences);
  const raw = JSON.stringify(cut);
  assert.doesNotMatch(raw, /PRIVATE_|"name":"parts"|"name":"secret"|hson-part|%\{id\}|hson:quid|hson\\\\:quid|identityEpoch|issuedQuids/);
  assert.doesNotMatch(cut.html, /<script/);
  assert.doesNotMatch(library.root.payload, /hson:quad|data-hson-managed/);
  for (const subject of library.scopes?.subjects ?? []) {
    assert.ok(cut.html.includes(`hson:quad="${subject.name}"`));
    assert.equal(cut.html.split(`hson:quad="${subject.name}"`).length, 2);
  }
  const decoded = decode_ssr_bootstrap(encode_ssr_bootstrap(cut));
  assert.equal(decoded.kind, "hosted-projection");
  if (decoded.kind !== "hosted-projection") throw Error("Expected session state");
  assert.deepEqual(decoded.bootstrap.libs, cut.libs);
}
export async function fixture() {
  const locus = hsonLiveMap.locus.create(definition);
  const session = await locus.session.create({ libraries: ["page", "flat", "bare", "data", "parts", "secret"] });
  return { locus, session };
}

export async function scoped_ssr_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await check("Library rendering is observational before any hosted session exists", async () => {
    const locus = hsonLiveMap.locus.create(definition);
    const map = locus_map_internal(locus), aggregate = internal_livemap_aggregate_authority(map);
    const pageOwner = aggregate.inspect().libraries.find(entry => entry.mode === "document" && aggregate.documentQuad(entry.identity, "outside", undefined))!.identity;
    const subject = aggregate.documentQuad(pageOwner, "outside", undefined)!;
    await locus.stage(w => { w.lib("page").css.sel(`[hson\\:quid="${subject.quid}"]`).setProp("background-color", "orange"); });
    let publications = 0, allocations = 0;
    const stops = [map.commits.observe(() => publications++), aggregate.observe(() => publications++),
      aggregate.observeAuthorityPosition(() => publications++), locus.lib("page").commits.observe(() => publications++)];
    const checkpoint = aggregate.captureSemanticCheckpoint(), ledger = aggregate.identityEpoch().issued();
    const epoch = aggregate.identityEpoch().current(), revision = locus.rev;
    const installed = aggregate.inspect().libraries.filter(entry => entry.mode === "document").map(({ identity: id }) => ({ id, root: aggregate.root(id),
      overlay: aggregate.documentOverlay(id), css: aggregate.stylesheet(id), scopes: aggregate.documentScopes(id) }));
    set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, () => { allocations++; throw Error("render allocated identity"); });
    try {
      for (let repeat = 0; repeat < 3; repeat++) for (const name of ["page", "flat", "bare"] as const) locus.lib(name).render();
      assert.match(locus.lib("page").render(), /background-color:orange/);
      assert.deepEqual(aggregate.captureSemanticCheckpoint(), checkpoint);
      assert.equal(aggregate.identityEpoch().issued(), ledger); assert.equal(aggregate.identityEpoch().current(), epoch);
      assert.equal(locus.rev, revision); assert.equal(publications, 0); assert.equal(allocations, 0);
      for (const state of installed) {
        assert.equal(aggregate.root(state.id), state.root); assert.equal(aggregate.documentOverlay(state.id), state.overlay);
        assert.equal(aggregate.stylesheet(state.id), state.css); assert.equal(aggregate.documentScopes(state.id), state.scopes);
      }
    } finally {
      set_livemap_quid_candidate_source_for_tests(aggregate.identityEpoch().owner, undefined);
      stops.forEach(stop => stop()); locus.dispose();
    }
  });
  await check("public scoped SSR, recursive repeated Parts, native CSS and transferable state", async () => {
    const { locus, session } = await fixture();
    try {
      const before = session.now(), cut = session.now({ html: "page" });
      assert_cut(cut, 5); assert.deepEqual(cut.libs, before.libs); assert.equal(locus.rev, before.libs.revision);
      assert.match(cut.html, /<section[^>]*id="left"><button[^>]*><span/);
      assert.match(cut.html, /<aside[^>]*>Bare<\/aside>/);
      assert.match(cut.html, /@keyframes pulse/); assert.match(cut.html, /@property --tone/);
      assert.ok(cut.html.indexOf('p{color:red;}') < cut.html.indexOf('p{color:rgb(40,50,60);}'));
      const flat = session.now({ html: "flat" }); assert_cut(flat);
      assert.equal(flat.libs.libraries.find(e => e.name === "flat")!.scopes, undefined);
      assert.equal(flat.html, locus.lib("flat").render());
      const bare = session.now({ html: "bare" }); assert_cut(bare, 1);
      assert.equal(bare.html, '<main><aside>Bare</aside></main>');
      for (const target of ["secret", "parts", "data", "missing"]) assert.throws(() => session.now({ html: target }), /unavailable/);
      const denied = await locus.session.create({ libraries: ["page", "data"] }, { connection: { principalId: "denied" } });
      assert.throws(() => denied.now({ html: "page" }), /unavailable/);
      assert.deepEqual(denied.now().libs.libraries.map(e => e.name), ["data"]);
      await session.update({ libraries: ["flat"] });
      assert.throws(() => session.now({ html: "page" }), /unavailable/);
      assert.deepEqual(session.now({ html: "flat" }).libs.libraries.map(e => e.name), ["flat"]);
      assert_cut(cut, 5); // Earlier accepted cuts remain detached values.
      session.revoke(); assert.throws(() => session.now({ html: "flat" }), /unavailable/);
    } finally { locus.dispose(); }
  });
  await check("mixed flat/scoped cuts preserve both operation orders, CSS-only changes, retirement and scoped-empty", async () => {
    const { locus, session } = await fixture();
    try {
      const left = locus.lib("page").q("left")!;
      for (const reverse of [false, true]) for (const cssOnly of [false, true]) {
        const title = `${reverse}-${cssOnly}`, revision = locus.rev;
        await locus.stage(w => {
          const scoped = () => { w.lib("page").css.sel("body").setProp("color", cssOnly ? "orange" : reverse ? "blue" : "red");
            if (!cssOnly) w.lib("page").at([]).asElement().attrs.set("title", title); };
          const flat = () => { w.lib("flat").css.sel("body").setProp("color", cssOnly ? "pink" : reverse ? "teal" : "green");
            if (!cssOnly) w.lib("flat").at([]).asElement().attrs.set("title", title); };
          if (reverse) { flat(); scoped(); } else { scoped(); flat(); }
        });
        assert.equal(locus.rev, revision + 1);
        const cut = session.now({ html: "page" }); assert_cut(cut, 5);
        assert.equal(cut.libs.revision, locus.rev);
        assert.equal(cut.libs.libraries.find(e => e.name === "flat")!.scopes, undefined);
        assert.match(session.now({ html: "flat" }).html, cssOnly ? /color:pink/ : reverse ? /color:teal/ : /color:green/);
      }
      const before = session.now({ html: "page" });
      await assert.rejects(locus.stage(w => { w.lib("page").css.clearAll(); w.lib("flat").at([99]).asElement().attrs.set("bad", true); }));
      assert.deepEqual(session.now({ html: "page" }), before);
      await locus.stage(w => {
        w.lib("page").at([1, 0]).replace(node('<hson-part lib="parts" at="bare"/>'));
        w.lib("page").at([1, 0]).asElement().attrs.set("title", "candidate-relative");
        w.lib("flat").css.sel("p").setProp("color", "purple");
      });
      assert.equal(left.active, false);
      const replaced = session.now({ html: "page" }); assert_cut(replaced, 4);
      assert.match(replaced.html, /title="candidate-relative">Bare/);
      const retired = before.libs.libraries.find(e => e.name === "page")!.scopes!.subjects.filter(s => s.path[4] === 0);
      for (const subject of retired) assert.ok(!replaced.html.includes(subject.name));
      await locus.stage(w => {
        w.lib("page").at([1, 2]).delete(); w.lib("page").at([1, 1]).delete(); w.lib("page").at([1, 0]).delete();
        w.lib("flat").at([1]).asElement().attrs.set("title", "empty");
      });
      const empty = session.now({ html: "page" }); assert_cut(empty, 0);
      assert.doesNotMatch(empty.html, /@scope|@keyframes|@property|padding:7px|border:3px/);
      assert.equal(empty.libs.libraries.find(e => e.name === "flat")!.scopes, undefined);
      await locus.addLibraries({ shared: [{ name: "later", definition: page }] });
      assert.throws(() => session.now({ html: "later" }), /unavailable/);
      await session.update({ libraries: ["page", "flat", "later"] });
      assert_cut(session.now({ html: "later" }), 5);
      await locus.stage(w => {
        const later = w.lib("later"); if (later.mode !== "document") throw Error("Expected document");
        later.at([1, 0]).replace(node('<hson-part lib="parts" at="panel" id="new"/>'));
        later.at([1, 0]).asElement().attrs.set("title", "recomposed");
        w.lib("page").at([1]).asElement().insert(0, node('<hson-part lib="parts" at="panel" id="returned"/>'));
      });
      assert_cut(session.now({ html: "page" }), 2); assert_cut(session.now({ html: "later" }), 5);
    } finally { locus.dispose(); }
  });
  await check("request interleavings keep HTML and transferable state at the same authorized revision", async () => {
    for (const transition of ["mutation", "reduction", "revocation"] as const) {
      const { locus, session } = await fixture();
      const captured = deferred(), release = deferred();
      try {
        const expected = session.now({ html: "page" });
        const host = hsonLiveHost.create({ name: "h2" });
        const route = host.GET("/", async () => {
          const cut = session.now({ html: "page" }); captured.resolve(); await release.promise;
          return new Response(cut.html, { headers: { "content-type": "text/html; charset=utf-8", "x-revision": String(cut.libs.revision), "x-state": encode_ssr_bootstrap(cut) } });
        });
        const response = route.handle(new Request("http://h2.test/"), { applicationName: "h2", correlationId: "test", principal: { anonymous: true } });
        await captured.promise;
        if (transition === "mutation") await locus.stage(w => {
          w.lib("page").at([]).asElement().attrs.set("title", "new-revision");
          w.lib("page").css.sel("body").setProp("color", "orange");
          w.lib("data").at(["n"]).set(1);
        });
        else if (transition === "reduction") await session.update({ libraries: ["flat"] });
        else session.revoke();
        release.resolve(); const completed = await response;
        assert.equal(await completed.text(), expected.html);
        assert.equal(completed.headers.get("x-revision"), String(expected.libs.revision));
        const state = decode_ssr_bootstrap(completed.headers.get("x-state")!);
        assert.equal(state.kind, "hosted-projection");
        if (state.kind === "hosted-projection") assert.deepEqual(state.bootstrap.libs, expected.libs);
        if (transition === "mutation") { const next = session.now({ html: "page" }); assert_cut(next, 5); assert.equal(next.libs.revision, expected.libs.revision + 1); assert.match(next.html, /new-revision/); assert.match(JSON.stringify(next.libs), /new-revision/); }
        else assert.throws(() => session.now({ html: "page" }), /unavailable/);
      } finally { release.resolve(); locus.dispose(); }
    }
  });
  await check("authorization pending at capture and synchronous revocation fence", async () => {
    const entered = deferred(), release = deferred(); let block = false;
    const locus = hsonLiveMap.locus.create({ ...definition, authorizeProjection: async ({ requested }) => {
      if (block) { entered.resolve(); await release.promise; }
      return { libraries: requested.libraries };
    } });
    try {
      const session = await locus.session.create({ libraries: ["page", "flat"] });
      const expected = session.now({ html: "page" }); block = true;
      const updating = session.update({ libraries: ["flat"] }); await entered.promise;
      assert.deepEqual(session.now({ html: "page" }), expected);
      release.resolve(); await updating;
      assert.throws(() => session.now({ html: "page" }), /unavailable/);
      block = false; await session.update({ libraries: ["page"] });
      const encode = TextEncoder.prototype.encode; let revoked = false;
      TextEncoder.prototype.encode = function(input) {
        if (!revoked) { revoked = true; session.revoke(); }
        return encode.call(this, input);
      };
      try { assert.throws(() => session.now({ html: "page" }), /unavailable/); assert.ok(revoked); }
      finally { TextEncoder.prototype.encode = encode; }
    } finally { release.resolve(); locus.dispose(); }
  });
  await check("pending durable acceptance exposes the prior complete cut; rejected candidates publish nothing", async () => {
    class PausedAdapter extends MemoryCheckpointAdapter {
      entered = deferred(); release = deferred(); pause = false;
      override async appendCommit(record: Parameters<MemoryCheckpointAdapter["appendCommit"]>[0]) {
        if (this.pause) { this.entered.resolve(); await this.release.promise; }
        await super.appendCommit(record);
      }
    }
    const persistence = new PausedAdapter();
    const locus = await hsonLiveMap.locus.resume({ ...definition, logicalMapId: "h2-pending", persistence });
    try {
      const session = await locus.session.create({ libraries: ["page", "flat"] });
      const before = session.now({ html: "page" }); persistence.pause = true;
      const updating = locus.stage(w => { w.lib("page").at([]).asElement().attrs.set("title", "accepted"); w.lib("page").css.sel("body").setProp("color", "blue"); });
      await persistence.entered.promise;
      assert.deepEqual(session.now({ html: "page" }), before);
      persistence.release.resolve(); await updating;
      const after = session.now({ html: "page" }); assert_cut(after, 5); assert.equal(after.libs.revision, before.libs.revision + 1);
      assert.match(after.html, /title="accepted"/); assert.match(after.html, /color:blue/);
      assert.match(JSON.stringify(after.libs), /accepted/);
      persistence.pause = false; persistence.failAppend = Error("reject");
      await assert.rejects(locus.stage(w => { w.lib("page").css.clearAll(); w.lib("flat").css.clearAll(); }));
      assert.deepEqual(session.now({ html: "page" }), after);
    } finally { persistence.release.resolve(); locus.dispose(); }
  });
}
