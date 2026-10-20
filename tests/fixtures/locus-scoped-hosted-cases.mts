import assert from "node:assert/strict";
import { hsonLiveMap, type LiveMap } from "hson-live/livemap";
import { hsonTransform } from "hson-live/transform";
import { bind_locus_http, bind_locus_websocket, type Locus, type LocusSession, type LocusWebSocketLike,
  type LocusSessionNow, type LocusProjectionAuthorizer } from "hson-live/locus";
import type { Echo, EchoReplicaTransport } from "hson-live/echo";
import { test_echo_transport } from "../helpers/public-echo-websocket-transport.mts";

export const parts = { parts: {
  leaf: { kind: "document", document: '<button @:root <span @:label "Visible"/>/>', css: ':scope{padding:3px}[hson\\:quad="label"]{border:0}' },
  panel: { kind: "document", document: '<section @:root <hson-part @:child at="leaf"/>/>', css: ':scope{margin:7px}' },
  bare: { kind: "document", document: '<aside @:root "Bare"/>' },
  secret: { kind: "document", document: '<p "PRIVATE_TEMPLATE"/>', css: 'p{--private:PRIVATE_CSS}' },
} } as const;
export const page = { document: '<main @:page <hson-part @:left lib="parts" at="panel"/> <hson-part @:right lib="parts" at="panel"/> <footer @:footer/>/>' };
const authorizeProjection: LocusProjectionAuthorizer = ({ requested, connection }) => ({
  libraries: connection?.principalId === "denied" ? requested.libraries.filter(n => n === "data") : requested.libraries,
  writableDocuments: connection?.principalId === "writer" ? requested.libraries : [],
});
export const definition = {
  private: [{ name: "parts", definition: parts }, { name: "hidden", definition: { data: { secret: "PRIVATE_DATA" } } }],
  shared: [{ name: "page", definition: page }, { name: "bare", definition: { document: '<main <hson-part lib="parts" at="bare"/>/>' } },
    { name: "flat", definition: { document: '<html @:flat <head/> <body/>/>' } }, { name: "data", definition: { data: { n: 0 } } }],
  local: [{ name: "local", initializer: { data: { n: 0 } } }], authorizeProjection,
} as const;
export const names = ["page", "bare", "flat", "data", "local", "parts", "hidden"];
export type Replica = Echo<LiveMap>;
export type Route = "http" | "websocket";
export function document(echo: Replica, name = "page") {
  const value = echo.doc.must(name);
  if (value.mode !== "document" || value.source !== "authority-projected") throw Error(`Expected projected document ${name}`);
  return value;
}
export function node(source: string) {
  const value = hsonTransform.fromHson(source).toNode().$_content[0];
  if (typeof value !== "object" || value === null) throw Error("Expected element");
  return value;
}
export async function until(check: () => boolean, label = "condition") {
  for (let i = 0; i < 300; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(check(), label);
}
export async function caught(echo: Replica, locus: Locus) {
  await until(() => echo.sync.status === "caught_up" && echo.sync.appliedRev === locus.rev,
    `caught up: ${JSON.stringify(echo.sync.debug())}`);
}

/** Exercise the concrete public codecs and binders, using Web Request/Response in Workers too. */
export function route(kind: Route, locus: Locus, principalId: string) {
  const frames: string[] = [];
  const control: { transform?: (raw: string) => readonly string[] } = {};
  const output = (raw: string) => { frames.push(raw); return control.transform?.(raw) ?? [raw]; };
  let dispose: () => void;
  let transport: EchoReplicaTransport & { dispose: () => void };
  if (kind === "http") {
    const binding = bind_locus_http(locus, { endpoint: "/h1" });
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init), response = await binding.handle(request, { principalId });
      if (response.body === null) return response;
      const streaming = response.headers.get("content-type")?.includes("ndjson");
      if (!streaming) {
        const raw = await response.text();
        return new Response(output(raw).join(""), { status: response.status, headers: response.headers });
      }
      let pending = "";
      const decoded = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream<string, string>({
        transform(chunk, controller) {
          pending += chunk;
          for (;;) {
            const end = pending.indexOf("\n"); if (end < 0) break;
            const line = pending.slice(0, end); pending = pending.slice(end + 1);
            if (line) for (const raw of output(line)) controller.enqueue(`${raw}\n`);
          }
        },
        flush(controller) { if (pending) for (const raw of output(pending)) controller.enqueue(raw); },
      })).pipeThrough(new TextEncoderStream());
      return new Response(decoded, { status: response.status, headers: response.headers });
    };
    transport = hsonLiveMap.echo.transport.http({ endpoint: "http://h1.test/h1", fetch: fetcher });
    dispose = () => { transport.dispose(); binding.dispose(); };
  } else {
    const incoming = new Set<(raw: string) => void>(), outgoing = new Set<(raw: string) => void>();
    const serverClose = new Set<() => void>(), clientClose = new Set<() => void>();
    let binding: (() => void) | undefined;
    const server: LocusWebSocketLike = {
      send(raw) { for (const text of output(raw)) for (const listener of [...incoming]) listener(text); },
      close() { for (const listener of [...clientClose]) listener(); },
      onMessage(listener) { outgoing.add(listener); return () => { outgoing.delete(listener); }; },
      onClose(listener) { serverClose.add(listener); return () => { serverClose.delete(listener); }; },
    };
    const physical: LocusWebSocketLike = {
      send(raw) { for (const listener of [...outgoing]) listener(raw); },
      close() { for (const listener of [...serverClose]) listener(); binding?.(); binding = undefined; },
      onMessage(listener) {
        incoming.add(listener); binding ??= bind_locus_websocket(locus, server, { principalId });
        return () => { incoming.delete(listener); };
      },
      onClose(listener) { clientClose.add(listener); return () => { clientClose.delete(listener); }; },
    };
    transport = test_echo_transport(physical);
    dispose = () => { transport.dispose(); binding?.(); };
  }
  return { transport, frames, control, dispose };
}
export async function receiver(locus: Locus, kind: Route, requested = names, principal = "reader", now?: LocusSessionNow) {
  const session = await locus.session.create({ libraries: requested }, { connection: { principalId: principal } });
  return receiving(locus, kind, session, principal, now ?? session.now());
}
export async function receiving(locus: Locus, kind: Route, session: LocusSession, principal: string, now = session.now()) {
  const wire = route(kind, locus, principal);
  try {
    const echo = await hsonLiveMap.echo.create({ now: JSON.parse(JSON.stringify(now)), credential: session.credential!, transport: wire.transport });
    return { ...wire, echo, session, dispose() { echo.dispose(); wire.dispose(); } };
  } catch (error) { wire.dispose(); throw error; }
}
function privateAbsent(raw: string) {
  assert.doesNotMatch(raw, /PRIVATE_TEMPLATE|PRIVATE_CSS|PRIVATE_DATA|"name":"parts"|"name":"hidden"|hson-part/);
}
function subjectIds(css: string) { return [...css.matchAll(/hson\\:quid="([^"]+)"/g)].map(match => match[1]!); }

export async function hosted_scoped_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  for (const kind of ["http", "websocket"] as const) {
    await check(`${kind}: public scoped state, ordered updates, grants, retirement and disposal`, async () => {
      const locus = hsonLiveMap.locus.create(definition);
      const a = await receiver(locus, kind), b = await receiver(locus, kind, names, "writer"), denied = await receiver(locus, kind, names, "denied");
      try {
        const now = a.session.now();
        assert.deepEqual(now.libs.libraries.map(e => e.name), ["bare", "data", "flat", "page"]);
        const scopes = now.libs.libraries.find(e => e.name === "page")!.scopes!;
        assert.equal(scopes.occurrences.length, 4);
        assert.deepEqual(scopes.occurrences.map(o => o.parent), [null, [0, 0, 0], null, [0, 0, 1]]);
        assert.equal(now.libs.libraries.find(e => e.name === "bare")!.scopes!.occurrences.length, 1);
        assert.equal(document(a.echo, "bare").css.snapshot(), "");
        assert.ok(document(a.echo, "flat").q("flat"));
        assert.equal(document(a.echo).q("label"), undefined);
        assert.ok(document(a.echo).q("left")); assert.ok(document(a.echo).q("right"));
        assert.deepEqual(document(a.echo).root(), locus.doc.must("page").root());
        assert.throws(() => a.echo.parts.must("parts")); assert.throws(() => a.echo.data.must("hidden")); assert.throws(() => denied.echo.doc.must("page"));
        privateAbsent(JSON.stringify(now));
        // This fragment has CSS but no explicit html/head, which remains invalid SSR.
        assert.throws(() => a.session.now({ html: "page" }), /browser-parser realization/);
        assert.match(a.session.now({ html: "bare" }).html, /Bare/);
        assert.throws(() => document(a.echo).render(), /browser-parser realization/);
        assert.throws(() => locus.cut({ html: "page" }), /scoped|Echo/i);
        const idsA = subjectIds(document(a.echo).css.snapshot()), idsB = subjectIds(document(b.echo).css.snapshot());
        assert.ok(idsA.length > 0); for (const id of idsA) assert.ok(!idsB.includes(id));
        const revisions: number[] = [];
        const stop = a.echo.commits.observe(() => { revisions.push(a.echo.sync.appliedRev!); });
        const left = document(a.echo).q("left")!, right = document(a.echo).q("right")!;
        await locus.stage(w => {
          w.doc.must("page").at([]).asElement().attrs.setMany({ title: "one" });
          w.doc.must("page").at([0, 0]).asElement().flags.set("hidden");
          w.doc.must("page").css.sel("main").setProp("color", "blue");
          w.data.must("data").at(["n"]).set(1);
        });
        await caught(a.echo, locus); await caught(b.echo, locus); await caught(denied.echo, locus);
        assert.equal(document(a.echo).at([]).asElement()!.attrs.get("title"), "one");
        assert.equal(document(a.echo).at([0, 0]).asElement()!.flags.has("hidden"), true);
        assert.match(document(a.echo).css.snapshot(), /color:blue/);
        assert.equal(left.active, true); assert.equal(right.active, true);
        const rev = locus.rev;
        await locus.doc.must("page").at([]).asElement()!.attrs.set("title", "one");
        assert.equal(locus.rev, rev);
        const unchanged = { graph: document(a.echo).root(), css: document(a.echo).css.snapshot(), rev: a.echo.sync.appliedRev, observations: revisions.length };
        await assert.rejects(locus.stage(w => { w.doc.must("page").css.clearAll(); w.doc.must("page").at([99]).asElement().attrs.set("bad", true); }));
        await assert.rejects(document(a.echo).at([]).asElement()!.attrs.set("title", "denied"));
        assert.deepEqual({ graph: document(a.echo).root(), css: document(a.echo).css.snapshot(), rev: a.echo.sync.appliedRev, observations: revisions.length }, unchanged);
        const data = a.echo.data.must("data"); assert.ok(String(data.mode) !== "document" && data.source === "authority-projected"); assert.equal("set" in data.at(["n"]), false);
        await document(b.echo).at([]).asElement()!.attrs.set("title", "remote");
        await caught(a.echo, locus);
        await locus.doc.must("page").at([0]).delete();
        await caught(a.echo, locus);
        assert.equal(left.active, false); assert.equal(right.active, true); assert.deepEqual(right.path(), [0]);
        assert.equal((document(a.echo).css.snapshot().match(/margin:7px/g) ?? []).length, 1);
        assert.equal(a.session.now().libs.libraries.find(e => e.name === "page")!.scopes!.occurrences.length, 2);
        const survivingIds = subjectIds(document(a.echo).css.snapshot());
        const retiredId = idsA.find(id => !survivingIds.includes(id)); assert.ok(retiredId);
        const beforeClaims = { graph: document(a.echo).root(), css: document(a.echo).css.snapshot(), rev: a.echo.sync.appliedRev, observations: revisions.length };
        for (const id of [survivingIds[0]!, retiredId]) {
          await assert.rejects(document(b.echo).at([]).asElement()!.attrs.setMany({ "$_quid": id }));
        }
        assert.equal(locus.rev, 3); assert.equal(left.active, false); assert.equal(right.active, true);
        assert.deepEqual({ graph: document(a.echo).root(), css: document(a.echo).css.snapshot(), rev: a.echo.sync.appliedRev, observations: revisions.length }, beforeClaims);
        assert.deepEqual(revisions, [1, 2, 3]); stop();
        await locus.addLibraries({ shared: [{ name: "later", definition: page }], private: [{ name: "privateLater", definition: page }] });
        await caught(a.echo, locus); assert.throws(() => a.echo.doc.must("later"));
        await a.session.update({ libraries: ["page", "later", "data", "local", "privateLater"] });
        await until(() => { if (a.echo.sync.failure) throw a.echo.sync.failure.cause ?? Error(a.echo.sync.failure.message); try { return document(a.echo, "later").q("left") !== undefined; } catch { return false; } }, "dynamic scoped grant");
        assert.throws(() => a.echo.data.must("privateLater")); assert.throws(() => b.echo.doc.must("later"));
        const added = locus.doc.must("later"); assert.equal(added.mode, "document");
        if (added.mode === "document") await added.at([]).asElement()!.attrs.set("title", "dynamic");
        await caught(a.echo, locus); assert.equal(document(a.echo, "later").at([]).asElement()!.attrs.get("title"), "dynamic");
        const retained = document(a.echo, "later").q("left")!;
        await a.session.update({ libraries: ["data", "local"] });
        await until(() => { try { a.echo.doc.must("later"); return false; } catch { return true; } }, "reduced visibility");
        assert.equal(retained.active, false); assert.throws(() => a.echo.doc.must("page"));
        for (const raw of [...a.frames, ...denied.frames]) privateAbsent(raw);
        for (const raw of denied.frames) assert.doesNotMatch(raw, /"name":"page"|padding:3px|margin:7px/);
        const revokedPage = document(b.echo), beforeRevoke = revokedPage.root();
        const revokedNow = b.session.now(), revokedCredential = b.session.credential!, beforeRevocation = locus.rev;
        assert.equal(b.session.revoke(), true);
        const rejected = revokedPage.at([]).asElement()!.attrs.set("title", "revoked");
        const rejection = assert.rejects(rejected);
        await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(locus.rev, beforeRevocation);
        b.echo.dispose(); await rejection;
        const staleRoute = route(kind, locus, "writer");
        try { await assert.rejects(hsonLiveMap.echo.create({ now: revokedNow, credential: revokedCredential, transport: staleRoute.transport })); }
        finally { staleRoute.dispose(); }
        await locus.doc.must("page").at([]).asElement()!.attrs.set("title", "after-revoke");
        assert.deepEqual(revokedPage.root(), beforeRevoke);
        assert.throws(() => b.session.now());
        const beforeDispose = a.echo.sync.appliedRev; a.echo.dispose();
        await locus.data.must("data").at(["n"]).set(2); assert.equal(a.echo.sync.appliedRev, beforeDispose);
      } finally { a.dispose(); b.dispose(); denied.dispose(); locus.dispose(); }
    });

    await check(`${kind}: flat delivery stays flat until an authored Part is inserted`, async () => {
      const locus = hsonLiveMap.locus.create(definition), active = await receiver(locus, kind, ["flat", "data"]);
      try {
        const subject = document(active.echo, "flat").q("flat")!;
        await locus.stage(w => {
          w.doc.must("flat").at([]).asElement().attrs.set("title", "flat");
          w.doc.must("flat").at([]).asElement().flags.set("hidden");
          w.doc.must("flat").css.sel("main").setProp("color", "navy");
        });
        await caught(active.echo, locus);
        assert.equal(active.session.now().libs.libraries.find(e => e.name === "flat")!.scopes, undefined);
        assert.match(active.session.now({ html: "flat" }).html, /navy/);
        assert.equal(subject.active, true);
        await locus.doc.must("flat").at([1]).asElement()!.insert(0, node('<hson-part lib="parts" at="panel"/>'));
        await caught(active.echo, locus);
        assert.equal(active.session.now().libs.libraries.find(e => e.name === "flat")!.scopes!.occurrences.length, 2);
        assert.equal(subject.active, true); assert.match(document(active.echo, "flat").css.snapshot(), /padding:3px/);
        const rendered = active.session.now({ html: "flat" });
        assert.deepEqual(rendered.libs, active.session.now().libs);
        assert.match(rendered.html, /padding:3px/);
        assert.doesNotMatch(rendered.html, /hson-part/);
      } finally { active.dispose(); locus.dispose(); }
    });

    await check(`${kind}: missed-tail replay, stale initialization and fresh session isolation`, async () => {
      const locus = hsonLiveMap.locus.create(definition), a = await receiver(locus, kind);
      try {
        const local = a.echo.data.must("local"); assert.ok(String(local.mode) !== "document" && local.source === "client-local"); local.at(["n"]).set(42);
        const left = document(a.echo).q("left")!, right = document(a.echo).q("right")!;
        const oldIds = subjectIds(document(a.echo).css.snapshot());
        a.echo.disconnect();
        await locus.doc.must("page").at([0]).replace(node('<hson-part lib="parts" at="panel"/>'));
        await locus.doc.must("page").at([]).asElement()!.attrs.set("title", "missed");
        assert.equal(a.echo.sync.appliedRev, 0);
        await new Promise<void>(resolve => setImmediate(resolve)); a.echo.connect(); await caught(a.echo, locus);
        assert.equal(a.echo.sync.strategy, "replay"); assert.equal(left.active, false); assert.equal(right.active, true);
        assert.equal(local.snap(["n"]), 42);
        const session = await locus.session.create({ libraries: names }, { connection: { principalId: "reader" } });
        const stale = session.now();
        await locus.doc.must("page").at([]).asElement()!.attrs.set("title", "current");
        const fresh = await receiving(locus, kind, session, "reader", stale);
        try {
          assert.equal(fresh.echo.sync.strategy, "reconcile");
          assert.deepEqual(document(fresh.echo).root(), locus.doc.must("page").root());
          for (const id of subjectIds(document(fresh.echo).css.snapshot())) assert.ok(!oldIds.includes(id));
        } finally { fresh.dispose(); }
        const divergentSession = await locus.session.create({ libraries: names }, { connection: { principalId: "reader" } });
        const divergent = structuredClone(divergentSession.now());
        const scoped = divergent.libs.libraries.find(e => e.name === "page")!.scopes!;
        Object.assign(scoped.document[0]!, { name: "aFooter" });
        const reconciled = await receiving(locus, kind, divergentSession, "reader", divergent);
        try {
          assert.equal(reconciled.echo.sync.strategy, "reconcile");
          assert.ok(document(reconciled.echo).q("page")); assert.equal(document(reconciled.echo).q("aFooter"), undefined);
        } finally { reconciled.dispose(); }
        a.echo.disconnect(); await new Promise<void>(resolve => setImmediate(resolve));
        await a.session.update({ libraries: ["data", "local"] });
        a.echo.connect(); await caught(a.echo, locus); assert.throws(() => a.echo.doc.must("page")); assert.equal(right.active, false);
      } finally { a.dispose(); locus.dispose(); }
    });
  }
}

export async function hosted_scoped_rejection_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  for (const kind of ["http", "websocket"] as const) {
    await check(`${kind}: corrupt initial scoped evidence and cross-session state fail atomically`, async () => {
      const locus = hsonLiveMap.locus.create(definition), active = await receiver(locus, kind);
      try {
        const graph = document(active.echo).root(), css = document(active.echo).css.snapshot();
        let observations = 0; const stop = active.echo.commits.observe(() => observations++);
        const corruptions: ((entry: any) => void)[] = [
          e => { delete e.scopes.occurrences; },
          e => { e.scopes.occurrences[1].parent = [99]; },
          e => { e.scopes.subjects.push(e.scopes.subjects[0]); },
          e => { e.scopes.subjects.pop(); },
          e => { e.scopes.document.push(e.scopes.document[0]); },
          e => { e.css.order[0].owner = '[hson\\:quad="_999999999"]'; },
          e => { delete e.scopes; },
        ];
        for (const corrupt of corruptions) {
          const session = await locus.session.create({ libraries: names }, { connection: { principalId: "reader" } });
          const input = structuredClone(session.now()); corrupt(input.libs.libraries.find(e => e.name === "page"));
          await assert.rejects(receiving(locus, kind, session, "reader", input)); session.revoke();
        }
        const other = await locus.session.create({ libraries: ["data"] }, { connection: { principalId: "reader" } });
        await assert.rejects(receiving(locus, kind, other, "reader", active.session.now())); other.revoke();
        assert.deepEqual(document(active.echo).root(), graph); assert.equal(document(active.echo).css.snapshot(), css);
        assert.equal(active.echo.sync.appliedRev, 0); assert.equal(locus.rev, 0); assert.equal(observations, 0); stop();
      } finally { active.dispose(); locus.dispose(); }
    });
    await check(`${kind}: corrupt projection reconciliation cannot install a partial Library grant`, async () => {
      const locus = hsonLiveMap.locus.create(definition), active = await receiver(locus, kind);
      try {
        await locus.addLibraries({ shared: [{ name: "later", definition: page }] }); await caught(active.echo, locus);
        const graph = document(active.echo).root(), css = document(active.echo).css.snapshot();
        const subject = document(active.echo).q("left")!; let observations = 0;
        const stop = active.echo.commits.observe(() => observations++);
        active.control.transform = raw => {
          const message = JSON.parse(raw);
          if (message.type === "projection-change") delete message.reconciliation.libraries.find((entry: any) => entry.name === "later").scopes.occurrences;
          return [JSON.stringify(message)];
        };
        await active.session.update({ libraries: ["page", "later", "data", "local"] });
        await until(() => active.echo.sync.status === "failed", "corrupt reconciliation rejected");
        assert.throws(() => active.echo.doc.must("later")); assert.equal(subject.active, true);
        assert.deepEqual(document(active.echo).root(), graph); assert.equal(document(active.echo).css.snapshot(), css);
        assert.equal(observations, 0); assert.equal(active.echo.sync.appliedRev, 1); stop();
        delete active.control.transform; active.echo.disconnect(); await new Promise<void>(resolve => setImmediate(resolve));
        active.echo.connect(); await caught(active.echo, locus);
        assert.ok(document(active.echo, "later").q("left"));
      } finally { active.dispose(); locus.dispose(); }
    });
    await check(`${kind}: invalid scoped effects reject without partial graph CSS progress or observations`, async () => {
      for (const corruption of ["before", "ordinal", "created", "missing"] as const) {
        const locus = hsonLiveMap.locus.create(definition), active = await receiver(locus, kind);
        try {
          const graph = document(active.echo).root(), css = document(active.echo).css.snapshot(), subject = document(active.echo).q("left")!;
          let observations = 0; const stop = active.echo.commits.observe(() => observations++);
          active.control.transform = raw => {
            const message = JSON.parse(raw);
            if (message.type === "commit") {
              const effect = message.commit.commit.operations.find((op: any) => op.domain === "document").effect;
              if (corruption === "before") effect.before = "0".repeat(64);
              if (corruption === "ordinal") effect.ordinal = 7;
              if (corruption === "created") effect.created.push(effect.created[0]);
              if (corruption === "missing") delete effect.removed;
            }
            return [JSON.stringify(message)];
          };
          await locus.stage(w => {
            w.doc.must("page").at([0]).replace(node('<hson-part lib="parts" at="panel"/>'));
            w.doc.must("page").css.sel("main").setProp("color", "green");
            w.data.must("data").at(["n"]).set(9);
          });
          await until(() => active.echo.sync.status === "failed", "corrupt effect rejected");
          assert.deepEqual(document(active.echo).root(), graph); assert.equal(document(active.echo).css.snapshot(), css);
          assert.equal(subject.active, true); assert.equal(active.echo.sync.appliedRev, 0); assert.equal(observations, 0);
          const data = active.echo.data.must("data"); assert.ok(String(data.mode) !== "document"); assert.equal(data.snap(["n"]), 0);
          stop(); delete active.control.transform; active.echo.disconnect(); await new Promise<void>(resolve => setImmediate(resolve)); active.echo.connect(); await caught(active.echo, locus);
          assert.equal(active.echo.sync.strategy, "replay"); assert.equal(subject.active, false);
          assert.deepEqual(document(active.echo).root(), locus.doc.must("page").root());
        } finally { active.dispose(); locus.dispose(); }
      }
    });
  }
  for (const kind of ["http", "websocket"] as const) await check(`${kind}: duplicate and out-of-order scoped revisions use existing recovery fences`, async () => {
    const locus = hsonLiveMap.locus.create(definition), active = await receiver(locus, kind);
    try {
      let observations = 0; const stop = active.echo.commits.observe(() => observations++);
      active.control.transform = raw => JSON.parse(raw).type === "commit" ? [raw, raw] : [raw];
      await locus.doc.must("page").at([]).asElement()!.attrs.set("title", "one");
      await until(() => active.echo.sync.status === "failed", "duplicate fences the stream");
      const graph = document(active.echo).root();
      assert.deepEqual(graph, locus.doc.must("page").root());
      assert.equal(active.echo.sync.appliedRev, 1); assert.equal(observations, 1); stop();
      delete active.control.transform;
      active.echo.disconnect(); await new Promise<void>(resolve => setImmediate(resolve)); active.echo.connect(); await caught(active.echo, locus);
      let dropped = false;
      active.control.transform = raw => {
        if (!dropped && JSON.parse(raw).type === "commit") { dropped = true; return []; }
        return [raw];
      };
      await locus.doc.must("page").at([]).asElement()!.attrs.set("title", "two");
      await locus.doc.must("page").at([]).asElement()!.attrs.set("title", "three");
      await until(() => active.echo.sync.status === "failed", "out-of-order rejection");
      assert.equal(active.echo.sync.appliedRev, 1); assert.deepEqual(document(active.echo).root(), graph);
      delete active.control.transform; active.echo.disconnect(); await new Promise<void>(resolve => setImmediate(resolve)); active.echo.connect(); await caught(active.echo, locus);
      assert.equal(active.echo.sync.strategy, "replay"); assert.equal(document(active.echo).at([]).asElement()!.attrs.get("title"), "three");
    } finally { active.dispose(); locus.dispose(); }
  });
}
