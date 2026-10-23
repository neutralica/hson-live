import { Hson, hson } from "../../src/index.ts";
import { hsonMirror } from "../../src/api/mirror/mirror.facade.ts";
import { project_livetree } from "../../src/api/livetree/creation/project-live-tree.ts";
import { subject_for_tree, runtime_for_tree } from "../../src/api/livetree/runtime/livetree-runtime.ts";
import { unlinkNode } from "../../src/api/livetree/utils/node-map-helpers.ts";

let checks = 0, assertions = 0;
function equal(actual, expected, label = "value") {
  assertions++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function must(value, label) { assertions++; if (!value) throw new Error(label); }
function rejects(run, pattern) {
  assertions++;
  try { run(); } catch (error) { if (pattern && !pattern.test(error.message)) throw error; return; }
  throw new Error("expected rejection");
}
async function check(name, run) {
  try { await run(); checks++; } catch (cause) { throw new Error(`${name}: ${cause.message}`, { cause }); }
}
function realize(tree, mounted = true, owner = document) {
  const el = project_livetree(subject_for_tree(tree), "html", runtime_for_tree(tree), owner);
  if (mounted) owner.body.append(el);
  return el;
}
function fixture(source, mounted = true) {
  const tree = hson.liveTree.fromHson(source);
  return { tree, el: realize(tree, mounted) };
}
const selected = el => Array.from(el.selectedOptions, option => option.value);
const canonical = tree => JSON.stringify(tree.node);

try {
  await check("dirty input current value, defaults, authored attrs and reset", () => {
    const f = fixture('<form <input value="authored"/>/>');
    const input = f.tree.find.must.byTag("input"), el = input.dom.el(), before = canonical(f.tree);
    let events = 0; el.addEventListener("input", () => events++); el.addEventListener("change", () => events++);
    must(input.form.setValue("current") === input, "fluent value return");
    equal(input.form.getValue(), "current"); equal(canonical(f.tree), before);
    equal(el.defaultValue, "authored"); equal(el.getAttribute("value"), "authored");
    input.attrs.set("value", "next default"); equal(el.defaultValue, "next default"); equal(el.value, "current");
    input.attrs.set("title", "canonical"); equal(el.value, "current");
    equal(input.node.$_attrs.value, "next default");
    f.el.reset(); equal(el.value, "next default"); equal(events, 0);
    el.value = "browser edit"; equal(input.form.getValue(), "browser edit"); equal(input.attrs.get("value"), "next default");
    f.tree.remove();
    const pristine = fixture('<input value="initial"/>');
    pristine.tree.attrs.set("value", "reflected"); equal(pristine.el.value, "reflected");
    pristine.tree.remove();
  });

  await check("textarea current value is separate from authored text and attributes", () => {
    const f = fixture('<form <textarea "authored text"/>/>');
    const tree = f.tree.find.must.byTag("textarea"), el = tree.dom.el(), before = canonical(tree);
    tree.form.setValue("current text"); equal(canonical(tree), before); equal(el.defaultValue, "authored text");
    equal(tree.text.get(), "authored text"); equal(tree.form.getValue(), "current text");
    tree.attrs.set("value", "ordinary attribute"); equal(el.value, "current text"); equal(el.defaultValue, "authored text");
    tree.text.set("new authored text"); equal(el.defaultValue, "new authored text"); equal(el.value, "current text");
    f.el.reset(); equal(el.value, "new authored text"); f.tree.remove();
  });

  await check("checkbox current/default behavior and native checked reflection", () => {
    const f = fixture('<form <input type="checkbox" checked/>/>');
    const tree = f.tree.find.must.byTag("input"), el = tree.dom.el(), before = canonical(tree);
    must(tree.form.setChecked(false) === tree, "fluent checked return");
    equal(tree.form.getChecked(), false); equal(el.defaultChecked, true); equal(canonical(tree), before);
    tree.attrs.set("checked", false); equal(el.defaultChecked, false); equal(el.checked, false);
    tree.form.setChecked(true); tree.attrs.set("checked", true); tree.attrs.drop("checked");
    equal(el.checked, true); equal(el.defaultChecked, false); f.el.reset(); equal(el.checked, false);
    // Native boolean attributes use presence, even when the authored value is a string.
    tree.attrs.set("checked", "false"); equal(el.defaultChecked, true); equal(el.checked, true);
    f.tree.remove();
  });

  await check("browser owns radio group side effects without canonical peer writes", () => {
    const f = fixture('<form <input id="r1" type="radio" name="group" checked/><input id="r2" type="radio" name="group"/>/>');
    const a = f.tree.find.must.byId("r1"), b = f.tree.find.must.byId("r2"), before = canonical(f.tree);
    b.form.setChecked(true); equal(a.form.getChecked(), false); equal(b.form.getChecked(), true);
    equal(canonical(f.tree), before); equal(a.dom.el().defaultChecked, true); equal(b.dom.el().defaultChecked, false);
    a.attrs.set("title", "unrelated"); equal(a.form.getChecked(), false);
    f.el.reset(); equal(a.form.getChecked(), true); equal(b.form.getChecked(), false); f.tree.remove();
  });

  await check("single select uses native value semantics for duplicates and unmatched values", () => {
    const f = fixture('<select <option value="a" selected "first"/><option value="b" "second"/><option value="b" "duplicate"/>/>');
    const before = canonical(f.tree);
    must(f.tree.form.setSelected("b") === f.tree, "fluent selected return");
    equal(f.el.selectedIndex, 1); equal(f.tree.form.getSelected(), "b"); equal(canonical(f.tree), before);
    const nativeBefore = selected(f.el);
    rejects(() => f.tree.form.setSelected(["a"]), /arrays require a multiple select/); equal(selected(f.el), nativeBefore);
    f.tree.form.setSelected("unmatched"); equal(f.el.selectedIndex, -1); equal(f.tree.form.getSelected(), "");
    f.tree.form.setValue("a"); equal(f.el.selectedIndex, 0); equal(canonical(f.tree), before); f.tree.remove();
  });

  await check("multiple select owns captured arguments, native ordering, duplicates, empty arrays and reset", () => {
    const f = fixture('<form <select multiple <option value="b" "first"/><option value="a" selected "second"/><option value="b" "duplicate"/><option value="c" "last"/>/>/>');
    const tree = f.tree.find.must.byTag("select"), el = tree.dom.el(), before = canonical(tree);
    let events = 0; el.addEventListener("change", () => events++);
    const values = ["a", "b"];
    const unexpected = () => { throw new Error("caller behavior invoked"); };
    for (const key of ["slice", "map", "constructor", Symbol.iterator]) Object.defineProperty(values, key, { get: unexpected });
    tree.form.setSelected(values); values[0] = "c";
    equal(tree.form.getSelected(), ["b", "a", "b"]); equal(selected(el), ["b", "a", "b"]);
    const returned = tree.form.getSelected(); returned[0] = "caller"; equal(tree.form.getSelected(), ["b", "a", "b"]);
    equal(canonical(tree), before); tree.attrs.set("title", "canonical remains valid"); equal(tree.attrs.get("values"), undefined);
    const unchanged = selected(el), graph = canonical(tree);
    const sparse = ["b", , "c"], accessor = ["b", "a"];
    Object.defineProperty(accessor, "1", { get: unexpected });
    for (const value of [sparse, accessor, ["b", {}], ["b", NaN]]) {
      rejects(() => tree.form.setSelected(value)); equal(selected(el), unchanged); equal(canonical(tree), graph);
    }
    tree.form.setSelected("b"); equal(selected(el), ["b"]); equal(el.selectedIndex, 0);
    tree.form.setSelected(["missing"]); equal(tree.form.getSelected(), []);
    tree.form.setSelected(Object.freeze(["c"])); equal(tree.form.getSelected(), ["c"]);
    tree.form.setSelected([]); equal(tree.form.getSelected(), []);
    f.el.reset(); equal(tree.form.getSelected(), ["a"]); equal(events, 0); f.tree.remove();
  });

  await check("file input clearing and authored value do not cause prohibited current-value assignment", () => {
    const f = fixture('<input type="file"/>');
    const transfer = new DataTransfer(); transfer.items.add(new File(["test"], "test.txt")); f.el.files = transfer.files;
    const before = canonical(f.tree); must(f.el.value !== "", "file fixture must be populated");
    const current = f.el.value;
    rejects(() => f.tree.form.setValue("nonempty"), /file inputs accept only the empty string/);
    equal(f.el.value, current); equal(canonical(f.tree), before);
    f.tree.form.setValue(""); equal(f.el.files.length, 0); equal(f.tree.form.getValue(), ""); equal(canonical(f.tree), before);
    f.tree.attrs.set("value", "authored filename"); equal(f.el.getAttribute("value"), "authored filename"); equal(f.el.value, "");
    f.tree.remove();
  });

  await check("current-value input modes retain browser normalization; reflecting modes are excluded", () => {
    for (const type of ["text", "search", "tel", "url", "email", "password", "date", "month", "week", "time", "datetime-local", "number", "range", "color", "not-a-type"]) {
      const f = fixture(`<input type="${type}" value="authored"/>`), before = canonical(f.tree);
      const reference = document.createElement("input"); reference.type = type; reference.setAttribute("value", "authored");
      for (const value of ["  new\nvalue  ", "42", "2026-10-23", ""]) {
        reference.value = value; f.tree.form.setValue(value); equal(f.el.value, reference.value, type); equal(f.tree.form.getValue(), reference.value);
        equal(f.el.getAttribute("value"), "authored"); equal(canonical(f.tree), before);
      }
      rejects(() => f.tree.form.setChecked(true), /unsupported native control/); f.tree.remove();
    }
    for (const type of ["hidden", "submit", "image", "reset", "button", "checkbox", "radio"]) {
      const f = fixture(`<input type="${type}" value="authored"/>`), before = canonical(f.tree), current = f.el.value;
      const reference = document.createElement("input"); reference.type = type; reference.value = "reflected";
      equal(reference.getAttribute("value"), "reflected", `${type} reflects value`);
      rejects(() => f.tree.form.setValue("new"), /unsupported native control/);
      equal(f.el.value, current); equal(f.el.getAttribute("value"), "authored"); equal(canonical(f.tree), before); f.tree.remove();
    }
  });

  await check("getters and setters target exact mapped native subjects without descendant or authored fallback", () => {
    const f = fixture('<div value="authored" checked <input value="inner"/>/>'), before = canonical(f.tree);
    const child = f.tree.find.must.byTag("input"); child.dom.el().value = "inner dirty";
    equal(f.tree.form.getValue(), ""); equal(f.tree.form.getChecked(), false); equal(f.tree.form.getSelected(), "");
    for (const run of [() => f.tree.form.setValue("outer"), () => f.tree.form.setChecked(true), () => f.tree.form.setSelected("a")]) rejects(run, /unsupported native control/);
    equal(child.dom.el().value, "inner dirty"); equal(canonical(f.tree), before); f.tree.remove();
    const foreign = hson.liveTree.fromNode({ $_tag: "svg", $_content: [{ $_tag: "_hson_elem", $_content: [{ $_tag: "input", $_content: [] }] }] });
    realize(foreign); const lookalike = foreign.find.must.byTag("input");
    rejects(() => lookalike.form.setValue("x"), /unsupported native control/); equal(lookalike.form.getValue(), ""); foreign.remove();
  });

  await check("unrealized rejection, detached acceptance, mounting, detach/reattach and disposal preserve correspondence", () => {
    const tree = hson.liveTree.fromHson('<input value="authored"/>'), before = canonical(tree);
    rejects(() => tree.form.setValue("pending"), /missing native control/); equal(canonical(tree), before); must(tree.dom.el() === undefined, "setter realized a node");
    const el = realize(tree, false), subject = subject_for_tree(tree), quid = tree.quid, runtime = runtime_for_tree(tree);
    const issued = [...runtime.issuedQuids], claims = [...runtime.quidToNode.keys()];
    const resources = [...runtime.ownerDisposables.values()].reduce((sum, values) => sum + values.size, 0);
    const listeners = runtime.realizationListeners.size;
    tree.form.setValue("detached"); must(!el.isConnected, "detached fixture connected"); equal(el.value, "detached");
    document.body.append(el); tree.form.setValue("mounted"); equal(el.value, "mounted");
    tree.detach(); tree.form.setValue("detached again"); equal(el.value, "detached again");
    equal([...runtime.issuedQuids], issued); equal([...runtime.quidToNode.keys()], claims);
    equal([...runtime.ownerDisposables.values()].reduce((sum, values) => sum + values.size, 0), resources);
    equal(runtime.realizationListeners.size, listeners);
    const host = fixture('<main/>'); host.tree.append(tree);
    must(tree.dom.el() === el && el.parentNode === host.el && el.isConnected, "reattachment changed native identity");
    must(subject_for_tree(tree) === subject && tree.quid === quid, "property write changed exact identity");
    tree.form.setValue("reattached"); equal(el.value, "reattached");
    // Host construction legitimately claims its own identity; property writes did not.
    must(issued.every(value => runtime.issuedQuids.has(value)), "issued identity lost");
    must(claims.every(value => runtime.quidToNode.has(value)), "mapping lost");
    const cached = tree.form; tree.remove(); must(tree.isDisposed, "terminal removal did not dispose");
    rejects(() => cached.setValue("retired"), /disposed/); equal(el.value, "reattached"); host.tree.remove();
  });

  await check("graft captures authored defaults and retains browser current state", () => {
    const native = document.createElement("input"); native.id = "form-graft"; native.defaultValue = "authored"; native.value = "browser edit";
    document.body.append(native);
    const tree = hson.liveTree.queryDom("#form-graft").graft();
    must(tree.dom.el() === native, "graft replaced element"); equal(tree.attrs.get("value"), "authored"); equal(tree.form.getValue(), "browser edit");
    const before = canonical(tree); tree.form.setValue("programmatic"); equal(canonical(tree), before);
    tree.detach(); tree.form.setValue("detached graft"); document.body.append(native); equal(tree.form.getValue(), "detached graft"); tree.remove();
  });

  await check("replacement native initializes from authored document even with identical runtime subject identity", () => {
    const f = fixture('<input value="authored"/>'), subject = subject_for_tree(f.tree), quid = f.tree.quid;
    f.tree.form.setValue("old current"); f.el.remove(); unlinkNode(subject);
    const replacement = realize(f.tree);
    must(replacement !== f.el && subject_for_tree(f.tree) === subject && f.tree.quid === quid, "replacement identity fixture invalid");
    equal(replacement.value, "authored"); equal(f.el.value, "old current"); equal(f.tree.form.getValue(), "authored");
    f.tree.form.setValue("new current"); equal(f.el.value, "old current"); equal(replacement.value, "new current"); f.tree.remove();
  });

  await check("native setter failures preserve canonical state while reporting native side effects", () => {
    const f = fixture('<input value="authored"/>'), before = canonical(f.tree);
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    Object.defineProperty(f.el, "value", {
      configurable: true,
      get() { return native.get.call(this); },
      set(value) {
        rejects(() => f.tree.remove(), /unfinished/);
        native.set.call(this, value);
        throw new Error("native setter side effect then failure");
      },
    });
    rejects(() => f.tree.form.setValue("partial native result"), /native property assignment failed/);
    equal(canonical(f.tree), before); equal(f.el.value, "partial native result"); equal(f.el.defaultValue, "authored");
    delete f.el.value; f.tree.form.setValue("retry"); equal(f.el.value, "retry"); f.tree.remove();
  });

  await check("qualification and option planning reject retirement and replacement before native writes", () => {
    for (const operation of ["setValue", "setChecked", "setSelected"]) {
      for (const action of ["remove", "replace"]) {
        const isSelect = operation === "setSelected", isChecked = operation === "setChecked";
        const source = isSelect
          ? '<main <select multiple <option value="a" selected/><option value="b"/>/>/>'
          : `<main <input type="${isChecked ? "checkbox" : "text"}" value="authored"/>/>`;
        const f = fixture(source), tree = f.tree.content.first(), el = tree.dom.el();
        const before = canonical(f.tree), subject = subject_for_tree(tree), quid = tree.quid, runtime = runtime_for_tree(tree);
        const option = isSelect ? el.options[1] : null, target = option ?? el, property = isSelect ? "value" : "type";
        const native = Object.getOwnPropertyDescriptor(isSelect ? HTMLOptionElement.prototype : HTMLInputElement.prototype, property);
        const write = () => tree.form[operation](isSelect ? ["b"] : isChecked ? true : "current");
        const current = () => isSelect ? [...el.options].map(option => option.selected) : isChecked ? el.checked : el.value;
        const initial = current(); let attempts = 0;
        Object.defineProperty(target, property, { configurable: true, get() {
          attempts++;
          if (action === "remove") tree.remove(); else f.tree.text.overwrite("replacement");
          return native.get.call(this);
        } });
        rejects(write, /unfinished/); must(attempts > 0, "qualification callback did not run");
        equal(current(), initial); equal(canonical(f.tree), before); must(!tree.isDisposed, "subject retired during qualification");
        must(subject_for_tree(tree) === subject && runtime_for_tree(tree) === runtime && tree.quid === quid, "subject identity changed");
        must(tree.dom.el() === el && el.parentNode === f.el, "native correspondence changed");
        delete target[property];
        // A getter may handle the rejected reentry itself. The accepted outer
        // operation still belongs to this exact active subject and element.
        Object.defineProperty(target, property, { configurable: true, get() {
          rejects(() => tree.remove(), /unfinished/);
          rejects(() => f.tree.text.overwrite("replacement"), /unfinished/);
          return native.get.call(this);
        } });
        must(write() === tree, "guarded completion lost fluent owner");
        delete target[property];
        equal(current(), isSelect ? [false, true] : isChecked ? true : "current"); equal(canonical(f.tree), before);
        if (isSelect) tree.form.setSelected(["a"]); else if (isChecked) tree.form.setChecked(false); else tree.form.setValue("retry");
        must(tree.dom.el() === el && subject_for_tree(tree) === subject, "retry changed identity"); equal(canonical(f.tree), before);
        const cached = tree.form, last = current(); tree.remove();
        rejects(() => cached[operation](isSelect ? ["b"] : isChecked ? true : "retired"), /disposed/);
        if (!isSelect) equal(current(), last);
        f.tree.remove();
      }
    }
  });

  await check("selection capture and native enumeration reject lifecycle reentry and recover", () => {
    for (const read of ["capture", "multiple", "options", "iterator"]) {
      const f = fixture('<select multiple <option value="a" selected/><option value="b"/>/>');
      const before = canonical(f.tree), subject = subject_for_tree(f.tree), options = f.el.options;
      let values = ["b"], restore = () => {}, attempts = 0;
      const retire = () => { attempts++; f.tree.remove(); };
      if (read === "capture") values = new Proxy(values, { ownKeys() { retire(); } });
      else {
        const target = read === "iterator" ? options : f.el, key = read === "iterator" ? Symbol.iterator : read;
        const original = Object.getOwnPropertyDescriptor(target, key);
        Object.defineProperty(target, key, { configurable: true, get: retire });
        restore = () => { if (original) Object.defineProperty(target, key, original); else delete target[key]; };
      }
      rejects(() => f.tree.form.setSelected(values), /unfinished|cannot capture/); restore();
      must(attempts > 0 && !f.tree.isDisposed, "enumeration lifecycle protection failed");
      equal([...options].map(option => option.selected), [true, false]); equal(canonical(f.tree), before);
      must(f.tree.dom.el() === f.el && subject_for_tree(f.tree) === subject, "enumeration changed correspondence");
      f.tree.form.setSelected(["b"]); equal(f.tree.form.getSelected(), ["b"]); equal(canonical(f.tree), before); f.tree.remove();
    }
  });

  await check("lifecycle reservation remains active inside each native assignment", () => {
    for (const operation of ["setValue", "setChecked", "setSelected"]) {
      const isSelect = operation === "setSelected", isChecked = operation === "setChecked";
      const f = fixture(isSelect ? '<select multiple <option value="a"/>/>' : `<input type="${isChecked ? "checkbox" : "text"}"/>`);
      const before = canonical(f.tree), target = isSelect ? f.el.options[0] : f.el, key = isSelect ? "selected" : isChecked ? "checked" : "value";
      const native = Object.getOwnPropertyDescriptor(isSelect ? HTMLOptionElement.prototype : HTMLInputElement.prototype, key);
      let assignments = 0;
      Object.defineProperty(target, key, { configurable: true, get() { return native.get.call(this); }, set(value) {
        assignments++; rejects(() => f.tree.remove(), /unfinished/); native.set.call(this, value);
      } });
      must(f.tree.form[operation](isSelect ? ["a"] : isChecked ? true : "current") === f.tree, "assignment owner changed");
      equal(assignments, 1); must(!f.tree.isDisposed && f.tree.dom.el() === f.el, "assignment retired owner"); equal(canonical(f.tree), before);
      delete target[key]; f.tree.remove();
    }
  });

  await check("native interaction and listeners survive form writes and detach/reattach", () => {
    const f = fixture('<form <input type="checkbox"/>/>'), tree = f.tree.find.must.byTag("input"), el = tree.dom.el();
    const before = canonical(tree), subject = subject_for_tree(tree), quid = tree.quid;
    let clicks = 0; tree.listen.onClick(() => clicks++);
    el.click(); equal(tree.form.getChecked(), true); equal(clicks, 1); equal(canonical(tree), before);
    tree.form.setChecked(false); equal(clicks, 1); el.click(); equal(tree.form.getChecked(), true); equal(clicks, 2);
    tree.detach(); must(!el.isConnected && tree.dom.el() === el, "detach lost native control");
    f.tree.append(tree); must(el.isConnected && tree.dom.el() === el, "reattach replaced native control");
    must(subject_for_tree(tree) === subject && tree.quid === quid, "reattach changed subject identity");
    el.click(); equal(tree.form.getChecked(), false); equal(clicks, 3); equal(canonical(tree), before);
    f.el.reset(); equal(tree.form.getChecked(), false);
    const cached = tree.form; tree.remove(); rejects(() => cached.getChecked(), /disposed/); f.tree.remove();
  });

  await check("native controls from a foreign realm work without ambient constructor assumptions", () => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    const tree = hson.liveTree.fromHson('<form <input id="text" value="authored"/><input id="check" type="checkbox"/><select multiple <option value="a"/>/>/>');
    realize(tree, true, frame.contentDocument);
    const input = tree.find.must.byId("text"), checkbox = tree.find.must.byId("check"), select = tree.find.must.byTag("select");
    must(!(input.dom.el() instanceof HTMLInputElement), "fixture is not foreign realm");
    input.form.setValue("foreign"); checkbox.form.setChecked(true); select.form.setSelected(["a"]);
    equal(input.form.getValue(), "foreign"); equal(checkbox.form.getChecked(), true); equal(select.form.getSelected(), ["a"]);
    tree.remove(); frame.remove();
  });

  await check("bound scalars and async author attributes while native current state stays browser-owned", async () => {
    const schema = Hson.schema`<type "document" tag "input" content "empty">`;
    const map = hson.liveMap.fromLibraries({ page: { document: '<input value="authored"/>', schema } });
    const binding = hsonMirror(map.doc.must("page")), tree = binding.tree.find.must.byTag("input"), el = realize(tree);
    el.value = "dirty";
    tree.form.setValue("bound authored"); equal(tree.attrs.get("value"), "bound authored"); equal(el.defaultValue, "bound authored"); equal(el.value, "dirty");
    await tree.async.form.setValue("async authored"); equal(el.defaultValue, "async authored"); equal(el.value, "dirty");
    equal(binding.status, "active"); equal(binding.sourceRevision, map.rev);
    binding.dispose(); binding.tree.remove();
    const standalone = fixture('<input value="start"/>'); standalone.el.value = "dirty";
    await standalone.tree.async.form.setValue("async authored"); equal(standalone.el.defaultValue, "async authored"); equal(standalone.el.value, "dirty"); standalone.tree.remove();
    const fileMap = hson.liveMap.fromLibraries({ page: { document: '<input type="file"/>', schema } });
    const fileBinding = hsonMirror(fileMap.doc.must("page")), fileTree = fileBinding.tree.find.must.byTag("input"), file = realize(fileTree);
    fileTree.form.setValue("authored file attribute"); equal(file.getAttribute("value"), "authored file attribute"); equal(file.value, "");
    equal(fileBinding.status, "active"); equal(fileBinding.sourceRevision, fileMap.rev); fileBinding.dispose(); fileBinding.tree.remove();
  });

  document.documentElement.dataset.detail = `${checks} cases, ${assertions} assertions; ${navigator.userAgent}`;
  document.documentElement.dataset.status = "pass";
} catch (error) {
  document.documentElement.dataset.detail = error.stack ?? String(error);
  document.documentElement.dataset.status = "fail";
}
