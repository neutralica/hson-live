import type { ReadonlyHsonNode as RootObservation, LiveTree } from "hson-live";
import type { ReadonlyHsonNode as HsonObservation, HsonNode, Primitive } from "hson-live/hson";
import type { ReadonlyHsonNode as TreeObservation } from "hson-live/livetree";

// Never executed: each expected error certifies the actual exported graph type.
function certify(tree: LiveTree): void {
  const view: RootObservation = tree.node;
  const hson: HsonObservation = view;
  const branch: TreeObservation = hson;
  const root: RootObservation = tree.hostRootNode();
  // @ts-expect-error detached observations are not mutable root handoff inputs
  tree.adoptRoots(root);
  // @ts-expect-error branch observations cannot establish root authority either
  tree.adoptRoots(view);
  void branch; void root;
  // @ts-expect-error readonly root field
  view.$_tag = "changed";
  // @ts-expect-error readonly relationship array
  view.$_content.push("changed");
  // @ts-expect-error readonly relationship index
  view.$_content[0] = "changed";
  // @ts-expect-error observation is not mutable authoring input
  const mutable: HsonNode = view;
  void mutable;
  const child = view.$_content[0];
  if (typeof child === "object" && child !== null) {
    // @ts-expect-error readonly descendant field
    child.$_tag = "changed";
    // @ts-expect-error readonly descendant array
    child.$_content.splice(0, 1);
  }
  if (view.$_meta) {
    // @ts-expect-error readonly metadata
    view.$_meta.index = "changed";
    // @ts-expect-error readonly QUID metadata
    delete view.$_meta.quid;
  }
  if (view.$_attrs) {
    // @ts-expect-error readonly ordinary attribute
    view.$_attrs.title = "changed";
    const style = view.$_attrs.style;
    if (typeof style === "object" && style !== null) {
      // @ts-expect-error readonly style map
      style.color = "red";
      const width = style.width;
      if (typeof width === "object" && width !== null) {
        // @ts-expect-error readonly typed style leaf
        width.value = 9;
        // @ts-expect-error readonly optional typed unit
        width.unit = undefined;
      }
    }
    const values = view.$_attrs.values;
    if (readonlyValues(values)) {
      // @ts-expect-error readonly runtime form array
      values.push("changed");
      // @ts-expect-error readonly runtime form array index
      values[0] = "changed";
    }
  }
  // Own-present undefined units, scalar styles and readonly form arrays are
  // observable values even though public mutable admission remains narrower.
  const runtime: RootObservation = { $_tag: "select", $_content: [], $_attrs: {
    style: { width: { value: -0, unit: undefined } }, values: ["a", "b"],
  } };
  const scalar: RootObservation = { $_tag: "p", $_content: [], $_attrs: { style: false } };
  void runtime; void scalar;
}
function readonlyValues(value: unknown): value is readonly Primitive[] { return Array.isArray(value); }
void certify;
