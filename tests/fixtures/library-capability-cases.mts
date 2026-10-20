import assert from "node:assert/strict";
import { Hson, hsonTransform, hsonLiveMap, hsonLiveHost, type LocusWebSocketLike, type HsonSchema } from "hson-live";
import { bind_locus_websocket } from "hson-live/locus";
import { test_echo_transport } from "../helpers/public-echo-websocket-transport.mts";

import { DeckSchema, firstSchema as PageSchema } from "./hson-schema-document/out/deck.js";
const page = '<html <head/> <body <button/>/>/>';
function sockets() {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const endpoint = (input: Set<(raw: string) => void>, output: Set<(raw: string) => void>): LocusWebSocketLike => ({
    send(raw) { for (const listener of output) listener(raw); }, close() {},
    onMessage(listener) { input.add(listener); return () => { input.delete(listener); }; },
    onClose() { return () => {}; },
  });
  return { client: endpoint(clientMessages, serverMessages), server: endpoint(serverMessages, clientMessages) };
}
function element(source: string) {
  const node = hsonTransform.fromHson(source).toNode().$_content[0];
  if (typeof node !== "object" || node === null) throw Error("Expected element");
  return node;
}
export async function library_capability_cases() {
  const empty = hsonLiveMap.create();
  const admitted = empty.addLibraries({ page: { document: "<main/>" } });
  assert.equal(admitted.commit.changed, true);
  assert.equal(Object.getPrototypeOf(admitted.libraries), null);
  assert.equal(Object.isFrozen(admitted.libraries), true);
  assert.equal(admitted.libraries.page.render(), "<main></main>");
  assert.equal(admitted.libraries.page, empty.doc.must("page"));
  assert.throws(() => empty.addLibraries({ page: { document: "<aside/>" } }));
  assert.equal(empty.rev, 1);
  const direct = hsonLiveMap.fromLibraries({ page: { document: page, schema: PageSchema } });
  const batch = hsonLiveMap.fromLibraries({ page: { document: page, schema: PageSchema } });
  direct.doc.must("page").at([1, 0]).asElement()!.attrs.set("title", "button");
  batch.batch(w => { w.doc.must("page").at([1, 0]).asElement().attrs.set("title", "button"); });
  assert.equal(batch.doc.must("page").render(), direct.doc.must("page").render());
  const simple = hsonLiveMap.fromLibraries({ page: { document: '<main <button/>/>' } });
  simple.batch(w => { w.doc.must("page").at([0]).asElement().attrs.set("title", "button"); });
  assert.equal(simple.doc.must("page").render(), '<main><button title="button"></button></main>');
  batch.batch(w => {
    w.doc.must("page").at([1]).insert(0, element("<i/>"));
    w.doc.must("page").at([1, 1]).asElement().attrs.set("moved", true);
    w.doc.must("page").at([1]).move(1, 0);
    w.doc.must("page").at([1, 1]).asElement().attrs.set("inserted", true);
  });
  assert.match(batch.doc.must("page").render(), /<button moved="" title="button"><\/button><i inserted=""><\/i>/);
  const before = batch.doc.must("page").render(), rev = batch.rev;
  assert.throws(() => batch.batch(w => {
    w.doc.must("page").at([1, 0]).delete();
    w.doc.must("page").at([1, 99]).asElement().attrs.set("invalid", true);
  }));
  assert.equal(batch.doc.must("page").render(), before); assert.equal(batch.rev, rev);

  const locus = hsonLiveMap.locus.create({ "page": { document: page, schema: PageSchema, access: "shared" } }, { local: [{ name: "panel", initializer: { document: '<aside/>' } }], authorizeProjection: () => ({ libraries: ["page", "panel"] }) });
  try {
    await locus.admit({ "privatePage": { document: "<aside/>", access: "private" } });
    assert.equal(locus.doc.must("privatePage").render(), "<aside></aside>");
    await assert.rejects(locus.admit({ "privatePage": { data: 1, access: "shared" } }));
    await locus.stage(w => { w.doc.must("page").at([1, 0]).asElement().attrs.set("title", "button"); });
    const selected = locus.doc.must("page");
    if (selected.mode !== "document") throw Error("Expected document");
    assert.equal(selected.render(), direct.doc.must("page").render());
    const session = await locus.session.create({ libraries: ["page", "panel"] });
    const pair = sockets(), detach = bind_locus_websocket(locus, pair.server);
    const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(pair.client) });
    try {
      for (const name of ["page", "panel"]) {
        const library = echo.doc.must(name);
        if (library.mode !== "document") throw Error("Expected document");
        const html = library.render();
        const host = hsonLiveHost.create({ name: "producer" });
        const route = host.GET("/", library.render);
        const response = await route.handle(new Request("https://example.test/"), {
          applicationName: "producer", correlationId: "test", principal: { anonymous: true },
        });
        assert.ok(response instanceof Response);
        assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(await response.text(), html);
      }
    } finally { echo.dispose(); detach(); }
  } finally { locus.dispose(); }
}


export async function collection_capability_cases() {
  const initial = { slides: [{ id: "one", column1: [{ kind: "heading", content: "Title" }] }] };
  const local = hsonLiveMap.fromLibraries({ deck: { data: initial, schema: DeckSchema }, page: { document: page, schema: PageSchema } });
  const slides = local.data.must("deck").at(["slides"]);
  assert.equal("push" in slides, false);
  assert.deepEqual(slides.array.map(slide => slide.id), ["one"]);
  const transformed = slides.array.map(slide => { Reflect.set(slide.column1[0]!, "content", "detached"); return slide.id; });
  assert.deepEqual(transformed, ["one"]);
  assert.equal(slides.snap()[0]!.column1[0]!.content, "Title");
  const once = slides.array.map((slide, index, snapshot) => {
    assert.equal(snapshot.length, 1);
    if (index === 0) slides.array.push({ id: "during-map", column1: [] });
    return slide.id;
  });
  assert.deepEqual(once, ["one"]);
  slides.array.pop();
  local.batch(writer => {
    writer.data.must("deck").at(["slides"]).array.push({ id: "two", column1: [] });
    writer.data.must("deck").at(["slides"]).array.push({ id: "three", column1: [] });
    writer.doc.must("page").at([1, 0]).asElement().attrs.set("title", "mixed");
  });
  assert.deepEqual(slides.array.map(slide => slide.id), ["one", "two", "three"]);
  assert.match(local.doc.must("page").render(), /title="mixed"/);
  const before = local.capture();
  assert.throws(() => local.batch(writer => {
    writer.data.must("deck").at(["slides"]).array.push({ id: "four", column1: [] });
    writer.data.must("deck").at(["slides"]).array.remove(999);
  }));
  assert.deepEqual(local.capture(), before);
  assert.throws(() => local.batch(writer => {
    writer.doc.must("page").at([1, 0]).asElement().attrs.set("title", "rejected");
    Reflect.apply(writer.data.must("deck").at(["slides"]).array.push, undefined, [{ id: 9, column1: [] }]);
  }));
  assert.deepEqual(local.capture(), before);
  class InvalidSlide { id = "invalid"; column1 = []; }
  assert.throws(() => local.batch(writer => {
    writer.data.must("deck").at(["slides"]).array.push(new InvalidSlide());
  }), { reasonCode: "UNSUPPORTED_PROTOTYPE" });
  assert.deepEqual(local.capture(), before);
  let expired: (() => void) | undefined;
  local.batch(writer => { const array = writer.data.must("deck").at(["slides"]).array; expired = () => array.clear(); });
  assert.throws(() => expired!(), /expired/i);

  const updates = hsonLiveMap.fromLibraries({ values: { data: [1] } });
  const updatePath = updates.data.must("values").at([]).asArray()!;
  const updateCommit = updatePath.update(snapshot => {
    updatePath.array.push(2);
    assert.deepEqual(snapshot, [1]);
    return [...snapshot, 3];
  });
  assert.equal(updateCommit.changed, true);
  assert.deepEqual(updatePath.snap(), [1, 3], "Local update retains snapshot → callback → set semantics");
  updatePath.array.clear();
  for (const action of [() => updatePath.array.pop(), () => updatePath.array.shift(), () => updatePath.array.first(), () => updatePath.array.at(0)]) assert.throws(action);

  const ordered = hsonLiveMap.fromLibraries({ record: { data: '{"10":10,"2":2,"a":1}' } });
  const object = ordered.data.must("record").at([]).asObject()!.object;
  assert.deepEqual(object.keys(), ["10", "2", "a"]);
  assert.deepEqual(object.entries().map(([key]) => key), ["10", "2", "a"]);
  object.renameKey("10", "first");
  assert.deepEqual(object.keys(), ["first", "2", "a"]);

  type Values = { values: number[]; record: { [key: string]: number }; choice: number[] | { n: number } };
  const schema = Hson.schema`<type "data" content <values <array "number"> record "any" choice "any">>` as HsonSchema<Values, "data">;
  const state = { values: [3, 1, 2], record: { a: 1, b: 2 }, choice: [1] };
  let actionReads = 0;
  const locus = hsonLiveMap.locus.create({ "deck": { data: initial, schema: DeckSchema, access: "shared" }, "state": { data: state, schema, access: "shared" }, "page": { document: page, schema: PageSchema, access: "shared" } }, { local: [{ name: "ui", initializer: { data: { values: [1] } } }], authorizeProjection: () => ({ libraries: ["deck", "state", "page", "ui"] }), authorizeAction: () => false, actions: { inspect(context) {
    const library = context.data.must("state");
    const location = library.at(["values"]).asArray()!;
    assert.equal("push" in location.array, false);
    assert.equal("set" in location, false);
    assert.deepEqual(location.array.map(value => value), [3, 1, 2]);
    assert.equal(location.at([0]).asScalar()!.snap(), 3);
    const document = context.doc.must("page");
    if (document.mode !== "document") throw Error("Expected document");
    assert.equal(document.at([1]).at([0]).asElement()!.attrs.get("title"), undefined);
    assert.equal("set" in document.at([1]).at([0]).asElement()!.attrs, false);
    actionReads++;
  } } });
  const retained = locus.data.must("state").at(["values"]).array;
  try {
    assert.equal((await locus.dispatchAction({ type: "action", id: "inspect", name: "inspect" })).type, "ack");
    assert.equal(actionReads, 1);
    await locus.stage(writer => {
      writer.data.must("deck").at(["slides"]).array.push({ id: "two", column1: [] });
      writer.data.must("deck").at(["slides"]).array.push({ id: "three", column1: [] });
      writer.doc.must("page").at([1, 0]).asElement().attrs.set("title", "mixed");
    });
    assert.deepEqual(locus.data.must("deck").at(["slides"]).array.map(slide => slide.id), ["one", "two", "three"]);
    const revision = locus.rev;
    await assert.rejects(locus.stage(writer => {
      writer.data.must("deck").at(["slides"]).array.clear();
      writer.data.must("state").at(["values"]).array.move(999, 0);
    }));
    assert.equal(locus.rev, revision);
    assert.equal(locus.data.must("deck").at(["slides"]).array.length(), 3);
    const values = locus.data.must("state").at(["values"]).array;
    class InvalidValue { n = 1; }
    const beforeInvalid = locus.rev;
    await assert.rejects(Reflect.apply(values.push, undefined, [new InvalidValue()]), { reasonCode: "UNSUPPORTED_PROTOTYPE" });
    assert.equal(locus.rev, beforeInvalid);
    const pending = [values.push(4), values.push(5)];
    await Promise.all(pending);
    assert.deepEqual(values.toArray(), [3, 1, 2, 4, 5]);
    await values.move(0, 4);
    assert.deepEqual(values.toArray(), [1, 2, 4, 5, 3]);
    await values.sortNumbers("desc");
    await values.splice(1, 2, 9);
    await values.unshiftMany([0, 0]);
    await values.unique();
    await values.reverse();
    await values.removeValue(0);
    await values.replace(0, 8);
    await values.insert(1, 7);
    await values.remove(1);
    assert.deepEqual(values.toArray(), [8, 2, 9, 5]);
    const record = locus.data.must("state").at(["record"]).object;
    await record.renameKey("a", "first");
    await record.setMany({ c: 3, d: 4 });
    await record.deleteMany(["b", "c"]);
    assert.deepEqual(record.entries(), [["first", 1], ["d", 4]]);
    const changing = locus.data.must("state").at(["choice"]);
    const stale = changing.asArray()!;
    await changing.replace({ n: 1 });
    await assert.rejects(stale.array.push(2), /array/i);
    assert.throws(() => stale.array.length(), /array/i);
    await changing.asObject()!.object.setKey("n", 2);

    const session = await locus.session.create({ libraries: ["deck", "state", "page", "ui"] });
    const pair = sockets(), detach = bind_locus_websocket(locus, pair.server);
    const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(pair.client) });
    try {
      const projected = echo.data.must("state"), ui = echo.data.must("ui");
      if (String(projected.mode) === "document" || String(ui.mode) === "document" || ui.source !== "client-local") throw Error("Expected data sources");
      const read = projected.at(["values"]).asArray()!;
      assert.equal("push" in read.array, false);
      assert.deepEqual(read.array.map(value => value), [8, 2, 9, 5]);
      const commit = ui.at(["values"]).asArray()!.array.push(2);
      assert.equal(commit.changed, true);
      assert.deepEqual(ui.at(["values"]).snap(), [1, 2]);
      await values.push(6);
      for (let attempt = 0; attempt < 100 && read.array.length() !== 5; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
      assert.deepEqual(read.array.map(value => value), [8, 2, 9, 5, 6], "Authority collection commands propagate through the public Echo transport");
      const rejected = await echo.action("inspect");
      assert.equal(rejected.type, "error");
      assert.equal(actionReads, 1);
      await session.update({ libraries: ["page", "ui"] });
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.throws(() => read.array.length(), /stale|unknown|revoked|retired|library|authority/i);
    } finally { echo.dispose(); detach(); }
  } finally { locus.dispose(); }
  await assert.rejects(retained.push(1), /disposed|closed|faulted/i);
}

export async function collection_command_parity_cases() {
  type State = { values: number[]; words: string[]; record: { [key: string]: number } };
  const schema = Hson.schema`<type "data" content <values <array "number"> words <array "string"> record "any">>` as HsonSchema<State, "data">;
  const initial = { values: [3, 1, 2, 1], words: ["b", "a"], record: { a: 1, b: 2 } };
  const definition = { data: initial, schema };
  const commands = [
    ["values", "array", "push", [4]], ["values", "array", "pushMany", [[4, 5]]],
    ["values", "array", "unshift", [4]], ["values", "array", "unshiftMany", [[4, 5]]],
    ["values", "array", "pop", []], ["values", "array", "shift", []],
    ["values", "array", "clear", []], ["values", "array", "reverse", []],
    ["values", "array", "sortNumbers", ["desc"]], ["words", "array", "sortStrings", ["asc"]],
    ["values", "array", "splice", [-2, 1, 7]], ["values", "array", "splice", [2]],
    ["values", "array", "insert", [1, 7]], ["values", "array", "remove", [1]],
    ["values", "array", "replace", [1, 7]], ["values", "array", "move", [0, 3]],
    ["values", "array", "unique", []], ["values", "array", "removeValue", [1]],
    ["values", "array", "removeAll", [1]], ["record", "object", "setKey", ["a", 7]],
    ["record", "object", "setMany", [{ a: 7, c: 3 }]], ["record", "object", "clear", []],
    ["record", "object", "deleteKey", ["a"]], ["record", "object", "deleteMany", [["a", "b"]]],
    ["record", "object", "renameKey", ["a", "c"]],
  ] as const;
  for (const [path, namespace, method, args] of commands) {
    const local = hsonLiveMap.fromLibraries({ state: definition });
    const staged = hsonLiveMap.fromLibraries({ state: definition });
    const locus = hsonLiveMap.locus.create({ "state": { ...definition, access: "shared" } });
    const direct = hsonLiveMap.locus.create({ "state": { ...definition, access: "shared" } });
    const invoke = (location: object) => Reflect.apply(Reflect.get(Reflect.get(location, namespace), method), undefined, args);
    try {
      assert.equal(invoke(local.data.must("state").at([path])).changed, true, method);
      const expected = local.data.must("state").at([path]).hson();
      assert.equal(staged.batch(w => { assert.equal(invoke(w.data.must("state").at([path])), undefined); }).changed, true);
      assert.equal(staged.data.must("state").at([path]).hson(), expected, method);
      assert.equal(await locus.stage(w => { assert.equal(invoke(w.data.must("state").at([path])), undefined); }), undefined);
      assert.equal(locus.data.must("state").at([path]).hson(), expected, method);
      const pending = invoke(direct.data.must("state").at([path]));
      assert.ok(pending instanceof Promise);
      assert.equal(await pending, undefined);
      assert.equal(direct.data.must("state").at([path]).hson(), expected, method);
    } finally { locus.dispose(); direct.dispose(); }
  }
}

export async function refinement_repair_cases() {
  for (const present of [false, true]) {
    const definitions: { state: { data: number }; optionalPage?: { document: string } } = { state: { data: 1 } };
    if (present) definitions.optionalPage = { document: "<main/>" };
    const map = hsonLiveMap.create();
    const receipt = map.addLibraries(definitions);
    assert.equal(receipt.commit.changed, true);
    assert.equal(receipt.libraries.state.snap(), 1);
    assert.equal("optionalPage" in receipt.libraries, present);
    if (receipt.libraries.optionalPage) {
      assert.equal(receipt.libraries.optionalPage.render(), "<main></main>");
      assert.equal(receipt.libraries.optionalPage, map.doc.must("optionalPage"));
    }
    else assert.equal(present, false);
    let failedReceipt: unknown;
    assert.throws(() => { failedReceipt = map.addLibraries({ state: { data: 2 } }); });
    assert.equal(failedReceipt, undefined);
    assert.equal(map.rev, 1);
  }

  const definitions = {
    state: { data: { value: 0, record: {}, required: [] } },
    deck: { data: { slides: [{ id: "one", column1: [] }] }, schema: DeckSchema },
  };
  for (const governed of [false, true]) {
    const map = hsonLiveMap.fromLibraries(definitions);
    const locus = hsonLiveMap.locus.create({ "state": { ...definitions.state, access: "shared" }, "deck": { ...definitions.deck, access: "shared" } });
    const selected = governed ? locus : map;
    const state = governed ? locus.data.must("state") : map.data.must("state");
    const deck = governed ? locus.data.must("deck") : map.data.must("deck");
    type Writer = import("hson-live/livemap").LiveMapStagedWriter<typeof map, void>;
    const stage = async (run: (writer: Writer) => void) => {
      if (governed) await locus.stage(run);
      else map.batch(run);
    };
    const snapshot = () => ({ rev: selected.rev, state: state.snap(), deck: deck.snap() });
    const rejects_atomically = async (run: (writer: Writer) => void) => {
      const before = snapshot();
      let commits = 0;
      const stop = selected.commits.observe(() => commits++);
      try { await assert.rejects(stage(run), /array|object|schema/i); } finally { stop(); }
      assert.deepEqual(snapshot(), before);
      assert.equal(commits, 0);
    };
    try {
      // A standalone assertion is required, even with no later mutation.
      await rejects_atomically(w => { w.data.must("state").at(["value"]).asArray(); });
      await rejects_atomically(w => { w.data.must("state").at(["value"]).asObject(); });
      await rejects_atomically(w => { w.data.must("deck").at(["slides", 0, "column2"]).asArray(); });
      await rejects_atomically(w => { w.data.must("deck").at(["slides", 99, "column2"]).asArray(); });
      await rejects_atomically(w => {
        w.data.must("state").at(["value"]).asArray();
        w.data.must("state").at(["value"]).set([]); // A later repair cannot rescue an earlier failed assertion.
      });
      const rev = selected.rev;
      await stage(w => { w.data.must("state").at(["required"]).asArray(); });
      assert.equal(selected.rev, rev, "A successful assertion alone publishes no mutation");

      await stage(w => {
        const value = w.data.must("state").at(["value"]);
        value.set([]);
        const array = value.asArray();
        assert.equal("snap" in array, false);
        assert.equal("map" in Reflect.get(array, "array"), false);
        array.array.push(1);
        array.array.push(2);
        w.data.must("state").at(["record"]).asObject().object.setKey("ready", true);
        const optional = w.data.must("deck").at(["slides", 0, "column2"]);
        w.data.must("deck").at(["slides", 0]).asObject().object.setKey("column2", []);
        optional.asArray().array.push({ kind: "paragraph", content: "first" });
        optional.asArray().array.push({ kind: "paragraph", content: "second" });
      });
      assert.deepEqual(state.at(["value"]).snap(), [1, 2]);
      assert.deepEqual(state.at(["record"]).snap(), { ready: true });
      assert.deepEqual(deck.at(["slides", 0, "column2"]).snap(), [
        { kind: "paragraph", content: "first" }, { kind: "paragraph", content: "second" },
      ]);
      await rejects_atomically(w => {
        w.data.must("state").at(["value"]).asArray().array.push(3);
        w.data.must("state").at(["value"]).replace({ wrong: true });
        w.data.must("state").at(["value"]).asArray();
      });
      await rejects_atomically(w => {
        w.data.must("state").at(["value"]).delete();
        w.data.must("state").at(["value"]).asArray().array.push(3);
      });
      await rejects_atomically(w => {
        const refined = w.data.must("state").at(["value"]).asArray();
        w.data.must("state").at(["value"]).replace(0);
        refined.array.push(3); // A retained command facade must recheck current candidate shape.
      });
      await rejects_atomically(w => {
        w.data.must("state").at(["value"]).asArray().array.push(3);
        const array = w.data.must("deck").at(["slides", 0, "column2"]).asArray().array;
        Reflect.apply(array.push, undefined, [{ kind: "paragraph", content: 123 }]);
      });
      await stage(w => {
        w.data.must("state").at(["value"]).replace({ count: 0 });
        w.data.must("state").at(["value"]).asObject().object.setKey("count", 2);
      });
      assert.deepEqual(state.at(["value"]).snap(), { count: 2 });
      let escapedRefinement: (() => unknown) | undefined;
      let escapedCommand: (() => unknown) | undefined;
      await stage(w => {
        const location = w.data.must("state").at(["required"]);
        escapedRefinement = () => location.asArray();
        const array = location.asArray().array;
        escapedCommand = () => array.push(1);
      });
      assert.throws(() => escapedRefinement!(), /expired/i);
      assert.throws(() => escapedCommand!(), /expired/i);
      if (governed) {
        let blocked: Promise<void> | undefined;
        await locus.stage(w => {
          blocked = assert.rejects(locus.data.must("state").at(["required"]).asArray()!.array.push(99), /forbidden/i);
          w.data.must("state").at(["required"]).asArray().array.push(1);
        });
        await blocked;
        assert.deepEqual(locus.data.must("state").at(["required"]).snap(), [1]);
        await locus.admit({ "admitted": { document: "<aside/>", access: "shared" } });
        assert.equal(locus.doc.must("admitted").render(), "<aside></aside>");
        let failedReceipt: unknown;
        await assert.rejects((async () => { failedReceipt = await locus.admit({ "admitted": { data: 1, access: "shared" } }); })());
        assert.equal(failedReceipt, undefined);
      }
    } finally { locus.dispose(); }
  }
}
