import type { LiveTree } from "../src/api/livetree/livetree.ts";
declare const tree: LiveTree;
const fluent: LiveTree = tree.form.setValue("").form.setChecked(true).form.setSelected(["a"]);
void fluent;
// @ts-expect-error Form missing-DOM policy was removed.
tree.form.setValue("x", { strict: true });
// @ts-expect-error Form missing-DOM policy was removed.
tree.form.setChecked(true, { silent: true });
// @ts-expect-error Form missing-DOM policy was removed.
tree.form.setSelected(["a"], { strict: false });
// @ts-expect-error Only primitive strings are accepted.
tree.form.setValue(1);
// @ts-expect-error Only primitive booleans are accepted.
tree.form.setChecked("true");
// @ts-expect-error Only arrays of primitive strings are accepted.
tree.form.setSelected(["a", 1]);
tree.listen.strict("ignore"); tree.listen.strict("warn"); tree.listen.strict("throw");
