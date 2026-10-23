import { Hson, hson } from "../../src/index.ts";
import { hsonMirror } from "../../src/api/mirror/mirror.facade.ts";
import { project_livetree } from "../../src/api/livetree/creation/project-live-tree.ts";
import { subject_for_tree, runtime_for_tree } from "../../src/api/livetree/runtime/livetree-runtime.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { link_node_to_el } from "../../src/api/livetree/utils/node-map-helpers.ts";

export async function attribute_atomicity_browser_cases(check) {
  let assertions = 0;
  function equal(actual, expected, label = "value") {
    assertions++;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
  function must(value, label) { assertions++; if (!value) throw new Error(label); }
  function rejected(run) {
    assertions++;
    try { run(); } catch (error) { return error; }
    throw new Error("expected native attribute rejection");
  }
  const canonical = tree => JSON.stringify(tree.node);
  const attrs = el => el.getAttributeNames().map(name => [name, el.getAttribute(name)]).sort(([a], [b]) => a.localeCompare(b));
  function fixture(source = '<button a="before" b="before" c="before"/>', mounted = true, owner = document) {
    const tree = hson.liveTree.fromHson(source), subject = subject_for_tree(tree), quid = tree.quid;
    const el = project_livetree(subject, "html", runtime_for_tree(tree), owner);
    if (mounted) owner.body.append(el);
    let clicks = 0; tree.listen.onClick(() => clicks++);
    const before = canonical(tree), native = attrs(el);
    return { tree, el, subject, before, native,
      preserved() {
        equal(canonical(tree), before); equal(attrs(el), native);
        must(subject_for_tree(tree) === subject && tree.dom.el() === el && tree.quid === quid, "identity changed");
        const prior = clicks; el.dispatchEvent(new Event("click")); equal(clicks, prior + 1);
      },
    };
  }

  for (const mounted of [true, false]) for (const failure of ["set", "remove"]) {
    await check(`attrs atomicity: ${mounted ? "mounted" : "detached"} native ${failure} failure restores canonical and DOM attrs`, () => {
      const f = fixture(undefined, mounted), original = new Error("native failure");
      const method = failure === "set" ? "setAttribute" : "removeAttribute", native = f.el[method];
      let writes = 0;
      f.el[method] = function(...args) {
        equal(canonical(f.tree), f.before, "native callbacks observe accepted state");
        writes++; if (writes === 2) throw original;
        return native.apply(this, args);
      };
      try {
        must(rejected(() => f.tree.attrs.replace(failure === "set" ? { a: "rejected", b: "rejected", c: "rejected" } : { c: "rejected" })) === original, "realization error lost");
        equal(writes, 2); delete f.el[method]; f.preserved();
        f.tree.attrs.set("later", "valid");
        equal(f.tree.attrs.get("a"), "before"); equal(f.el.getAttribute("a"), "before"); equal(f.el.getAttribute("b"), "before");
      } finally { delete f.el[method]; f.tree.remove(); }
    });
  }

  await check("attrs atomicity: successful replacement preserves normalization, equality, removal and listeners", () => {
    const f = fixture(), set = f.el.setAttribute, remove = f.el.removeAttribute;
    let writes = 0;
    f.el.setAttribute = function(...args) { writes++; return set.apply(this, args); };
    f.el.removeAttribute = function(...args) { writes++; return remove.apply(this, args); };
    try {
      f.tree.attrs.replace({ C: "before", B: "before", A: "before" }); equal(writes, 0); f.preserved();
      f.tree.attrs.replace({ TITLE: "accepted", hidden: false, style: { color: "red" } });
      equal(f.tree.attrs.keys(), ["hidden", "style", "title"]); equal(f.el.getAttribute("a"), null);
      equal(f.el.getAttribute("title"), "accepted"); equal(f.el.getAttribute("hidden"), null); equal(f.el.style.color, "red");
      must(f.tree.dom.el() === f.el && subject_for_tree(f.tree) === f.subject, "success changed identity");
      const count = writes; f.tree.attrs.setMany({ title: "accepted", style: { color: "red" } }); equal(writes, count);
      f.tree.attrs.drop("style"); equal(f.el.getAttribute("style"), null);
      f.tree.attrs.clear(); equal(f.tree.node.$_attrs, undefined);
      // The original native listener remains attached through every replacement.
      f.el.dispatchEvent(new Event("click"));
    } finally { delete f.el.setAttribute; delete f.el.removeAttribute; f.tree.remove(); }
  });

  await check("attrs atomicity: owning-realm restoration failure reports both errors and releases lifecycle guards", () => {
    const f = fixture(), original = new Error("realization"), restoration = new Error("restoration");
    const prototype = f.el.ownerDocument.defaultView.Element.prototype, native = prototype.setAttribute;
    f.el.setAttribute = function(name, value) { native.call(this, name, value); if (name === "b") throw original; };
    prototype.setAttribute = function() {
      const nested = rejected(() => f.tree.remove()); must(/unfinished/.test(nested.message), "restoration guard released too soon");
      throw restoration;
    };
    try {
      const error = rejected(() => f.tree.attrs.setMany({ a: "rejected", b: "rejected" }));
      must(error instanceof AggregateError && error.cause === original, "missing aggregate realization cause");
      must(error.errors[0] === original && error.errors[1] === restoration, "both native errors must be observable");
      must(/restoration failed/.test(error.message), "failed restoration not identified"); equal(canonical(f.tree), f.before);
      equal(f.el.getAttribute("a"), "rejected", "native incoherence must remain observable");
    } finally { prototype.setAttribute = native; delete f.el.setAttribute; }
    f.tree.attrs.set("later", "valid"); equal(f.el.getAttribute("a"), "before"); f.tree.remove(); must(f.tree.isDisposed, "terminal guard leaked");
  });

  await check("attrs atomicity: custom-element callbacks retain exact subject authority until acceptance", () => {
    let f, callbacks = 0;
    const tag = `hson-cut-b-${Math.random().toString(36).slice(2)}`;
    customElements.define(tag, class extends HTMLElement {
      static observedAttributes = ["a", "b"];
      attributeChangedCallback() {
        if (!f) return;
        callbacks++;
        equal(canonical(f.tree), f.before, "candidate became canonical during native callback");
        for (const run of [() => f.tree.attrs.set("nested", "bad"), () => f.tree.remove(), () => f.tree.empty()]) {
          const error = rejected(run); must(/unfinished/.test(error.message), "native callback escaped guard");
        }
      }
    });
    f = fixture(`<${tag} a="before" b="before"/>`);
    f.tree.attrs.replace({ a: "after", b: "after" });
    equal(callbacks, 2); equal(f.tree.attrs.get("a"), "after"); equal(f.el.getAttribute("b"), "after");
    const tree = f.tree; f = undefined; tree.attrs.set("later", "valid"); tree.remove();
  });

  for (const phase of ["capture", "snapshot", "set", "remove", "restore"]) {
    await check(`attrs atomicity: ${phase} callbacks cannot retire an ancestor or mutate an active subject`, () => {
      const owner = hson.liveTree.fromHson('<section <button a="before" b="before"/>/>');
      project_livetree(subject_for_tree(owner), "html", runtime_for_tree(owner), document);
      const tree = owner.find.must.byTag("button"), el = tree.dom.el(), before = canonical(tree), native = attrs(el);
      let callbacks = 0, values = { a: "after" };
      const callback = () => {
        callbacks++;
        for (const run of [() => tree.attrs.clear(), () => tree.remove(), () => owner.empty(), () => owner.text.overwrite("replacement"), () => owner.remove(), () => tree.detach()]) {
          const error = rejected(run); must(/unfinished/.test(error.message), "lifecycle reentry succeeded");
        }
        equal(canonical(tree), before);
      };
      const prototype = el.ownerDocument.defaultView.Element.prototype, set = prototype.setAttribute;
      if (phase === "capture") values = { get a() { callback(); return "after"; } };
      if (phase === "snapshot") el.getAttribute = function(name) { callback(); return prototype.getAttribute.call(this, name); };
      if (phase === "set") el.setAttribute = function(name, value) { callback(); set.call(this, name, value); };
      if (phase === "remove") el.removeAttribute = function(name) { callback(); prototype.removeAttribute.call(this, name); };
      if (phase === "restore") {
        el.setAttribute = () => { throw new Error("force recovery"); };
        prototype.setAttribute = function(name, value) { callback(); set.call(this, name, value); };
      }
      try {
        if (phase === "restore") { rejected(() => tree.attrs.replace(values)); equal(canonical(tree), before); equal(attrs(el), native); }
        else { tree.attrs.replace(values); equal(tree.attrs.get("a"), "after"); }
        must(callbacks > 0, "callback was not exercised"); must(tree.dom.el() === el && !tree.isDisposed, "subject retired");
      } finally { prototype.setAttribute = set; delete el.setAttribute; delete el.removeAttribute; delete el.getAttribute; }
      tree.attrs.set("later", "valid"); owner.remove();
    });
  }

  await check("attrs atomicity: remapping during native writes rejects without publishing a stale candidate", () => {
    const f = fixture(), replacement = document.createElement("button"), native = f.el.setAttribute;
    f.el.setAttribute = function(name, value) { native.call(this, name, value); link_node_to_el(f.subject, replacement); };
    rejected(() => f.tree.attrs.replace({ a: "rejected" }));
    equal(canonical(f.tree), f.before); equal(attrs(f.el), f.native); equal(replacement.attributes.length, 0);
    must(f.tree.dom.el() === replacement, "test remapping did not occur");
    link_node_to_el(f.subject, f.el); delete f.el.setAttribute;
    f.tree.attrs.set("later", "valid"); equal(f.el.getAttribute("a"), "before"); f.tree.remove();
  });

  for (const mounted of [true, false]) await check(`attrs atomicity: ${mounted ? "mounted" : "detached"} dirty native controls keep current properties through failed authored replacement`, () => {
    const f = fixture('<input type="text" value="authored" z="before"/>', mounted);
    f.tree.form.setValue("current"); const native = f.el.setAttribute;
    f.el.setAttribute = function(name, value) { if (name === "z") throw new Error("late input attribute failure"); native.call(this, name, value); };
    rejected(() => f.tree.attrs.replace({ type: "text", value: "rejected", z: "rejected" }));
    delete f.el.setAttribute; f.preserved(); equal(f.el.value, "current"); equal(f.el.defaultValue, "authored");
    f.tree.attrs.set("value", "accepted"); equal(f.el.defaultValue, "accepted"); equal(f.el.value, "current"); f.tree.remove();
  });

  await check("attrs atomicity: dataset batches retain one complete candidate through native failure", () => {
    const f = fixture('<button data-first="before" data-second="before"/>'), native = f.el.setAttribute;
    f.el.setAttribute = function(name, value) { if (name === "data-second") throw new Error("dataset native failure"); native.call(this, name, value); };
    rejected(() => f.tree.data.setMany({ first: "rejected", second: "rejected" }));
    delete f.el.setAttribute; f.preserved(); f.tree.data.set("third", "valid");
    equal(f.el.getAttribute("data-first"), "before"); equal(f.tree.data.get("second"), "before"); f.tree.remove();
  });

  await check("attrs atomicity: restoration uses the element's foreign owning realm", () => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    const f = fixture(undefined, true, frame.contentDocument), native = f.el.setAttribute;
    f.el.setAttribute = function(name, value) { if (name === "b") throw new Error("foreign native failure"); native.call(this, name, value); };
    const ambient = Element.prototype.setAttribute;
    Element.prototype.setAttribute = () => { throw new Error("wrong restoration realm"); };
    try { rejected(() => f.tree.attrs.replace({ a: "rejected", b: "rejected" })); delete f.el.setAttribute; f.preserved(); }
    finally { Element.prototype.setAttribute = ambient; delete f.el.setAttribute; f.tree.remove(); frame.remove(); }
  });

  await check("attrs atomicity: accepted LiveMap revision survives Mirror failure and later authority commits", () => {
    const schema = Hson.schema`<type "document" tag "button" content "empty">`;
    const map = hson.liveMap.fromLibraries({ page: { document: '<button a="before" b="before"/>', schema } });
    const binding = hsonMirror(map.doc.must("page")), tree = binding.tree.find.must.byTag("button");
    const el = project_livetree(subject_for_tree(tree), "html", runtime_for_tree(tree), document), native = el.setAttribute;
    let commits = 0; const stop = map.commits.observe(() => commits++);
    el.setAttribute = function(name, value) { if (name === "b") throw new Error("bound native failure"); native.call(this, name, value); };
    try {
      must(tree.attrs.replace({ a: "accepted", b: "accepted" }) === tree, "accepted delegate returned rejection");
      equal(map.rev, 1); equal(commits, 1); equal(binding.status, "failed"); equal(binding.sourceRevision, 0);
      must(map.doc.must("page").render().includes('b="accepted"'), "authority rolled back");
      rejected(() => tree.attrs.set("later", "rejected")); equal(map.rev, 1);
      map.doc.must("page").document.attrs.set({ kind: "path", path: validate_document_path([0]) }, "later", "authority");
      equal(map.rev, 2); equal(commits, 2); equal(binding.status, "failed"); equal(binding.sourceRevision, 0);
      equal(tree.attrs.get("later"), undefined);
      delete el.setAttribute; binding.dispose(); binding.tree.remove();
      const resumed = hsonMirror(map.doc.must("page"));
      equal(resumed.tree.find.must.byTag("button").attrs.get("b"), "accepted"); equal(resumed.sourceRevision, 2); equal(resumed.status, "active");
      resumed.dispose(); resumed.tree.remove();
    } finally { stop(); delete el.setAttribute; binding.dispose(); binding.tree.remove(); }
  });
  return assertions;
}
