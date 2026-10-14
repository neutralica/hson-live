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

// Re-enter while capture clones the root, before it captures the stylesheet.
const coherent = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body data-render=before/>/>' } });
const page = coherent.lib("page");
page.css.sel("body").set.color("blue");
const revision = coherent.rev;
const commits: number[] = [];
const stop = coherent.commits.observe(commit => commits.push(commit.rev));
const clone = globalThis.structuredClone;
let mutated = false;
let invalidHtml: string | undefined;
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
  assert.throws(() => { invalidHtml = page.render(); }, {
    name: "Error",
    message: "Selected hosted authority changed during capture.",
  });
  assert.equal(invalidHtml, undefined, "An inconsistent capture must return no HTML.");
  assert.equal(mutated, true, "Mutation must occur inside the selected capture fence.");
  assert.equal(coherent.rev, revision + 2);
  assert.deepEqual(commits, [revision + 1, revision + 2], "Both independent mutations must remain committed.");
} finally {
  globalThis.structuredClone = clone;
  stop();
}
const updatedHtml = page.render();
assert.match(updatedHtml, /data-render="after"/);
assert.match(updatedHtml, /color:red/);

// The root payload is bounded once during capture, then again when render decodes
// the fully detached candidate. Re-enter at that second read, beyond the source fence.
const detached = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body data-render=before/>/>' } });
const detachedPage = detached.lib("page");
detachedPage.css.sel("body").set.color("blue");
const expectedHtml = detachedPage.render();
const detachedRoot = internal_livemap_aggregate_authority(detached).captureSelectedHosted(["page"], false).libraries[0]!.root;
const detachedRevision = detached.rev;
const detachedCommits: number[] = [];
const stopDetached = detached.commits.observe(commit => detachedCommits.push(commit.rev));
const encode = TextEncoder.prototype.encode;
let rootReads = 0;
let detachedMutation = false;
let detachedHtml: string | undefined;
TextEncoder.prototype.encode = function(input) {
  if (input === detachedRoot.payload && ++rootReads === 2) {
    detachedMutation = true;
    TextEncoder.prototype.encode = encode;
    detachedPage.at([]).at([1]).asElement()!.attrs.set("data-render", "after");
    detachedPage.css.sel("body").set.color("red");
  }
  return encode.call(this, input);
};
try {
  detachedHtml = detachedPage.render();
  assert.equal(detachedMutation, true, "Mutation must occur during detached root decoding.");
  assert.equal(detachedHtml, expectedHtml, "A detached candidate must survive subsequent source mutations.");
  assert.match(detachedHtml, /data-render="before"/);
  assert.match(detachedHtml, /color:blue/);
  assert.equal(detached.rev, detachedRevision + 2);
  assert.deepEqual(detachedCommits, [detachedRevision + 1, detachedRevision + 2]);
} finally {
  TextEncoder.prototype.encode = encode;
  stopDetached();
}
const subsequentHtml = detachedPage.render();
assert.match(subsequentHtml, /data-render="after"/);
assert.match(subsequentHtml, /color:red/);
process.stdout.write("Document library rendering acceptance passed.\n");
