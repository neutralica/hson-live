import assert from "node:assert/strict";
import { hsonLiveMap, hsonTransform, Hson, type LocusWebSocketLike } from "hson-live";
import { bind_locus_websocket } from "hson-live/locus";
import { test_echo_transport } from "../helpers/public-echo-websocket-transport.mts";
import { PageSchema } from "./hson-schema-document/out/producer.js";
import { firstSchema } from "./hson-schema-document/out/deck.js";

const source = '<main id="page" <section id="nested" <button id="button" title="old" disabled="disabled" keep="value"/>/>/>';
const definition = { document: source };
const node = (source: string) => {
  const value = hsonTransform.fromHson(source).toNode().$_content[0];
  if (typeof value !== "object" || value === null) throw Error("Expected element");
  return value;
};
function sockets() {
  const incoming = new Set<(raw: string) => void>(), outgoing = new Set<(raw: string) => void>();
  const side = (input: typeof incoming, output: typeof incoming): LocusWebSocketLike => ({
    send(raw) { for (const listener of output) listener(raw); }, close() {},
    onMessage(listener) { input.add(listener); return () => { input.delete(listener); }; }, onClose() { return () => {}; },
  });
  return { client: side(incoming, outgoing), server: side(outgoing, incoming) };
}

export async function document_capability_parity_cases() {
  const identities = hsonLiveMap.fromLibraries({ page: { document: '<main @:page <button @:button/> <aside/>/>' } });
  const subject = identities.lib("page").q("button")!;
  subject.attrs.setMany({ title: "kept" });
  identities.lib("page").q("page")!.move(0, 1);
  assert.deepEqual(subject.path(), [1]);
  subject.flags.set("checked");
  assert.equal(subject.attrs.must.get("title"), "kept");
  subject.delete(); assert.equal(subject.active, false);
  assert.throws(() => subject.attrs.setMany({ title: "retired" }));

  const cases = [
    ["attrs", "set", ["title", "next"]], ["attrs", "drop", ["missing"]],
    ["attrs", "setMany", [{ title: "next", extra: true, style: { backgroundColor: "red" } }]],
    ["attrs", "dropMany", [["title", "missing"]]], ["attrs", "clear", []],
    ["attrs", "replace", [{ id: "new", disabled: "disabled" }]],
    ["flags", "set", ["checked", "disabled"]], ["flags", "clear", ["disabled", "keep", "missing"]],
  ] as const;
  for (const [namespace, method, args] of cases) {
    const local = hsonLiveMap.fromLibraries({ page: definition });
    const batched = hsonLiveMap.fromLibraries({ page: definition });
    const direct = hsonLiveMap.locus.create({ shared: [{ name: "page", definition }] });
    const staged = hsonLiveMap.locus.create({ shared: [{ name: "page", definition }] });
    const invoke = (location: object) => Reflect.apply(Reflect.get(Reflect.get(location, namespace), method), undefined, args);
    try {
      invoke(local.lib("page").at([0]).at([0]).asElement()!);
      batched.batch(writer => { assert.equal(invoke(writer.lib("page").at([0]).at([0])), undefined); });
      await invoke(direct.lib("page").at([0]).at([0]).asElement()!);
      await staged.stage(writer => { assert.equal(invoke(writer.lib("page").at([0]).at([0])), undefined); });
      for (const selected of [batched, direct, staged]) {
        const page = selected.lib("page"); if (page.mode !== "document") throw Error("Expected document");
        assert.equal(page.render(), local.lib("page").render(), `${namespace}.${method}`);
        assert.equal(selected.rev, local.rev);
      }
    } finally { direct.dispose(); staged.dispose(); }
  }
  for (const governed of [false, true]) {
    const local = hsonLiveMap.fromLibraries({ page: definition });
    const locus = hsonLiveMap.locus.create({ shared: [{ name: "page", definition }] });
    const selected = governed ? locus : local;
    type Writer = import("hson-live/livemap").LiveMapStagedWriter<typeof local, void>;
    const stage = async (run: (writer: Writer) => void) => { if (governed) await locus.stage(run); else local.batch(run); };
    const page = governed ? locus.lib("page") : local.lib("page");
    let watches = 0, commits = 0;
    const off = page.at([0, 0]).watch(() => watches++), stop = selected.commits.observe(() => commits++);
    try {
      const element = page.at([]).id("button")!.asElement()!;
      assert.deepEqual(element.path(), [0, 0]);
      assert.equal(element.attrs.get("absent"), undefined);
      assert.throws(() => element.attrs.must.get("absent"));
      assert.equal(element.attrs.must.get("title"), "old");
      assert.equal(element.flags.has("disabled"), true);
      assert.equal(element.flags.has("keep"), false);
      assert.equal(page.at([99]).present(), undefined);
      assert.equal(page.at([]).asRoot(), undefined);
      assert.throws(() => Reflect.apply(page.at, page, [[-1]]));
      await stage(writer => {
        const section = writer.lib("page").at([0]).asElement();
        section.insert(0, node('<i id="inserted"/>'));
        const moved = section.at([1]).asElement();
        moved.attrs.setMany({ title: "candidate", added: "one" });
        moved.attrs.setMany({ another: "two" });
        moved.flags.set("checked");
        moved.flags.clear("disabled", "keep");
        moved.attrs.dropMany(["added"]);
        section.move(1, 0);
        section.at([0]).asElement().attrs.setMany({ final: true });
        writer.lib("page").css.rule("button", "button").set.color("red");
        writer.lib("page").css.rule("button", "button").set.backgroundColor("blue");
      });
      const final = page.at([0, 0]).asElement()!;
      assert.equal(final.attrs.get("another"), "two");
      assert.equal(final.attrs.get("keep"), "value");
      assert.equal(final.attrs.has("added"), false);
      assert.equal(final.flags.has("checked"), true);
      assert.equal(final.flags.has("disabled"), false);
      assert.match(page.css.snapshot(), /color:red/);
      assert.match(page.css.snapshot(), /background-color:blue/);
      assert.equal(commits, 1); assert.equal(watches, 1);
      const before = { html: page.root(), css: page.css.snapshot(), rev: selected.rev, commits, watches };
      const reject = async (run: (writer: Writer) => void) => {
        await assert.rejects(stage(run));
        assert.deepEqual({ html: page.root(), css: page.css.snapshot(), rev: selected.rev, commits, watches }, before);
      };
      await reject(writer => {
        writer.lib("page").at([0, 0]).asElement().attrs.clear();
        writer.lib("page").css.clearAll();
        writer.lib("page").at([0, 99]).asElement().flags.set("bad");
      });
      await reject(writer => { writer.lib("page").at([0, 0]).asElement().flags.set("style"); });
      await reject(writer => { writer.lib("page").at([0, 0]).asElement().attrs.setMany({ "$_quid": "forged" }); });
      await reject(writer => { writer.lib("page").at([0, 0]).replace("text"); writer.lib("page").at([0, 0]).asElement(); });
      await reject(writer => { writer.lib("page").at([99]).asElement(); });
      await reject(writer => { writer.lib("page").css.rule("bad", "button").setMany({ color: { bad: "value" } }); });
      await stage(writer => { writer.lib("page").at([0, 0]).asElement(); });
      assert.equal(selected.rev, before.rev);
      let expired: (() => void) | undefined, expiredCss: (() => void) | undefined, expiredShape: (() => void) | undefined;
      await stage(writer => {
        const location = writer.lib("page").at([0, 0]).asElement();
        const rule = writer.lib("page").css.sel("button");
        expired = () => location.flags.clear("checked"); expiredCss = () => rule.set.color("green"); expiredShape = () => location.asElement();
        assert.equal("snap" in location, false); assert.equal("get" in location.attrs, false);
        assert.equal("snapshot" in writer.lib("page").css, false);
      });
      assert.throws(() => expired!(), /expired/i); assert.throws(() => expiredCss!(), /expired/i); assert.throws(() => expiredShape!(), /expired/i);
      if (governed) {
        let forbidden: Promise<void> | undefined;
        await locus.stage(writer => {
          forbidden = assert.rejects(locus.lib("page").at([0, 0]).asElement()!.attrs.clear(), /forbidden/i);
          writer.lib("page").at([0, 0]).asElement().attrs.setMany({ safe: true });
        });
        await forbidden;
      }
    } finally { off(); stop(); locus.dispose(); }
  }
}

export async function document_css_parity_cases() {
  const local = hsonLiveMap.fromLibraries({ page: definition });
  const locus = hsonLiveMap.locus.create({ shared: [{ name: "page", definition }] });
  const direct = local.lib("page").css, governed = locus.lib("page").css;
  const apply = async (run: (css: typeof direct | typeof governed) => unknown) => {
    run(direct); await run(governed); assert.equal(governed.snapshot(), direct.snapshot());
  };
  try {
    await apply(css => css.rule("button", "button").setMany({ color: "red", _hover: { color: "blue" } }));
    await apply(css => css.rule("button", "button").set.var("accent", "green"));
    await apply(css => css.media({ minWidth: 500 }).sel("button").setProp("marginTop", 2));
    await apply(css => css.supports({ display: "grid" }).layer("layout").sel("main").set.display("grid"));
    await apply(css => css.scope("print", "@media print").rule("print", "main").set.color("black"));
    await apply(css => css.var.set("accent", "pink"));
    assert.equal(governed.var.value("accent"), "pink");
    assert.deepEqual(governed.var.list(), direct.var.list());
    await apply(css => css.atProperty.registerMany([{ name: "--angle", syn: "<angle>", init: "0deg" }]));
    assert.deepEqual(governed.atProperty.get("--angle"), direct.atProperty.get("--angle"));
    await apply(css => css.keyframes.setMany([{ name: "spin", steps: { from: { opacity: "0" }, to: { opacity: "1" } } }]));
    assert.deepEqual(governed.keyframes.get("spin"), direct.keyframes.get("spin"));
    await apply(css => css.rule("button", "button").remove("color"));
    await apply(css => css.drop("button"));
    await apply(css => css.atProperty.unregister("--angle"));
    await apply(css => css.keyframes.delete("spin"));
    await apply(css => css.var.remove("accent"));
    await apply(css => css.var.clear());
    await apply(css => css.stylesheet("main { color: purple; }"));
    await apply(css => css.clearAll());
    const revision = locus.rev;
    await governed.drop("absent"); await governed.var.remove("missing"); assert.equal(locus.rev, revision);
    const retained = governed.sel("button"); locus.dispose();
    await assert.rejects(retained.set.color("red"), /disposed|closed|faulted/i);
  } finally { locus.dispose(); }
}

export async function document_read_authority_cases() {
  let inspected = 0;
  const locus = hsonLiveMap.locus.create({ shared: [{ name: "page", definition }],
    local: [{ name: "panel", initializer: { document: '<aside <button id="localButton"/>/>' } }],
    authorizeProjection: () => ({ libraries: ["page", "panel"] }), authorizeAction: () => false,
    actions: { inspect(context) {
      const page = context.lib("page"); if (page.mode !== "document") throw Error("Expected document");
      const selected = page.at([]).id("button")!.asElement()!;
      assert.equal(selected.attrs.must.get("title"), "old"); assert.equal(selected.flags.has("disabled"), true);
      assert.equal("set" in selected.attrs, false); assert.equal("set" in selected.flags, false);
      assert.equal("replace" in selected, false); assert.equal("set" in page.css.var, false);
      assert.equal("register" in page.css.atProperty, false); assert.equal("set" in page.css.keyframes, false);
      assert.equal("replace" in page.document.content, false);
      assert.equal(page.document.flags.has({ kind: "path", path: [0, 0, 0, 0, 0] }, "disabled"), true);
      inspected++;
    } } });
  try {
    assert.equal((await locus.dispatchAction({ type: "action", id: "inspect", name: "inspect" })).type, "ack");
    assert.equal(inspected, 1);
    const dynamic = await locus.addLibraries({ private: [{ name: "dynamic", definition: { document: '<html <head/> <body/>/>', schema: firstSchema } }] });
    await dynamic.libraries.dynamic.at([1]).attrs.setMany({ title: "admitted" });
    assert.equal(dynamic.libraries.dynamic.at([1]).attrs.must.get("title"), "admitted");
    const rev = locus.rev;
    await assert.rejects(dynamic.libraries.dynamic.at([1]).replace(node("<aside/>")));
    assert.equal(locus.rev, rev);
    const session = await locus.session.create({ libraries: ["page", "panel"] });
    const pair = sockets(), detach = bind_locus_websocket(locus, pair.server);
    const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(pair.client) });
    try {
      const projected = echo.lib("page"), local = echo.lib("panel");
      if (projected.mode !== "document" || projected.source !== "authority-projected" || local.mode !== "document" || local.source !== "client-local") throw Error("Expected documents");
      const read = projected.at([0]).at([0]).asElement()!;
      assert.equal(read.flags.has("disabled"), true); assert.equal(read.attrs.must.get("title"), "old");
      assert.equal("clear" in read.flags, false); assert.equal("set" in projected.css.var, false);
      const before = projected.render(), remoteRev = locus.rev;
      await assert.rejects(read.attrs.setMany({ title: "unauthorized" }));
      await assert.rejects(read.flags.set("hidden"));
      assert.equal(projected.render(), before); assert.equal(locus.rev, remoteRev);
      assert.equal(local.q("missing"), undefined, "Local initializers do not fabricate QUAD associations");
      const identity = local.at([]).id("localButton")!.asElement()!;
      identity.attrs.setMany({ title: "local", checked: "checked" });
      assert.equal(identity.flags.has("checked"), true);
      local.at([]).asElement()!.move(0, 0);
      identity.flags.clear("checked");
      local.css.sel("button").set.color("red");
      assert.match(local.css.snapshot(), /color:red/);
      identity.delete(); assert.equal(identity.snap(), undefined);
      assert.throws(() => identity.attrs.clear());
      await session.update({ libraries: ["panel"] });
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.throws(() => read.attrs.must.get("title"), /stale|unknown|revoked|retired|library|authority/i);
      await assert.rejects(read.attrs.clear());
    } finally { echo.dispose(); detach(); }
  } finally { locus.dispose(); }
}

export async function document_echo_submission_cases() {
  const locus = hsonLiveMap.locus.create({ shared: [{ name: "page", definition }],
    authorizeProjection: () => ({ libraries: ["page"], writableDocuments: ["page"] }), authorizeAction: () => true });
  const session = await locus.session.create({ libraries: ["page"] });
  const pair = sockets(), detach = bind_locus_websocket(locus, pair.server);
  const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(pair.client) });
  try {
    const page = echo.lib("page"); if (page.mode !== "document" || page.source !== "authority-projected") throw Error("Expected projected document");
    const selected = page.at([0, 0]).asElement()!;
    let observations = 0;
    const off = selected.watch(() => observations++);
    await selected.attrs.setMany({ title: "accepted", extra: "one" });
    assert.equal(selected.attrs.must.get("title"), "accepted");
    assert.equal(locus.lib("page").at([0, 0]).asElement()!.attrs.get("extra"), "one");
    await selected.attrs.dropMany(["extra", "absent"]);
    assert.equal(selected.attrs.has("extra"), false);
    assert.equal(selected.flags.has("disabled"), true);
    await locus.lib("page").css.var.set("accent", "red");
    for (let turn = 0; turn < 100 && page.css.var.value("accent") !== "red"; turn++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(page.css.var.value("accent"), "red");
    await page.css({ domain: "css", kind: "clear-all" });
    await selected.attrs.clear();
    assert.deepEqual(selected.attrs.keys(), []);
    assert.equal(selected.flags.has("disabled"), false);
    assert.equal(observations, 5, "Document watches include stylesheet commits");
    off();
    await selected.flags.set("checked"); assert.equal(selected.flags.has("checked"), true);
    await page.css.atProperty.register({ name: "--tone", syn: "<color>", init: "red" });
    assert.equal(page.css.atProperty.has("--tone"), true);
    await page.css.keyframes.set({ name: "fade", steps: { from: { opacity: "0" }, to: { opacity: "1" } } });
    assert.equal(page.css.keyframes.has("fade"), true);
    await page.css.keyframes.delete("fade"); await page.css.atProperty.unregister("--tone");
    await page.css.clearAll();
    const target = { kind: "path" as const, path: [0, 0, 0, 0, 0] };
    await page.document.attrs.setMany(target, { title: "target", hidden: "hidden" });
    assert.equal(page.document.attrs.must.get(target, "title"), "target");
    assert.equal(page.document.flags.has(target, "hidden"), true);
    await page.document.attrs.dropMany(target, ["title"]);
    await page.document.attrs.clear(target);
    assert.deepEqual(page.document.attrs.keys(target), []);
  } finally { echo.dispose(); detach(); locus.dispose(); }
}

export async function document_shape_cases() {
  const definition = { document: '<p "one"/> <p "two"/>' };
  const local = hsonLiveMap.fromLibraries({ page: definition });
  const locus = hsonLiveMap.locus.create({ shared: [{ name: "page", definition }] });
  try {
    for (const page of [local.lib("page"), locus.lib("page")]) {
      assert.equal(page.at([]).kind(), "root");
      assert.ok(page.at([]).asRoot()); assert.equal(page.at([]).asElement(), undefined);
      assert.equal(page.at([0]).at([0]).asText()!.snap(), "one");
      await page.at([0]).at([0]).replace("changed");
    }
    assert.deepEqual(locus.lib("page").root(), local.lib("page").root());
    const before = locus.rev;
    await locus.stage(writer => { writer.lib("page").at([]).asRoot(); writer.lib("page").at([0, 0]).asText(); });
    assert.equal(locus.rev, before);
    await assert.rejects(locus.stage(writer => { writer.lib("page").at([0, 0]).asElement(); }));
    await locus.stage(writer => {
      writer.lib("page").at([]).asRoot().insert(0, node('<aside/>'));
      writer.lib("page").at([1]).asElement().attrs.setMany({ shifted: true });
    });
    assert.equal(locus.lib("page").at([1]).asElement()!.attrs.get("shifted"), true);
  } finally { locus.dispose(); }
}


export async function document_schema_atomicity_cases() {
  const definition = { document: '<main id="hero" <section "body"/>/>', schema: PageSchema };
  const local = hsonLiveMap.fromLibraries({ page: definition });
  const locus = hsonLiveMap.locus.create({ shared: [{ name: "page", definition }] });
  try {
    assert.throws(() => local.lib("page").at([]).attrs.clear());
    const before = locus.lib("page").root(), rev = locus.rev;
    let observed = 0;
    const stop = locus.commits.observe(() => observed++);
    await assert.rejects(locus.lib("page").at([]).attrs.clear());
    await assert.rejects(locus.stage(writer => {
      writer.lib("page").at([]).asElement().flags.set("hidden");
      writer.lib("page").at([]).asElement().attrs.clear();
      writer.lib("page").css.var.set("bad", "red");
    }));
    assert.deepEqual(locus.lib("page").root(), before); assert.equal(locus.rev, rev); assert.equal(observed, 0);
    await locus.stage(writer => {
      const attrs = { id: "next", hidden: "hidden" };
      writer.lib("page").at([]).asElement().attrs.clear();
      writer.lib("page").at([]).asElement().attrs.setMany({ id: attrs.id });
      attrs.id = "mutated after capture";
      writer.lib("page").at([]).asElement().flags.set("hidden");
      const css = { color: "red" };
      writer.lib("page").css.sel("main").setMany(css);
      css.color = "blue";
    });
    assert.equal(locus.lib("page").at([]).attrs.must.get("id"), "next");
    assert.equal(locus.lib("page").at([]).flags.has("hidden"), true);
    assert.match(locus.lib("page").css.snapshot(), /color:red/);
    assert.equal(observed, 1);
    stop();
  } finally { locus.dispose(); }
}

export async function document_identity_authority_cases() {
  const definition = { document: '<main @:page <button @:button title="initial"/> <aside/>/>' };
  const locus = hsonLiveMap.locus.create({ shared: [{ name: "page", definition }],
    authorizeProjection: () => ({ libraries: ["page"] }), actions: { inspect(context) {
      const page = context.lib("page"); if (page.mode !== "document") throw Error("Expected document");
      const selected = page.q("button")!;
      assert.equal(selected.attrs.must.get("title"), "moved");
      assert.equal("set" in selected.attrs, false); assert.equal("set" in selected.flags, false);
      assert.equal("delete" in selected, false); assert.equal("q" in selected, false);
    } } });
  try {
    const page = locus.lib("page"), selected = page.q("button")!;
    assert.equal(page.q("absent"), undefined);
    await selected.attrs.setMany({ title: "moved" });
    await page.q("page")!.move(0, 1);
    assert.deepEqual(selected.path(), [1]);
    await selected.flags.set("checked");
    assert.equal(selected.flags.has("checked"), true);
    assert.equal((await locus.dispatchAction({ type: "action", id: "inspect", name: "inspect" })).type, "ack");
    const session = await locus.session.create({ libraries: ["page"] });
    const pair = sockets(), detach = bind_locus_websocket(locus, pair.server);
    const echo = await hsonLiveMap.echo.create({ now: session.now(), credential: session.credential!, transport: test_echo_transport(pair.client) });
    try {
      const projected = echo.lib("page"); if (projected.mode !== "document" || projected.source !== "authority-projected") throw Error("Expected document");
      const read = projected.q("button")!;
      assert.equal(read.attrs.must.get("title"), "moved");
      assert.equal("set" in read.attrs, false); assert.equal("delete" in read, false);
      await selected.delete();
      for (let turn = 0; turn < 100 && read.active; turn++) await new Promise(resolve => setTimeout(resolve, 1));
      assert.equal(read.active, false); assert.equal(selected.active, false);
      assert.equal(read.snap(), undefined); assert.throws(() => read.attrs.must.get("title"));
      const rev = locus.rev;
      await assert.rejects(selected.attrs.setMany({ title: "retired" }));
      assert.equal(locus.rev, rev);
      const captured = page.q("page")!, names = ["absent"];
      Object.defineProperty(names, "0", { get() { captured.dispose(); return "absent"; } });
      await assert.rejects(captured.attrs.dropMany(names));
      assert.equal(locus.rev, rev, "Retirement during command capture cannot publish a write");
      const disposed = page.q("page")!;
      disposed.at([]).dispose();
      assert.equal(disposed.active, false);
      await assert.rejects(disposed.flags.set("hidden"));
    } finally { echo.dispose(); detach(); }
  } finally { locus.dispose(); }
}

export async function document_scoped_guard_cases() {
  const parts = { parts: { button: { kind: "document" as const, document: '<button @:root "part"/>', css: ':scope{color:red}' } } };
  const definition = { document: '<html <head/> <body <hson-part lib="parts" at="button"/>/>/>' };
  const local = hsonLiveMap.fromLibraries({ parts, page: definition });
  const locus = hsonLiveMap.locus.create({ private: [{ name: "parts", definition: parts }], shared: [{ name: "page", definition }] });
  try {
    assert.deepEqual(local.lib("page").root(), locus.lib("page").root());
    assert.equal(local.lib("page").at([1, 0]).asElement()!.kind(), "element");
    for (const governed of [false, true]) {
      const owner = governed ? locus : local;
      const page = governed ? locus.lib("page") : local.lib("page");
      const before = { root: page.root(), css: page.css.snapshot(), rev: owner.rev };
      let observations = 0;
      const stop = owner.commits.observe(() => observations++);
      const runs = governed ? [
        () => locus.lib("page").at([1, 0]).asElement()!.attrs.setMany({ title: "blocked" }),
        () => locus.stage(writer => writer.lib("page").at([1, 0]).asElement().flags.set("hidden")),
        () => locus.lib("page").css.sel("body").setProp("color", "red"),
      ] : [
        () => local.lib("page").at([1, 0]).asElement()!.attrs.setMany({ title: "blocked" }),
        () => local.batch(writer => writer.lib("page").at([1, 0]).asElement().flags.set("hidden")),
        () => local.batch(writer => writer.lib("page").css.sel("body").setProp("color", "red")),
      ];
      for (const run of runs) await assert.rejects(async () => { await run(); }, /scoped/i);
      assert.deepEqual({ root: page.root(), css: page.css.snapshot(), rev: owner.rev }, before);
      assert.equal(observations, 0); stop();
    }
  } finally { locus.dispose(); }
}
