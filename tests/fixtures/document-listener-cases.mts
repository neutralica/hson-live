import assert from "node:assert/strict";
import { ANY_DATA, Hson, add_interaction, bind_locus_http, hsonLiveMap, remove_interaction, type LiveMap } from "../../src/index.ts";
import { hson_data_from_value } from "../../src/api/data/hson-data.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";
import { create_registry_locus_internal } from "../../src/api/locus/locus.registry.ts";
import { ordered_projected_array } from "../../src/core/ordered-projected-value.ts";
import { projected_value_from_hson_node } from "../../src/core/projected-value-graph.ts";
import { echo_map_internal } from "../../src/internal/governor-maps.ts";
import { require_interaction_system_internal } from "../../src/internal/interaction-storage.ts";
import type { DocumentListener } from "../../src/types/interaction.descriptor.types.ts";
import { deferred } from "../helpers/hosted-css-authority-fixture.mts";

const source = '<main <button @:selected id="selected" "Selected"/> <button id="other" "Other"/>/>';
const first = [1, 0, 0] as const;
const second = [1, 0, 1] as const;
const structural = (index: number) => [0, 0, 1, 0, 0, 0, index];
const exact = Hson.data.fromSource(Hson.canonical`<'10' -0 '2' 2 __proto__ <safe true>>`);

function reflectingInput(run: () => void) {
  return new Proxy({ captured: true }, { ownKeys(value) { run(); return Reflect.ownKeys(value); } });
}

function coordinate_listener<TResult>(location: object): DocumentListener<TResult> {
  const listener: DocumentListener<TResult> | undefined = Reflect.get(location, "listen");
  assert.ok(listener, "Expected the coordinate to retain its element listener.");
  return listener;
}

function descriptors(map: LiveMap) {
  const aggregate = internal_livemap_aggregate_authority(map);
  const root = aggregate.systemRoot(require_interaction_system_internal(aggregate));
  const data = hson_data_from_value(projected_value_from_hson_node(root));
  const descriptors = data.entries()?.find(([key]) => key === "descriptors")?.[1].items();
  assert.ok(descriptors);
  return descriptors.map(descriptor => new Map(descriptor.entries()));
}

function assert_subjects(map: LiveMap, ids: readonly string[], index: number) {
  const records = descriptors(map);
  assert.deepEqual(records.map(record => record.get("id")?.scalar()), ids);
  for (const record of records) {
    assert.deepEqual(record.get("subject")?.materialize(), { library: "page", path: structural(index) });
  }
  return records;
}

export async function document_listener_cases(): Promise<void> {
  const unreadInput = reflectingInput(() => assert.fail("An invalid listener target must reject before input reflection."));
  {
    const map = hsonLiveMap.fromLibraries({ page: { document: source } });
    const page = map.doc.must("page"), coordinate = page.at(first), at = coordinate.asElement()!, quad = page.q("selected")!;
    let invoked = 0;
    map.behaviors.define("panel.toggle", () => { invoked++; }, { input: { required: true, schema: ANY_DATA } });
    const pathId = coordinate_listener<string>(coordinate).local.onClick("panel.toggle", exact);
    const quadId = quad.listen.local.onClick("panel.toggle", exact);
    assert.equal(typeof pathId, "string");
    assert.notEqual(pathId, quadId);
    assert.equal(invoked, 0);
    for (const record of assert_subjects(map, [pathId, quadId], 0)) {
      assert.equal(record.get("kind")?.scalar(), "browser");
      assert.ok(record.get("args")?.equals(exact));
    }
    const saved = map.capture();
    assert.throws(() => Reflect.apply(at.listen.local.onClick, undefined, ["panel.toggle"]), TypeError);
    assert.throws(() => quad.at([0]).listen.local.onClick("panel.toggle", exact), /ordinary element/);
    assert.throws(() => map.batch(stage => {
      const parent = stage.doc.must("page").at([1, 0]).asElement();
      assert.equal("listen" in parent, false);
      parent.move(0, 1);
      at.listen.local.onClick("panel.toggle", exact);
    }), /active batch/);
    assert_subjects(map, [pathId, quadId], 0);
    page.at([1, 0]).asElement()!.move(0, 1);
    assert.deepEqual(quad.path(), second);
    assert_subjects(map, [pathId, quadId], 1);
    const textCoordinate = page.at(second);
    const turnedText = textCoordinate.asElement()!;
    quad.replace("Retired");
    assert.equal(quad.active, false);
    assert.throws(() => quad.listen.local.onClick("panel.toggle", exact), /no longer active/);
    assert.throws(() => turnedText.listen.local.onClick("panel.toggle", unreadInput), /ordinary element/);
    assert.throws(() => coordinate_listener<string>(textCoordinate).local.onClick("panel.toggle", unreadInput), /ordinary element/);
    page.at(second).delete();
    const deleted = page.at(first).asElement()!;
    deleted.insert(0, { $_tag: "span", $_content: [] });
    const deletedCoordinate = page.at([...first, 0]);
    deletedCoordinate.delete();
    assert.notEqual(deletedCoordinate.kind(), "element");
    assert.throws(() => coordinate_listener<string>(deletedCoordinate).host.onClick("deck.advance", unreadInput), /ordinary element/);
    deleted.delete();
    assert.throws(() => deleted.listen.host.onClick("deck.advance", unreadInput), /ordinary element/);
    const missing = page.at(first);
    assert.deepEqual(descriptors(map), []);
    map.restore(saved);
    assert.deepEqual(map.capture(), saved);
    assert_subjects(map, [pathId, quadId], 0);
    assert.equal("listen" in missing, false);
    assert.deepEqual(coordinate.snap(), page.at(first).snap());
    assert.ok(coordinate_listener<string>(page.at(first)));
  }

  {
    const map = hsonLiveMap.fromLibraries({ page: { document: source }, state: { json: { count: 0 } } });
    const page = map.doc.must("page"), state = map.data.must("state").at(["count"]);
    const unnamed = page.at(second).asElement()!;
    const id = unnamed.listen.local.onClick("unnamed", reflectingInput(() => state.set(1)));
    assert.equal(state.snap(), 1);
    assert_subjects(map, [id], 1);
    const parent = page.at([1, 0]).asElement()!;
    const keyedId = page.at(first).asElement()!.listen.local.onClick("moving", reflectingInput(() => parent.move(0, 1)));
    assert.equal(page.q("selected")?.path().at(-1), 1);
    assert.deepEqual(descriptors(map).map(record => record.get("subject")?.materialize()), [
      { library: "page", path: structural(0) }, { library: "page", path: structural(1) },
    ]);
    assert.throws(() => page.at(first).asElement()!.listen.local.onClick("replaced",
      reflectingInput(() => page.at(first).replace("text"))), /subject changed/);
    assert_subjects(map, [keyedId], 1);
    const text = page.at(first).asText()!;
    assert.equal(Reflect.get(text, "listen"), undefined);
    page.at(first).replace({ $_tag: "button", $_content: [] });
    assert.equal(Reflect.get(text, "listen"), undefined);
    const fresh = page.at(first).asElement()!;
    assert.equal(typeof fresh.listen.local.onClick("new", exact), "string");
    assert.throws(() => fresh.listen.host.onClick("deck.advance", reflectingInput(() => {
      fresh.replace({ $_tag: "span", $_content: [] });
    })), /subject changed/);
    assert_subjects(map, [keyedId], 1);
  }

  const map = hsonLiveMap.fromLibraries({ page: { document: source }, state: { json: { count: 0 } } });
  const entered = deferred(), released = deferred();
  const actionEntered = deferred(), actionReleased = deferred();
  let gate: (() => void | Promise<void>) | undefined = () => { entered.resolve(); return released.promise; };
  let inspected = false;
  const { locus } = create_registry_locus_internal({ map,
    libraries: [{ name: "page", ownership: "shared" }, { name: "state", ownership: "shared" },
      { name: "panel", ownership: "local", initializer: { document: '<main <button @:button "Label"/> <button id="unnamed"/>/>' } },
      { name: "ui", ownership: "local", initializer: { json: { count: 0 } } }],
    authorizeProjection: ({ requested }) => ({ ...requested, writableDocuments: ["page"] }),
    actions: { inspect(ctx) {
      const page = ctx.doc.must("page");
      assert.equal("listen" in page.at(second).asElement()!, false);
      assert.equal("listen" in page.q("selected")!, false);
      inspected = true;
    }, async hold() {
      actionEntered.resolve();
      await actionReleased.promise;
    } },
  }, { scopedDocuments: "auto", gate: () => gate?.() });
  const binding = bind_locus_http(locus, { endpoint: "/listen" });
  const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://listen.test/listen",
    fetch: (input, init) => binding.handle(new Request(input, init), {}) });
  try {
    const page = locus.doc.must("page"), coordinate = page.at(first), at = coordinate.asElement()!, quad = page.q("selected")!;
    let accepted: string | undefined;
    const pending = coordinate_listener<Promise<string>>(coordinate).local.onClick("panel.toggle", exact)
      .then(id => { accepted = id; return id; });
    await Promise.race([entered.promise, pending.then(() => assert.fail("Listener accepted before the gate released"))]);
    assert.equal(accepted, undefined);
    assert.deepEqual(descriptors(map), []);
    released.resolve();
    const firstId = await pending;
    assert_subjects(map, [firstId], 0);
    gate = () => { throw new Error("Rejected listener submission"); };
    await assert.rejects(quad.listen.host.onClick("deck.advance", exact), /Rejected listener submission/);
    assert_subjects(map, [firstId], 0);
    gate = undefined;

    const moved = page.at([1, 0]).asElement()!.move(0, 1);
    const fromQuad = quad.listen.host.onClick("deck.advance", exact);
    const fromPath = at.listen.local.onClick("panel.toggle", exact);
    const stale = assert.rejects(page.at(second).asElement()!.listen.local.onClick("panel.toggle", exact), /subject changed/);
    const [quadId, pathId] = await Promise.all([fromQuad, fromPath, moved, stale]);
    const ids = [firstId, quadId, pathId];
    assert.equal(new Set(ids).size, 3);
    const records = assert_subjects(map, ids, 1);
    assert.equal(records[1]?.get("kind")?.scalar(), "locus");
    assert.ok(records[1]?.get("payload")?.equals(exact));
    let nested: Promise<void> | undefined;
    await locus.stage(stage => {
      assert.equal("listen" in stage.doc.must("page").at(second).asElement(), false);
      nested = assert.rejects(quad.listen.host.onClick("deck.advance", exact), /active stage/);
    });
    await nested;
    assert_subjects(map, ids, 1);
    assert.equal((await locus.actions.trigger("inspect", null)).type, "ack");
    assert.equal(inspected, true);

    const action = locus.actions.trigger("hold", null);
    await actionEntered.promise;
    const update = locus.data.must("state").at(["count"]).replace(1);
    const independent = page.at(first).asElement()!.listen.local.onClick("unnamed", exact);
    assert_subjects(map, ids, 1);
    actionReleased.resolve();
    assert.equal((await action).type, "ack");
    await update;
    const unnamedId = await independent;
    assert.equal(map.data.must("state").at(["count"]).snap(), 1);
    assert.deepEqual(descriptors(map).at(-1)?.get("subject")?.materialize(), { library: "page", path: structural(0) });
    const textCoordinate = page.at(first);
    const turnedText = textCoordinate.asElement()!;
    await page.at(first).replace("text");
    const invalid = turnedText.listen.local.onClick("panel.toggle", unreadInput);
    assert.ok(invalid instanceof Promise);
    await assert.rejects(invalid, /ordinary element/);
    const invalidCoordinate = coordinate_listener<Promise<string>>(textCoordinate).local.onClick("panel.toggle", unreadInput);
    assert.ok(invalidCoordinate instanceof Promise);
    await assert.rejects(invalidCoordinate, /ordinary element/);
    assert_subjects(map, ids, 1);
    const plainText = page.at(first);
    const retainedText = plainText.asText()!;
    await page.at(first).replace({ $_tag: "button", $_content: [] });
    assert.equal(Reflect.get(retainedText, "listen"), undefined);
    assert.equal("listen" in plainText, false);
    assert.ok(coordinate_listener<Promise<string>>(page.at(first)));
    assert.equal(descriptors(map).some(record => record.get("id")?.scalar() === unnamedId), false);
    await page.at(first).asElement()!.insert(0, { $_tag: "span", $_content: [] });
    const childPath = [...first, 0];
    const child = page.at(childPath).asElement()!;
    const replacement = child.replace({ $_tag: "em", $_content: [] });
    await Promise.all([replacement, assert.rejects(child.listen.host.onClick("deck.advance", exact), /subject changed/)]);
    const deletedCoordinate = page.at(childPath);
    const deleted = deletedCoordinate.asElement()!;
    await deleted.delete();
    await assert.rejects(deleted.listen.host.onClick("deck.advance", unreadInput), /ordinary element/);
    const missingCoordinate = coordinate_listener<Promise<string>>(deletedCoordinate).host.onClick("deck.advance", unreadInput);
    assert.ok(missingCoordinate instanceof Promise);
    await assert.rejects(missingCoordinate, /ordinary element/);
    assert_subjects(map, ids, 1);

    const session = await locus.session.create({ libraries: ["page", "panel", "state", "ui"], systemFeatures: ["interactions"] });
    const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport });
    try {
      const projected = echo.doc.must("page"), panel = echo.doc.must("panel");
      assert.equal("listen" in projected.at(second).asElement()!, false);
      assert.equal("listen" in projected.q("selected")!, false);
      if (panel.source !== "client-local") throw new Error("Expected a client-local panel.");
      const client = echo_map_internal(echo);
      const earlier = client.capture();
      const observed = deferred();
      const beforeReplay = echo.rev;
      const replayPublications: number[] = [];
      let behavior: ReturnType<LiveMap["behaviors"]["trigger"]> | undefined;
      let localId: string | undefined;
      let retained: LiveMap | undefined;
      client.behaviors.define("observeReplay", ({ map: receiver }) => {
        retained = receiver;
        const selected = receiver.doc.must("page").q("selected")!;
        assert.throws(() => selected.listen.local.onClick("shared", exact), /authority/);
        assert.throws(() => add_interaction(receiver, {
          id: "shared", subject: { library: "page", path: structural(1) }, kind: "browser", key: "shared", args: exact,
          listener: { event: "click", target: "element", capture: false, once: false, passive: false,
            missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false },
        }), /authority/);
        assert.throws(() => remove_interaction(receiver, ids[0]!), /authority/);
        assert.throws(() => receiver.data.must("state").at(["count"]).replace(99), /authority/);
        assert.throws(() => selected.attrs.set("title", "forbidden"), /authority/);
        assert.throws(() => receiver.restore(earlier), /authority/);
        // Inspect the callback's execution authority independently of the public write guards.
        const aggregate = internal_livemap_aggregate_authority(receiver);
        const target = aggregate.systemTarget(require_interaction_system_internal(aggregate), ["descriptors"]);
        assert.throws(() => {
          const candidate = aggregate.prepare([{ target, kind: "interaction", edit: current => {
            assert.ok(Array.isArray(current));
            return ordered_projected_array(current.slice(1));
          } }]);
          aggregate.discard(candidate);
        }, /Shared canonical interactions require Locus/);
        receiver.data.must("ui").at(["count"]).set(1);
        receiver.doc.must("panel").q("button")!.attrs.set("title", "local");
        localId = coordinate_listener<string>(panel.at(second)).local.onClick("panel.toggle", exact);
        assert.deepEqual(descriptors(receiver).map(record => record.get("id")?.scalar()), [...ids, localId]);
      });
      const stop = echo.commits.observe(() => {
        stop();
        behavior = client.behaviors.trigger("observeReplay");
        observed.resolve();
      });
      const stopPublications = echo.commits.observe(commit => replayPublications.push(commit.rev));
      try {
        await locus.data.must("state").at(["count"]).replace(2);
        await observed.promise;
        assert.deepEqual(await behavior, { ok: true });
        assert.deepEqual(replayPublications, [beforeReplay + 1, beforeReplay + 2, beforeReplay + 3, beforeReplay + 4]);
      } finally {
        stop();
        stopPublications();
      }
      assert.equal(echo.data.must("state").at(["count"]).snap(), 2);
      assert.equal(echo.data.must("ui").at(["count"]).snap(), 1);
      assert.equal(panel.q("button")!.attrs.get("title"), "local");
      assert.equal(typeof localId, "string");
      const revision = locus.rev, cursor = echo.sync.appliedRev;
      const button = panel.q("button")!;
      let reflected = false;
      const invalidInput = reflectingInput(() => { reflected = true; });
      assert.throws(() => button.at([99]).listen.host.onClick("deck.advance", invalidInput), /outside/);
      const disposed = panel.q("button")!;
      disposed.dispose();
      assert.throws(() => disposed.listen.host.onClick("deck.advance", invalidInput), /no longer active/);
      assert.equal(reflected, false);
      const child = panel.at([...first, 0]);
      const retainedLocalText = child.asText()!;
      child.replace({ $_tag: "span", $_content: [] });
      assert.equal(Reflect.get(retainedLocalText, "listen"), undefined);
      assert.equal("listen" in child, false);
      const replaced = child.asElement()!;
      assert.throws(() => replaced.listen.host.onClick("deck.advance", reflectingInput(() => {
        child.replace({ $_tag: "em", $_content: [] });
      })), /subject changed/);
      const textCoordinate = panel.at([...first, 0]);
      const turnedText = textCoordinate.asElement()!;
      child.replace("Label");
      assert.throws(() => turnedText.listen.local.onClick("panel.toggle", unreadInput), /ordinary element/);
      assert.throws(() => coordinate_listener<string>(textCoordinate).local.onClick("panel.toggle", unreadInput), /ordinary element/);
      child.replace({ $_tag: "span", $_content: [] });
      const deletedCoordinate = panel.at([...first, 0]);
      const deleted = deletedCoordinate.asElement()!;
      deleted.delete();
      assert.throws(() => deleted.listen.host.onClick("deck.advance", unreadInput), /ordinary element/);
      assert.throws(() => coordinate_listener<string>(deletedCoordinate).host.onClick("deck.advance", unreadInput), /outside/);
      const hostId = button.listen.host.onClick("deck.advance", reflectingInput(() => panel.at([1, 0]).asElement()!.move(0, 1)));
      assert.equal(locus.rev, revision);
      assert.equal(echo.sync.appliedRev, cursor);
      assert_subjects(map, ids, 1);
      const owned = descriptors(client);
      assert.deepEqual(owned.map(record => record.get("id")?.scalar()), [...ids, localId, hostId]);
      assert.deepEqual(owned.slice(-2).map(record => record.get("subject")?.materialize()), [
        { library: "panel", path: structural(0) }, { library: "panel", path: structural(1) },
      ]);
      const replayed = deferred();
      const stopReplay = echo.commits.observe(() => replayed.resolve());
      try {
        const sharedId = await quad.listen.host.onClick("deck.advance", exact);
        await replayed.promise;
        assert_subjects(map, [...ids, sharedId], 1);
        assert.deepEqual(descriptors(client).map(record => record.get("id")?.scalar()), [...ids, sharedId, localId, hostId]);
        assert.equal(echo.sync.appliedRev, locus.rev);
      } finally { stopReplay(); }
      await projected.at(second).asElement()!.attrs.set("title", "accepted");
      assert.equal(projected.q("selected")!.attrs.get("title"), "accepted");
      const latest = client.capture();
      assert.notDeepEqual(latest, earlier);

      const receiver = retained;
      assert.ok(receiver);
      echo.session.dispose();
      assert.equal(echo.session.status, "disposed");
      const aggregate = internal_livemap_aggregate_authority(receiver);
      const projection = aggregate.clientProjection();
      let restores = 0;
      const stopRestores = aggregate.observeRestore(() => { restores++; });
      try {
        assert.throws(() => receiver.restore(earlier), /Echo authority/);
        assert.throws(() => receiver.addLibraries({ extra: { json: false } }), /Echo authority/);
        assert.throws(() => receiver.data.must("state").at(["count"]).set(99), /authority/);
        assert.throws(() => remove_interaction(receiver, ids[0]!), /authority/);
        assert.deepEqual(receiver.capture(), latest);
        assert.deepEqual(aggregate.clientProjection(), projection);
        assert.equal(restores, 0);
      } finally { stopRestores(); }
      const localAfterDisposal = receiver.doc.must("panel").q("button")!.listen.local.onClick("panel.toggle", exact);
      assert.equal(descriptors(receiver).at(-1)?.get("id")?.scalar(), localAfterDisposal);
      remove_interaction(receiver, localAfterDisposal);
      assert.equal(echo.sync.appliedRev, locus.rev);
      const input = new Proxy({ captured: true }, { ownKeys(value) { echo.dispose(); return Reflect.ownKeys(value); } });
      assert.throws(() => panel.q("button")!.listen.local.onClick("panel.toggle", input), /Disposed Echo authority/);
      assert.equal(descriptors(client).length, 6);
    } finally { echo.dispose(); }
  } finally { released.resolve(); actionReleased.resolve(); transport.dispose(); binding.dispose(); locus.dispose(); }
}
