import assert from "node:assert/strict";
import { hsonLiveTree } from "hson-live/livetree";
import { hsonLiveMap } from "hson-live/livemap";
import * as livetreeEntrypoint from "hson-live/livetree";
import { make_branch_from_node } from "../dist/api/livetree/creation/create-branch.js";
import { create_livetree_runtime } from "../src/api/livetree/runtime/livetree-runtime.ts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "livetree.css-public-api",
  title: "LiveTree supported CSS public API",
  category: "LiveTree",
  runtime: "node",
  tags: Object.freeze(["livetree", "css", "public-api", "entrypoints"]),
});

const testEvents = create_test_event_emitter("livetree.css-public-api");

function check(name: string, run: () => void): void {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
}

const owner = hsonLiveTree.fromNode({ $_tag: "main", $_content: [] });
const css = owner.css.global;
if (false) {
  const stylesheetReturn: void = css.stylesheet("body { margin: 0; }");
  void stylesheetReturn;
  // @ts-expect-error A complete stylesheet is runtime-global, not node-scoped.
  owner.css.stylesheet("body { margin: 0; }");
}
css.clearAll();

check("owning subpath exposes LiveTree styling without manager implementations", () => {
  assert.equal("CssManager" in livetreeEntrypoint, false);
  assert.equal("CssRuntimeManager" in livetreeEntrypoint, false);
  assert.equal("ContentManager" in livetreeEntrypoint, false);
  for (const name of ["selector_for_quid", "render_css_value", "pseudo_to_suffix", "isLiveTree"]) {
    assert.equal(name in livetreeEntrypoint, false, `${name} leaked from the owning subpath`);
  }
});

check("published global facade retains rules, selectors, variables, property configuration, and keyframes", () => {
  css.sel("body").set.margin("0");
  css.rule("app-shell", ".app-shell").setMany({ display: "grid", gap: "12px" });
  css.media({ maxWidth: 700 }).sel(".app-shell").set.display("block");
  css.supports({ display: "grid" }).sel(".grid").set.display("grid");
  css.layer("components").sel(".button").set.color("rebeccapurple");
  css.var.set("accent", "rebeccapurple");
  css.atProperty.register(["--phase", "<number>", "0"]);
  css.keyframes.set({
    name: "fade",
    steps: { from: { opacity: "0" }, to: { opacity: "1" } },
  });

  assert.match(css.get("app-shell") ?? "", /display:grid/);
  assert.equal(css.var.value("accent"), "rebeccapurple");
  assert.equal(css.atProperty.get("--phase")?.init, "0");
  assert.equal(css.keyframes.get("fade")?.steps.length, 2);
  assert.match(owner.css.snapshot(), /@property --phase/);
  assert.match(owner.css.snapshot(), /@keyframes fade/);
  assert.match(owner.css.snapshot(), /@media \(max-width: 700px\)/);
});

check("global stylesheet ingress shares the portable parser and source order with document CSS", () => {
  const source = `
    .same { color: red; }
    .same { color: blue; }
    @media (max-width: 600px) { @supports (display: grid) { @layer components { .card { display: grid; } } } }
    @property --phase { syntax: "<number>"; inherits: false; initial-value: 0; }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  `;
  const tree = hsonLiveTree.fromNode({ $_tag: "main", $_content: [] }, { isolated: true });
  const other = hsonLiveTree.fromNode({ $_tag: "main", $_content: [] }, { isolated: true });
  const map = hsonLiveMap.fromLibraries({ page: { document: "<html <head/> <body/>/>" } });
  const before = map.rev;
  tree.css.global.stylesheet(source);
  map.lib("page").css.stylesheet(source);
  assert.equal(map.rev, before + 1);
  assert.equal(tree.css.snapshot(), map.lib("page").css.snapshot());
  assert.deepEqual(tree.css.global.list(), map.lib("page").css.list());
  assert.equal(tree.css.global.atProperty.get("--phase")?.init, "0");
  assert.equal(tree.css.global.keyframes.get("fade")?.steps.length, 2);
  assert.equal(other.css.snapshot(), "");
  tree.css.global.atProperty.register(["--later", "<number>", "1"]);
  map.lib("page").css.atProperty.register(["--later", "<number>", "1"]);
  tree.css.global.keyframes.set({ name: "later", steps: { from: { opacity: "0" }, to: { opacity: "1" } } });
  map.lib("page").css.keyframes.set({ name: "later", steps: { from: { opacity: "0" }, to: { opacity: "1" } } });
  const moreProperties = [["--alpha", "<number>", "0"], ["--beta", "<number>", "1"]] as const;
  tree.css.global.atProperty.registerMany(moreProperties);
  map.lib("page").css.atProperty.registerMany(moreProperties);
  const moreKeyframes = [
    { name: "alpha", steps: { from: { opacity: "0" } } },
    { name: "beta", steps: { to: { opacity: "1" } } },
  ];
  tree.css.global.keyframes.setMany(moreKeyframes);
  map.lib("page").css.keyframes.setMany(moreKeyframes);
  assert.equal(tree.css.snapshot(), map.lib("page").css.snapshot());
  tree.css.global.stylesheet(".late { color: green; }");
  tree.css.global.sel(".structured").set.color("black");
  assert.ok(tree.css.snapshot().indexOf(".late{") < tree.css.snapshot().indexOf(".structured{"));
  const unchanged = tree.css.snapshot();
  for (const empty of ["", "/* only comment */"]) tree.css.global.stylesheet(empty);
  assert.equal(tree.css.snapshot(), unchanged);
  assert.throws(() => tree.css.global.stylesheet(".valid { color: red; } @import url(a.css);"), /@import/);
  assert.equal(tree.css.snapshot(), unchanged);
  assert.equal("stylesheet" in tree.css, false);
  tree.remove();
  other.remove();
});

check("isolated public trees retain separate complete CSS with equal QUIDs", () => {
  // Exact runtime identity for this CSS isolation fixture uses an internal
  // constructor. Public fromNode deliberately refuses the supplied QUID.
  const makeTree = () => make_branch_from_node({
    $_tag: "main", $_meta: { quid: "000000rt1" }, $_content: [],
  }, { runtime: create_livetree_runtime() });
  const left = makeTree();
  const right = makeTree();
  assert.equal(left.quid, right.quid);
  left.css.global.sel(".deck").set.color("red");
  right.css.global.sel(".deck").set.color("blue");
  left.css.set.opacity("0.4");
  right.css.set.opacity("0.8");
  assert.match(left.css.snapshot(), /color:red/);
  assert.doesNotMatch(left.css.snapshot(), /color:blue|0\.8/);
  assert.match(right.css.snapshot(), /color:blue/);
  assert.doesNotMatch(right.css.snapshot(), /color:red|0\.4/);
  left.remove();
  right.remove();
});

check("detached public tree renders every managed CSS component without a DOM", () => {
  assert.equal("document" in globalThis, false);
  const tree = hsonLiveTree.fromNode({ $_tag: "main", $_content: [] }, { isolated: true });
  tree.css.global.sel("body").set.margin("0");
  tree.css.global.media({ maxWidth: 600 }).sel("body").set.margin("1rem");
  tree.css.selector("& > .label").set.color("white");
  tree.css.set.opacity("0.5");
  tree.css.global.atProperty.register(["--phase", "<number>", "0"]);
  tree.css.global.keyframes.set({
    name: "fade", steps: { from: { opacity: "0" }, to: { opacity: "1" } },
  });
  const text = tree.css.snapshot();
  for (const expected of ["body{margin:0;}", "@media (max-width: 600px)", "margin:1rem", ".label", "opacity: 0.5", "@property --phase", "@keyframes fade"]) {
    assert.ok(text.includes(expected), `missing ${expected}`);
  }
  tree.remove();
});

check("fromHson can create an independent headless stylesheet owner", () => {
  const first = hsonLiveTree.fromHson("<main/>", { isolated: true });
  const second = hsonLiveTree.fromHson("<main/>", { isolated: true });
  first.css.global.sel("body").set.margin("0");
  assert.match(first.css.snapshot(), /body\{margin:0;\}/);
  assert.equal(second.css.snapshot(), "");
  first.remove();
  second.remove();
});

check("published tree capabilities retain inline, typed, scoped, selector, variable, and serialization paths", () => {
  const tree = hsonLiveTree.fromNode({ $_tag: "main", $_content: [] });
  tree.style.setMany({ color: "navy", width: { value: 12, unit: "px" } });
  tree.style.var.set("inline-accent", "gold");
  tree.css.setMany({ opacity: { value: 0.5, unit: "_" }, transform: "translateX(1px)" });
  tree.css.var.set("scoped-accent", "teal");
  tree.css.selector("& > .label").set.color("white");
  tree.css.media({ maxWidth: 600 }).set.display("none");
  tree.css.supports({ display: "grid" }).set.display("grid");
  tree.css.layer("components").set.zIndex(2);

  assert.equal(tree.style.get.width(), "12px");
  assert.equal(tree.style.var.value("inline-accent"), "gold");
  assert.equal(tree.css.get.opacity(), "0.5");
  assert.equal(tree.css.var.value("scoped-accent"), "teal");
  assert.equal(tree.css.selector("& > .label").get.color(), "white");
  assert.match(tree.content.markup.outerHTML, /style="[^"]*color: navy/);
  tree.remove();
});

check("application facades do not carry runtime, ownership, or diagnostic hooks", () => {
  const tree = hsonLiveTree.fromNode({ $_tag: "section", $_content: [] });
  for (const name of ["renderAll", "syncNow", "snapshot", "debug_hardReset", "dropByPrefix", "dispose"]) {
    assert.equal(Object.hasOwn(css, name), false, `${name} leaked from tree.css.global`);
  }
  assert.equal(Object.hasOwn(tree.css, "devSnapshot"), false);
  for (const name of ["setOwned", "releaseOwner", "listOwned", "renderOne", "renderAll"]) {
    assert.equal(Object.hasOwn(tree.css.keyframes, name), false, `${name} leaked from tree.css.keyframes`);
  }
  for (const name of ["renderOne", "renderAll"]) {
    assert.equal(Object.hasOwn(tree.css.atProperty, name), false, `${name} leaked from tree.css.atProperty`);
  }
  tree.remove();
});

css.keyframes.delete("fade");
css.atProperty.unregister("--phase");
css.var.clear();
css.clearAll();
owner.remove();
process.stdout.write("# LiveTree supported CSS public API checks passed\n");
testEvents.terminal("pass");
