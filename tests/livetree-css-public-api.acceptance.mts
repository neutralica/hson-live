import assert from "node:assert/strict";
import { CssManager, hsonLiveTree } from "hson-live/livetree";
import * as livetreeEntrypoint from "hson-live/livetree";
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

const css = CssManager.api();
css.clearAll();

check("owning subpath exports the application CSS owner but no manager implementations", () => {
  assert.equal("CssManager" in livetreeEntrypoint, true);
  assert.equal("CssRuntimeManager" in livetreeEntrypoint, false);
  assert.equal("ContentManager" in livetreeEntrypoint, false);
  for (const name of ["selector_for_quid", "render_css_value", "pseudo_to_suffix", "isLiveTree"]) {
    assert.equal(name in livetreeEntrypoint, false, `${name} leaked from the owning subpath`);
  }
  for (const name of ["invoke", "forRuntime", "apiForRuntime"]) {
    assert.equal(name in CssManager, false, `${name} leaked from the application CSS owner`);
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
    assert.equal(Object.hasOwn(css, name), false, `${name} leaked from CssManager.api()`);
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
process.stdout.write("# LiveTree supported CSS public API checks passed\n");
testEvents.terminal("pass");
