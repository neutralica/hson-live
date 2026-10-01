import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "continuation.scout-entrypoint",
  title: "Scout browser entrypoint isolation and registration",
  category: "Continuation",
  runtime: "node",
  tags: Object.freeze(["scout", "entrypoints", "browser-isolation"]),
});

const events = create_test_event_emitter("continuation.scout-entrypoint");
const repositoryRoot = resolve(import.meta.dirname, "..");

function case_run(name: string, source: string): void {
  events.case_begin(name, name);
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source],
    { cwd: repositoryRoot, encoding: "utf8" });
  try {
    assert.equal(child.status, 0, `${name}: ${child.stderr || child.stdout}`);
    events.case_end(name, "pass");
  } catch (cause) {
    events.case_end(name, "fail");
    events.terminal("fail");
    throw cause;
  }
}

case_run("ordinary Node entrypoints do not register Scout", `
  globalThis.HTMLElement = class HTMLElement {};
  globalThis.customElements = {
    get() { throw new Error("Scout registry was read"); },
    define() { throw new Error("Scout registry was changed"); },
  };
  await import("hson-live");
  await import("hson-live/transform");
  await import("hson-live/locus");
  await import("hson-live/ssr");
`);

case_run("Scout subpath imports safely in Node without registering browser state", `
  const api = await import("hson-live/scout");
  if (Object.keys(api).join(",") !== "configure_scout") throw new Error("Unexpected Scout exports");
  if (typeof api.configure_scout !== "function") throw new Error("Scout provider API missing");
`);

case_run("one module registration defines once and duplicate import reuses it", `
  const definitions = new Map();
  let calls = 0;
  globalThis.HTMLElement = class HTMLElement {};
  globalThis.customElements = {
    get(name) { return definitions.get(name); },
    define(name, constructor) { calls += 1; definitions.set(name, constructor); },
  };
  await import("hson-live/scout");
  await import("hson-live/scout");
  if (calls !== 1 || typeof definitions.get("hson-scout") !== "function") {
    throw new Error("Scout registration was not one-shot");
  }
`);

case_run("foreign custom-element ownership fails explicitly", `
  globalThis.HTMLElement = class HTMLElement {};
  globalThis.customElements = { get() { return class ForeignScout {}; }, define() { throw new Error("define called"); } };
  try {
    await import("hson-live/scout");
    throw new Error("Foreign definition was accepted");
  } catch (cause) {
    if (!String(cause).includes("incompatible hson-scout")) throw cause;
  }
`);

const fakeBrowser = `
  const definitions = new Map();
  globalThis.HTMLElement = class HTMLElement {
    constructor() {
      this.isConnected = false;
      this.ownerDocument = undefined;
      this.attributes = [{ name: "hidden", value: "" }];
      this.childNodes = [];
      this.removals = 0;
    }
    getAttribute(name) { return name === "hidden" ? "" : null; }
    remove() {
      this.isConnected = false;
      this.removals += 1;
      this.disconnectedCallback?.();
    }
  };
  globalThis.customElements = {
    get(name) { return definitions.get(name); },
    define(name, constructor) { definitions.set(name, constructor); },
  };
  const { configure_scout } = await import("hson-live/scout");
  const Scout = definitions.get("hson-scout");
  function connect(doc, element = new Scout()) {
    element.ownerDocument = doc;
    element.isConnected = true;
    element.connectedCallback();
    return element;
  }
`;

case_run("removed waiting Scout releases its claim for a replacement", `
  ${fakeBrowser}
  const doc = {};
  const first = connect(doc);
  const loser = connect(doc);
  first.remove();
  await Promise.resolve();
  let calls = 0;
  configure_scout(() => { calls += 1; return new Promise(() => {}); });
  let secondConfigurationRejected = false;
  try { configure_scout(() => new Promise(() => {})); }
  catch { secondConfigurationRejected = true; }
  const replacement = connect(doc);
  if (calls !== 1 || !replacement.isConnected || first.removals !== 1
    || loser.isConnected || !secondConfigurationRejected) {
    throw new Error("Removed waiting Scout blocked replacement");
  }
`);

case_run("late provider work cannot revive a removed Scout", `
  ${fakeBrowser}
  const doc = {};
  const first = connect(doc);
  let resolveFirst;
  let calls = 0;
  configure_scout(() => {
    calls += 1;
    return calls === 1
      ? new Promise((resolve) => { resolveFirst = resolve; })
      : new Promise(() => {});
  });
  first.remove();
  await Promise.resolve();
  const replacement = connect(doc);
  resolveFirst({ root: { ownerDocument: doc } });
  await Promise.resolve();
  await Promise.resolve();
  if (calls !== 2 || !replacement.isConnected) {
    throw new Error("Stale provider result affected replacement");
  }
`);

case_run("same-document movement keeps one claim and provider call", `
  ${fakeBrowser}
  const doc = {};
  const scout = connect(doc);
  let calls = 0;
  configure_scout(() => { calls += 1; return new Promise(() => {}); });
  scout.remove();
  connect(doc, scout);
  await Promise.resolve();
  if (calls !== 1 || !scout.isConnected) throw new Error("Move duplicated Scout ignition");
`);

case_run("cross-document movement cancels the old claim and makes the moved Scout inert", `
  ${fakeBrowser}
  const firstDocument = {};
  const secondDocument = {};
  const moved = connect(firstDocument);
  let resolveFirst;
  let calls = 0;
  configure_scout(() => {
    calls += 1;
    return calls === 1
      ? new Promise((resolve) => { resolveFirst = resolve; })
      : new Promise(() => {});
  });
  moved.remove();
  moved.ownerDocument = secondDocument;
  moved.adoptedCallback();
  connect(secondDocument, moved);
  resolveFirst({ root: { ownerDocument: secondDocument } });
  await Promise.resolve();
  const freshFirst = connect(firstDocument);
  const freshSecond = connect(secondDocument);
  if (calls !== 2 || !freshFirst.isConnected || !freshSecond.isConnected) {
    throw new Error("Moved Scout claimed its new document or blocked fresh claims");
  }
  freshFirst.remove();
  await Promise.resolve();
  if (calls !== 3) throw new Error("Fresh second-document Scout could not ignite");
`);

case_run("four Scouts leave only one claimant", `
  ${fakeBrowser}
  const doc = {};
  const scouts = Array.from({ length: 4 }, () => connect(doc));
  let calls = 0;
  configure_scout(() => { calls += 1; return new Promise(() => {}); });
  if (calls !== 1 || !scouts[0].isConnected
    || scouts.slice(1).some((scout) => scout.isConnected || scout.removals !== 1)) {
    throw new Error("Duplicate Scouts performed work or remained connected");
  }
`);

events.case_begin("root output has no Scout import", "root output has no Scout import");
assert.doesNotMatch(readFileSync(resolve(repositoryRoot, "dist/index.js"), "utf8"), /api\/scout/);
events.case_end("root output has no Scout import", "pass");
events.terminal("pass");
