import assert from "node:assert/strict";
import { Hson, hsonLiveMap, bind_locus_http } from "../../src/index.js";
import { HsonSchema, ANY_DOCUMENT, ANY_DATA } from "../../src/api/schema/hson-schema.js";
import { locus_map_internal, echo_map_internal } from "../../src/internal/governor-maps.js";

const schema = Hson.schema`<type "data" content <count "number">>`;
const same = HsonSchema.fromHson(schema.toHson());
const other = Hson.schema`<type "data">`;
const definitions = { page: { document: '<main "hello"/>' }, state: { data: { count: 1 }, schema },
  components: { parts: { button: { kind: "document" as const, document: '<button/>' } } } };
const collisions = ["must", "then", "toJSON", "name", "length", "call", "apply", "bind", "prototype",
  "constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "caller", "arguments"];

export async function family_selector_cases() {
  const map = hsonLiveMap.fromLibraries(definitions);
  assert.equal("lib" in map, false);
  assert.equal(Object.isFrozen(map), true);
  assert.equal(map.doc.page, map.doc("page")); assert.equal(map.doc.page, map.doc.must("page"));
  assert.equal(map.data.state, map.data("state", same)); assert.equal(map.data.state, map.data.must("state", same));
  assert.equal(map.parts.components, map.parts("components"));
  assert.equal(map.doc.page, map.doc("page", HsonSchema.fromHson(ANY_DOCUMENT.toHson())));
  assert.equal(map.doc("page", schema), undefined);
  assert.equal(map.parts.components, map.parts("components", HsonSchema.fromHson(ANY_DATA.toHson())));
  assert.equal(map.parts("components", schema), undefined);
  assert.equal(map.data("components"), undefined); assert.equal(map.parts("state"), undefined);
  assert.equal(map.doc("state"), undefined); assert.equal(map.data("missing"), undefined);
  assert.throws(() => Reflect.get(map.doc, "state"), /family/);
  assert.throws(() => Reflect.get(map.data, "missing"), /Unknown/);
  assert.throws(() => map.parts.must("state"), /family/);
  assert.equal(map.data("state", other), undefined); assert.throws(() => map.data.must("state", other), /Schema/);
  assert.equal(map.data("state", undefined), map.data.state);
  assert.equal(map.data.state.schema.get(), schema);
  const before = map.capture();
  for (const malformed of [null, {}, Object.create(HsonSchema.prototype), schema.toHson()]) {
    assert.throws(() => Reflect.apply(map.data, undefined, ["state", malformed]), /genuine HsonSchema/);
    assert.throws(() => Reflect.apply(map.data.must, undefined, ["missing", malformed]), /genuine HsonSchema/);
  }
  assert.deepEqual(map.capture(), before);
  assert.throws(() => Reflect.apply(map.doc, undefined, [7]), /string name/);
  const reflected = Reflect.ownKeys(map.doc);
  map.addLibraries(Object.fromEntries(collisions.map(name => [name, { document: '<aside/>' }])));
  for (const name of collisions) {
    assert.equal(map.doc.must(name).render(), '<aside></aside>');
    assert.equal(map.doc(name), map.doc.must(name));
    if (name.startsWith("__") && name !== "__proto__") assert.equal(typeof Reflect.get(map.doc, name), "function");
  }
  assert.equal(await Promise.resolve(map.doc), map.doc);
  assert.equal(Reflect.get(map.doc, "then"), undefined); assert.equal(Reflect.get(map.doc, "toJSON"), undefined);
  assert.equal(JSON.stringify({ selector: map.doc }), '{}');
  assert.deepEqual(Reflect.ownKeys(map.doc), reflected);
  assert.equal(Object.hasOwn(map.doc, "page"), false); assert.equal("page" in map.doc, false);
  assert.equal(map.doc.call(null, "page", undefined), map.doc.page);
  assert.equal(map.doc.apply(null, ["page", undefined]), map.doc.page);
  assert.equal(map.doc.bind(null)("page"), map.doc.page);
  assert.equal(typeof map.doc.name, "string"); assert.equal(typeof map.doc.length, "number");
  map.addLibraries({ later: { data: { count: 4 }, schema } });
  assert.equal(map.data.must("later", same).snap(["count"]), 4);
  const possible: { state?: typeof definitions.state } = {};
  const transient = hsonLiveMap.fromLibraries(possible);
  assert.equal(transient.data("state", schema), undefined);
  transient.addLibraries({ state: { data: { count: 1 }, schema: other } });
  assert.equal(transient.data("state", schema), undefined);
  assert.equal(transient.data("state", other), transient.data.must("state"));


  let expired: (() => unknown)[] = [];
  map.batch(writer => {
    assert.equal("lib" in writer, false);
    assert.equal(writer.doc.page, writer.doc("page")); assert.equal(writer.doc.page, writer.doc.must("page"));
    assert.equal(writer.data.state, writer.data.must("state", same));
    assert.equal(writer.parts.components, writer.parts.must("components"));
    assert.equal("snap" in writer.data.state, false); assert.equal("render" in writer.doc.page, false);
    assert.equal(writer.data("page"), undefined); assert.equal(writer.data("state", other), undefined);
    const state = writer.data.state, page = writer.doc.page;
    expired = [() => writer.data("missing"), () => writer.doc.must("page"), () => state.at([]), () => page.at([])];
    state.at(["count"]).set(2);
  });
  for (const operation of expired) assert.throws(operation, /Expired/);
  assert.equal(map.data.state.snap(["count"]), 2);

  let read: object | undefined;
  const locus = hsonLiveMap.locus.create(Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, { ...definition, access: "shared" as const }])), {
    actions: { inspect: context => {
      const selected = context.data.must("state", same);
      assert.equal(selected, context.data("state")); assert.equal(selected, Reflect.get(context.data, "state"));
      assert.notEqual(selected, locus.data.must("state"));
      assert.equal("set" in selected.at([]), false); assert.equal("use" in selected.schema, false);
      assert.equal(context.doc.must("page"), context.doc("page"));
      assert.equal(context.parts.must("components"), context.parts("components"));
      if (read !== undefined) assert.equal(read, selected);
      read = selected;
      assert.equal(context.data("page"), undefined);
      assert.equal(context.data("state", other), undefined);
      assert.equal(context.stage.data.must("state"), context.stage.data("state"));
    } },
  });
  try {
    assert.equal("lib" in locus, false);
    assert.equal(locus.data.must("state"), locus.data("state", same));
    assert.equal(locus.doc.must("page"), Reflect.get(locus.doc, "page"));
    assert.equal(locus.parts.must("components"), locus.parts("components"));
    assert.notEqual(locus.data.must("state"), locus_map_internal(locus).data.must("state"));
    for (const id of ["one", "two"]) assert.equal((await locus.dispatchAction({ type: "action", id, name: "inspect" })).type, "ack");
    await locus.admit({ "incoming": { data: { count: 9 }, schema, access: "shared" } });
    assert.equal(locus.data.must("incoming", same).snap(["count"]), 9);
    assert.equal(locus.data("incoming", other), undefined);
    await locus.stage(writer => {
      assert.equal(writer.data.must("incoming"), writer.data("incoming", same));
      expired = [() => writer.data("missing"), () => writer.parts.must("components")];
    });
    for (const operation of expired) assert.throws(operation, /Expired/);
  } finally { locus.dispose(); }
}

export async function family_selector_echo_cases() {
  const locus = hsonLiveMap.locus.create(Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, { ...definition, access: "shared" as const }])), {
    local: [{ name: "local", initializer: { data: { count: 3 }, schema } },
      { name: "widgets", initializer: definitions.components }],
    authorizeProjection: () => ({ libraries: ["page", "state", "components", "local", "widgets"] }),
  });
  const session = await locus.session.create({ libraries: ["page", "state", "components", "local", "widgets"] });
  const binding = bind_locus_http(locus, { endpoint: "/selectors" });
  const transport = hsonLiveMap.echo.transport.http({ endpoint: "http://selectors.test/selectors",
    fetch: (input, init) => binding.handle(new Request(input, init), {}) });
  const endpointTransport = hsonLiveMap.echo.transport.http({ endpoint: "http://selectors.test/endpoint",
    fetch: (input, init) => binding.handle(new Request(input, init), {}) });
  const endpoint = hsonLiveMap.echo.create({ transport: endpointTransport });
  assert.equal("doc" in endpoint, false); assert.equal("data" in endpoint, false); assert.equal("parts" in endpoint, false);
  endpoint.dispose(); endpointTransport.dispose();
  const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport });
  try {
    const state = echo.data.must("state", same), page = echo.doc.must("page"), parts = echo.parts.must("components"), local = echo.data.must("local");
    assert.equal("lib" in echo, false);
    assert.equal(state, echo.data("state")); assert.equal(state, Reflect.get(echo.data, "state"));
    assert.equal(page, echo.doc("page")); assert.equal(parts, echo.parts("components"));
    assert.equal(echo.data("components"), undefined); assert.equal(echo.doc("state"), undefined);
    assert.equal(echo.data("state", other), undefined); assert.throws(() => echo.data.must("state", other), /Schema/);
    const rawMap = echo_map_internal(echo), rawState = rawMap.data.must("state"), rawPage = rawMap.doc.must("page");
    assert.notEqual(state, rawState);
    assert.equal(state.source, "authority-projected"); assert.equal(local.source, "client-local");
    assert.equal("set" in state.at([]), false); assert.equal("set" in local.at([]), true);
    const widgets = echo.parts.must("widgets", ANY_DATA);
    assert.equal(widgets, echo.parts("widgets", ANY_DATA));
    assert.equal(widgets.source, "client-local"); assert.equal(parts.source, "authority-projected");
    assert.equal("set" in parts.at([]), false);
    assert.equal(parts.at(["button", "document"]).snap(), "<button/>");
    if (widgets.source === "client-local") {
      widgets.at(["button", "document"]).set('<button "local"/>');
      assert.equal(widgets.at(["button", "document"]).snap(), '<button "local"/>');
      widgets.at([]).asObject()?.object.setKey("extra", { kind: "document", document: "<aside/>" });
      assert.equal(widgets.at(["extra", "document"]).snap(), "<aside/>");
      widgets.at(["extra"]).delete();
      assert.equal(widgets.at(["extra"]).snap(), undefined);
      const before = widgets.snap();
      // Exercise runtime governance through reflection: declarations intentionally omit use.
      assert.throws(() => Reflect.apply(Reflect.get(widgets.schema, "use"), widgets.schema, [ANY_DATA]), /Part collections do not support supplemental Schema attachment/);
      assert.deepEqual(widgets.snap(), before);
    }

    const oldLocation = state.at(["count"]);
    await session.update({ libraries: ["local"] });
    await until(() => echo.data("state") === undefined);
    assert.equal(echo.data("state"), undefined); assert.equal(echo.doc("page"), undefined);
    assert.throws(() => state.snap()); assert.throws(() => oldLocation.snap()); assert.throws(() => state.rev);
    assert.throws(() => page.render()); assert.throws(() => parts.snap());
    assert.equal(rawMap.data("state"), undefined); assert.equal(rawMap.doc("page"), undefined);
    assert.throws(() => rawState.snap()); assert.throws(() => rawState.rev); assert.throws(() => rawPage.render());
    await session.update({ libraries: ["page", "state", "components", "local", "widgets"] });
    await until(() => echo.data("state") !== undefined);
    assert.notEqual(echo.data.must("state"), state); assert.notEqual(echo.doc.must("page"), page);
    assert.notEqual(echo.parts.must("components"), parts); assert.equal(echo.data.must("local"), local);
    assert.notEqual(rawMap.data.must("state"), rawState); assert.notEqual(rawMap.doc.must("page"), rawPage);
    assert.throws(() => rawState.snap()); assert.throws(() => rawPage.render());
    assert.throws(() => state.snap()); assert.throws(() => page.render());
    assert.equal(echo.data.must("state", same).snap(["count"]), 1);
    assert.equal(session.revoke(), true);
    echo.disconnect();
    await until(() => echo.session.status !== "attached");
    await assert.rejects(echo.session.reattach());
  } finally { echo.dispose(); transport.dispose(); binding.dispose(); locus.dispose(); }
}

async function until(test: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (test()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("Echo did not apply the selector binding transition");
}
