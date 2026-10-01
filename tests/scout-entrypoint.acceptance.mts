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

events.case_begin("root output has no Scout import", "root output has no Scout import");
assert.doesNotMatch(readFileSync(resolve(repositoryRoot, "dist/index.js"), "utf8"), /api\/scout/);
events.case_end("root output has no Scout import", "pass");
events.terminal("pass");
