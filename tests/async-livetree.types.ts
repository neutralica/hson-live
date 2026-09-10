import { LiveTree, type AsyncLiveTree } from "../src/index.ts";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends (<T>() => T extends TRight ? 1 : 2)
    ? (<T>() => T extends TRight ? 1 : 2) extends (<T>() => T extends TLeft ? 1 : 2)
      ? true
      : false
    : false;
type Assert<TValue extends true> = TValue;

declare const tree: LiveTree;
const asyncTree = tree.async;
type EntryIsAsync = Assert<Equal<typeof asyncTree, AsyncLiveTree<LiveTree>>>;
type SyncReturnsOrigin = Assert<Equal<typeof asyncTree.sync, LiveTree>>;

// @ts-expect-error AsyncLiveTree is a public view, not a constructible value.
new AsyncLiveTree(tree);

const attrs = await asyncTree.attrs.set("id", "main");
const flags = await attrs.flags.set("hidden");
const id = await flags.id.set("next");
const classes = await id.classlist.add("ready");
const text = await classes.text.set("hello");
const form = await text.form.setValue("value");
const emptied = await form.empty();
const everyOperation = [
  asyncTree.attrs.setMany({ title: "x" }),
  asyncTree.attrs.drop("title"),
  asyncTree.attrs.dropMany(["title"]),
  asyncTree.attrs.clear(),
  asyncTree.attrs.replace({ id: "x" }),
  asyncTree.flags.clear("hidden"),
  asyncTree.id.clear(),
  asyncTree.classlist.set("one"),
  asyncTree.classlist.remove("one"),
  asyncTree.classlist.toggle("one"),
  asyncTree.classlist.clear(),
  asyncTree.text.add("x"),
  asyncTree.text.insert(0, "x"),
  asyncTree.form.setChecked(true),
] satisfies Array<Promise<AsyncLiveTree<LiveTree>>>;
const removal: Promise<void> = asyncTree.remove();
type AttrOwnerIsAsync = Assert<Equal<typeof attrs, AsyncLiveTree<LiveTree>>>;
type FlagOwnerIsAsync = Assert<Equal<typeof flags, AsyncLiveTree<LiveTree>>>;
type IdOwnerIsAsync = Assert<Equal<typeof id, AsyncLiveTree<LiveTree>>>;
type ClassOwnerIsAsync = Assert<Equal<typeof classes, AsyncLiveTree<LiveTree>>>;
type TextOwnerIsAsync = Assert<Equal<typeof text, AsyncLiveTree<LiveTree>>>;
type FormOwnerIsAsync = Assert<Equal<typeof form, AsyncLiveTree<LiveTree>>>;
type EmptyOwnerIsAsync = Assert<Equal<typeof emptied, AsyncLiveTree<LiveTree>>>;

// @ts-expect-error AsyncLiveTree exposes no projected/runtime DOM surface.
asyncTree.dom;
// @ts-expect-error AsyncLiveTree exposes no listener surface.
asyncTree.listen;
// @ts-expect-error AsyncLiveTree exposes no TreeEvents surface.
asyncTree.events;
// @ts-expect-error AsyncLiveTree exposes no binding surface.
asyncTree.bind;
// @ts-expect-error AsyncLiveTree exposes no structural append surface.
asyncTree.append;
// @ts-expect-error AsyncLiveTree exposes no child creation surface.
asyncTree.create;
// @ts-expect-error AsyncLiveTree exposes no detach surface.
asyncTree.detach;
// @ts-expect-error AsyncLiveTree exposes no content reads.
asyncTree.content;
// @ts-expect-error AsyncLiveTree exposes no attribute reads.
asyncTree.attrs.get("id");
// @ts-expect-error AsyncLiveTree excludes text.overwrite.
asyncTree.text.overwrite("replacement");
// @ts-expect-error AsyncLiveTree excludes form.setSelected.
asyncTree.form.setSelected("value");

class SpecificLiveTree extends LiveTree {
  public specific(): true { return true; }
}
declare const specific: SpecificLiveTree;
type SpecificSyncIsPreserved = Assert<Equal<typeof specific.async.sync, SpecificLiveTree>>;

void [asyncTree, attrs, flags, id, classes, text, form, emptied, everyOperation, removal];
