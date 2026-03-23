// import { hson } from "../../../hson.js";
// import { HsonNode } from "../../../types/index.js";
// import { SvgTag, SvgLiveTree } from "../../../types/livetree.types.js";
// import { unwrap_root_elem } from "../../../utils/html-utils/unwrap-root-elem.js";
// import { create_livetree } from "../create-livetree.js";
// import { LiveTree } from "../livetree.js";
// import { LiveTextApi } from "../managers/text-form-values.js";

// function createSvgTagFromString(
//     tree: LiveTree,
//     expectedTag: SvgTag,
//     source: string,
//     index?: number,
// ): SvgLiveTree {
//     const parsed = hson.fromTrustedHtml(source).toHson().parse();
//     const root0: HsonNode = Array.isArray(parsed) ? parsed[0] : parsed;

//     if (!root0 || root0._tag !== expectedTag) {
//         throw new Error(
//             `[LiveTree.create.${expectedTag}] expected exactly one <${expectedTag}> root`
//         );
//     }

//     const branch = create_livetree(root0);

//     if (typeof index === "number") tree.append(branch, index);
//     else tree.append(branch);

//     const appended = unwrap_root_elem(root0);
//     if (!appended.length) {
//         throw new Error(`[LiveTree.create.${expectedTag}] no ${expectedTag} root created`);
//     }

//     const out = create_livetree(appended[0]);
//     out.adoptRoots(tree.hostRootNode());
//     return out as unknown as SvgLiveTree;
// }