import assert from "node:assert/strict";
import { hsonLiveMap, bind_locus_http, hsonTransform } from "../../src/index.ts";
import { echo_map_internal } from "../../src/internal/governor-maps.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { add_client_local_libraries_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { quad_navigation_definitions, quad_invocation as invocation } from "../helpers/document-quad-navigation.mts";
import type { AuthorityDocumentQuadLocation } from "../../src/types/livemap.types.ts";

const element = (source: string) => hsonTransform.fromHson(source).toNode().$_content[0]!;
const lookupCases = invocation("twins", "ambiguous") + invocation("transparent", "anonymous") + invocation("shadow", "shadow");
const denied = (subject: AuthorityDocumentQuadLocation<never>) => {
  for (const key of ["replace", "delete", "insert", "move"]) assert.equal(key in subject, false, key);
  for (const key of ["set", "drop", "replace", "setMany", "dropMany", "clear"]) assert.equal(key in subject.attrs, false, key);
  for (const key of ["set", "clear"]) assert.equal(key in subject.flags, false, key);
};

export async function document_recursive_authority_cases() {
  const defs = quad_navigation_definitions(invocation("left") + invocation("right") + invocation("outer", "outer") + lookupCases);
  let inspected = false;
  const locus = hsonLiveMap.locus.create({ parts: defs.parts, page: { ...defs.page, access: "shared" } }, {
    authorizeProjection: () => ({ libraries: ["page"] }),
    actions: { inspect(ctx) {
      const page = ctx.doc.must("page");
      const parent = page.q("left")!, relative = parent.at([999]), child = relative.q("buttonOne")!;
      assert.equal(relative.snap(), undefined); denied(parent); denied(child);
      denied(page.q("outer")!.q("nav")!.q("inner")!.q("label")!);
      assert.equal(page.q("twins")!.q("buttonOne"), undefined);
      assert.equal(child.attrs.get("title"), "queued child");
      relative.dispose(); assert.equal(parent.active, false); assert.equal(child.active, true);
      child.dispose(); inspected = true;
    } },
  });
  const binding = bind_locus_http(locus, { endpoint: "/recursive" });
  const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://quad.test/recursive", fetch: (input, init) => binding.handle(new Request(input, init), {}) });
  try {
    const page = locus.doc.must("page"), parent = page.q("left")!, child = parent.q("buttonOne")!;
    assert.equal(page.q("twins")!.q("buttonOne"), undefined);
    assert.match(page.q("transparent")!.q("buttonOne")!.snap()!, /One/);
    assert.match(page.q("shadow")!.q("buttonOne")!.snap()!, /Local/);
    let commits = 0; const stop = locus.commits.observe(() => commits++);
    const pending = child.attrs.set("title", "queued child");
    assert.ok(pending instanceof Promise); assert.equal(child.attrs.get("title"), undefined);
    await pending; assert.equal(commits, 1); stop();
    assert.equal(parent.attrs.get("title"), undefined); assert.equal(page.q("right")!.q("buttonOne")!.attrs.get("title"), undefined);
    assert.equal((await locus.dispatchAction({ type: "action", id: "recursive", name: "inspect" })).type, "ack"); assert.ok(inspected);
    const session = await locus.session.create({ libraries: ["page"] });
    const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport });
    try {
      const projected = echo.doc.must("page");
      if (projected.source !== "authority-projected") throw Error("Expected projected document");
      const projectedParent = projected.q("left")!, projectedChild = projectedParent.at([999]).q("buttonOne")!;
      denied(projectedParent); denied(projectedChild); denied(projected.q("outer")!.q("nav")!.q("inner")!.q("label")!);
      assert.equal(projected.q("twins")!.q("buttonOne"), undefined);
      assert.match(projected.q("transparent")!.q("buttonOne")!.snap()!, /One/);
      assert.match(projected.q("shadow")!.q("buttonOne")!.snap()!, /Local/);
      assert.equal(projectedParent.q("root")!.q("buttonOne"), undefined);
      assert.equal(projectedParent.q("wrap")!.q("buttonOne"), undefined);
      assert.equal(projected.q("buttonOne"), undefined); assert.equal(projectedParent.q("label"), undefined);
      projectedParent.dispose(); assert.equal(projectedChild.active, true);
      const alias = parent.at([999]); assert.equal(alias.snap(), undefined);
      assert.equal(alias.q("buttonOne")!.attrs.get("title"), "queued child");
      alias.dispose(); assert.equal(parent.active, false); assert.equal(child.active, true);
      const beforePath = child.path(); await page.q("page")!.move(0, 1);
      for (let i = 0; i < 100 && echo.sync.appliedRev !== locus.rev; i++) await new Promise(resolve => setTimeout(resolve, 1));
      assert.equal(echo.sync.appliedRev, locus.rev);
      assert.notDeepEqual(child.path(), beforePath); assert.deepEqual(projectedChild.path(), child.path());
      let retiredDuringCapture = false;
      const captureNames = new Proxy(["title"], { ownKeys(value) {
        retiredDuringCapture = true; child.dispose(); return Reflect.ownKeys(value);
      } });
      const rev = locus.rev; await assert.rejects(child.attrs.dropMany(captureNames)); assert.equal(locus.rev, rev);
      assert.equal(retiredDuringCapture, true); assert.equal(child.active, false);
      const old = page.q("right")!.q("inner")!.q("label")!;
      await page.q("right")!.replace(element('<hson-part lib="parts" at="nav"/>'));
      assert.equal(old.active, false);
      const fresh = page.q("inner")!.q("label")!;
      await page.q("root")!.delete();
      await page.q("page")!.insert(0, element('<hson-part lib="parts" at="nav"/>'));
      assert.equal(old.active, false); assert.equal(fresh.active, false);
      assert.equal(page.q("inner")!.q("label")!.active, true);
      projectedChild.at([]).dispose(); assert.equal(projectedChild.active, false);
    } finally { echo.dispose(); }
  } finally { transport.dispose(); binding.dispose(); locus.dispose(); }
}

/** Real local selector, actual Echo owner predicate, and detached raw-state evidence. */
export async function echo_local_quad_owner_cases() {
  for (const reentrant of ["none", "attrs", "replaceAttrs", "names", "content", "insert", "style"] as const) {
    const locus = hsonLiveMap.locus.create({ state: { json: 0, access: "shared" } }, {
      authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }),
      local: [{ name: "local", initializer: { document: '<main @:page <button @:button title="kept" "Original"/>/>' } }],
    });
    const binding = bind_locus_http(locus, { endpoint: "/local" });
    const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://quad.test/local", fetch: (input, init) => binding.handle(new Request(input, init), {}) });
    const session = await locus.session.create({ libraries: ["state", "local"] });
    const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport });
    try {
      const map = echo_map_internal(echo), local = echo.doc.must("local");
      if (local.source !== "client-local") throw Error("Expected local document");
      // Install the existing portable scoped fixture into the local partition;
      // no public transport or correspondence format is added for this test.
      const source = hsonLiveMap.fromLibraries(quad_navigation_definitions(invocation("left") + invocation("right") + invocation("outer", "outer")
        + lookupCases + '<hson-part lib="parts" at="nav"/><button @:buttonOne "Local"/>'));
      const a = authority(source), id = a.libraries()[1]!, state = a.scopedDocumentState(id);
      add_client_local_libraries_internal(map, [{ name: "scoped", family: "document", schema: a.librarySchema(id), root: state.root, scopes: state.scopes }], { scoped: state.css });
      const scoped = echo.doc.must("scoped"); if (scoped.source !== "client-local") throw Error("Expected local scoped document");
      const parent = scoped.q("left")!, alias = parent.at([999]), child = alias.q("buttonOne")!;
      assert.equal(alias.snap(), undefined); assert.equal(child.attrs.set("title", "sync").rev, map.rev);
      assert.equal(child.attrs.get("title"), "sync"); assert.equal(parent.attrs.get("title"), undefined);
      assert.equal(scoped.q("right")!.q("buttonOne")!.attrs.get("title"), undefined);
      assert.match(scoped.q("outer")!.q("nav")!.q("inner")!.q("label")!.snap()!, /Leaf/);
      assert.match(scoped.q("buttonOne")!.snap()!, /Local/);
      assert.equal(scoped.q("twins")!.q("buttonOne"), undefined);
      assert.match(scoped.q("transparent")!.q("buttonOne")!.snap()!, /One/);
      assert.match(scoped.q("shadow")!.q("buttonOne")!.snap()!, /Local/);
      assert.equal(parent.q("root")!.q("buttonOne"), undefined);
      assert.equal(parent.q("wrap")!.q("buttonOne"), undefined); assert.equal(parent.q("label"), undefined);
      assert.equal(scoped.q("inner")!.q("label")!.active, true, "Unique unnamed occurrence is transparent");
      assert.equal(scoped.q("label"), undefined, "Named child remains a boundary");
      const independent = alias.q("buttonOne")!;
      independent.at([0]).dispose(); assert.equal(independent.active, false); assert.equal(child.active, true);
      alias.dispose(); assert.equal(parent.active, false); assert.equal(child.active, true);
      assert.throws(() => parent.q("buttonOne"));
      const path = child.path(); scoped.q("page")!.move(0, 1);
      assert.notDeepEqual(child.path(), path); assert.equal(child.attrs.get("title"), "sync");
      const lost = scoped.q("right")!.q("inner")!.q("label")!;
      scoped.q("right")!.delete(); assert.equal(lost.active, false); assert.equal(lost.snap(), undefined);
      const moving = local.q("button")!, moveRev = map.rev;
      let moved = false;
      const reentrantValues = new Proxy({ title: "redirected" }, { ownKeys(value) {
        if (!moved) { moved = true; scoped.q("page")!.move(0, 1); }
        return Reflect.ownKeys(value);
      } });
      assert.throws(() => moving.attrs.setMany(reentrantValues), /identity or authority changed during capture/);
      assert.equal(moved, true); assert.equal(map.rev, moveRev + 1, "Only independently accepted inner work remains published");
      assert.equal(moving.attrs.get("title"), "kept");
      const raw = map.doc.must("local"), target = local.q("button")!, retained = scoped.q("outer")!.q("nav")!.q("inner")!;
      const before = raw.snap(), rev = map.rev;
      let ownerDisposed = false;
      const dispose = () => { ownerDisposed = true; echo.dispose(); };
      const capture = <T extends object>(value: T) => new Proxy(value, { ownKeys(target) { dispose(); return Reflect.ownKeys(target); } });
      if (reentrant === "none") dispose();
      if (reentrant === "attrs") assert.throws(() => target.attrs.setMany(capture({ title: "blocked" })));
      if (reentrant === "replaceAttrs") assert.throws(() => target.attrs.replace(capture({ title: "blocked" })));
      if (reentrant === "names") assert.throws(() => target.attrs.dropMany(capture(["title"])));
      if (reentrant === "content" || reentrant === "insert") {
        const content = element('<b "blocked"/>'); assert.ok(typeof content === "object" && content !== null);
        assert.throws(() => reentrant === "content" ? target.replace(capture(content)) : target.insert(0, capture(content)));
      }
      if (reentrant === "style") assert.throws(() => target.attrs.set("style", capture({ color: "red" })));
      assert.equal(ownerDisposed, true, `${reentrant}: capture actually disposed the owner`);
      const disposed = { name: "Error", message: "Disposed Echo authority." };
      const reads = [() => target.active, () => target.rev, () => target.path(), () => target.snap(), () => target.hson(),
        () => target.must.snap(), () => target.must.hson(), () => target.attrs.get("title"), () => target.attrs.has("title"),
        () => target.attrs.keys(), () => target.attrs.must.get("title"), () => target.flags.has("hidden"),
        () => target.at([]), () => target.q("missing"), () => local.q("button"), () => local.q("missing"),
        () => child.active, () => retained.q("label"), () => retained.at([999]).q("label")];
      for (const [index, read] of reads.entries()) assert.throws(read, disposed, `${reentrant}: read ${index}`);
      let captured = false;
      const values = new Proxy({ title: "blocked" }, { ownKeys(value) { captured = true; return Reflect.ownKeys(value); } });
      const writes = [() => target.replace("blocked"), () => target.delete(), () => target.insert(0, "blocked"), () => target.move(0, 0),
        () => target.attrs.set("title", "blocked"), () => target.attrs.drop("title"), () => target.attrs.setMany(values),
        () => target.attrs.replace(values), () => target.attrs.dropMany(["title"]), () => target.attrs.clear(),
        () => target.flags.set("hidden"), () => target.flags.clear("hidden"), () => child.attrs.set("title", "blocked")];
      for (const [index, write] of writes.entries()) assert.throws(write, disposed, `${reentrant}: write ${index}`);
      assert.equal(captured, false, "Disposed owner rejects before inspecting input");
      assert.equal(raw.snap(), before); assert.equal(map.rev, rev, "Reentrant owner disposal cannot publish the pending write");
      for (const selection of [parent, alias, child, retained, target]) { selection.dispose(); selection.dispose(); }
    } finally { echo.dispose(); transport.dispose(); binding.dispose(); locus.dispose(); }
  }
}
