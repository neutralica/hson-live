import assert from "node:assert/strict";
import { hsonLiveMap } from "../src/index.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";

const map = hsonLiveMap.fromLibraries({
  page: { document: "<main/>" },
  second: { document: "<aside/>" },
  state: { data: { value: 1 } },
});
assert.equal(map.lib("page").render(), "<main></main>");
assert.equal(map.lib("second").render(), "<aside></aside>");
assert.equal(map.lib("page").render(), map.cut({ html: "page" }).html);
assert.equal("render" in map.lib("state"), false);
assert.equal(map.rev, 0);

// Instrument the owned roots only after admission, so first-use selection is measured.
const local = hsonLiveMap.fromLibraries({
  page: { document: "<main/>" },
  second: { document: "<main/>" },
  state: { data: 1 },
  largeDocument: { document: `<aside "${"x".repeat(5 * 1024 * 1024)}"/>` },
  largeData: { data: { payload: "y".repeat(5 * 1024 * 1024) } },
});
const authority = internal_livemap_aggregate_authority(local);
let unrelatedReads = 0;
const restore = authority.libraries().slice(3).map(identity => {
  const root = authority.root(identity);
  const descriptor = Object.getOwnPropertyDescriptor(root, "$_content");
  assert.ok(descriptor);
  const content = root.$_content;
  Object.defineProperty(root, "$_content", {
    configurable: true,
    get() { unrelatedReads += 1; return content; },
  });
  return () => { Object.defineProperty(root, "$_content", descriptor); };
});
try {
  const page = local.lib("page");
  assert.equal(page.render(), "<main></main>");
  assert.equal(local.lib("second").render(), page.render());
  assert.equal(local.lib("page"), page);
  assert.equal(local.lib("state").snap(), 1);
  assert.equal(unrelatedReads, 0, "First document/data selection and rendering must not read unrelated roots.");
} finally {
  for (const reset of restore) reset();
}

// Re-enter during the detached root read, before render reads the stylesheet.
const coherent = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body data-render=before/>/>' } });
const page = coherent.lib("page");
page.css.sel("body").set.color("blue");
const clone = globalThis.structuredClone;
let mutated = false;
globalThis.structuredClone = (value, options) => {
  if (!mutated && typeof value === "object" && value !== null
    && "data-render" in value && value["data-render"] === "before") {
    mutated = true;
    globalThis.structuredClone = clone;
    page.at([]).at([1]).asElement()!.attrs.set("data-render", "after");
    page.css.sel("body").set.color("red");
  }
  return clone(value, options);
};
try {
  assert.throws(() => page.render(), /Document state changed during rendering read/);
  assert.equal(mutated, true, "Mutation must occur inside the rendering read fence.");
} finally {
  globalThis.structuredClone = clone;
}
assert.match(page.render(), /data-render="after"/);
assert.match(page.render(), /color:red/);
process.stdout.write("Document library rendering acceptance passed.\n");
