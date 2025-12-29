import { ensure_quid, get_node_by_quid } from "../../quid/data-quid.quid";
import { HsonNode } from "../../types-consts/node.types";
import { ListenerBuilder } from "../../types-consts/listen.types";
import { element_for_node } from "../../utils/tree-utils/node-map-helpers";
import { css_for_quids } from "./livetree-methods/css-manager";
import { CssHandle } from "../../types-consts/css.types";
import { remove_livetree } from "./livetree-methods/remove";
import { get_node_form_value, get_node_text, set_node_content, set_node_form_value } from "./livetree-methods/content-manager";
import { DataManager } from "./livetree-methods/data-manager";
import { empty_contents } from "./livetree-methods/empty2";
import { build_listener } from "./livetree-methods/listen";
import { FindMany, make_find_all_for, make_find_for } from "./livetree-methods/find";
import { clearFlagsImpl, getAttrImpl, removeAttrImpl, setAttrsImpl, setFlagsImpl } from "./livetree-methods/attrs-manager";
import { remove_child } from "./livetree-methods/remove-child";
import { StyleManager } from "./livetree-methods/style-manager";
import { LiveTreeCreateHelper } from "../../types-consts/livetree.types";
import { append_branch } from "./livetree-methods/append-other";
import { make_tree_create } from "./livetree-methods/create-typed";
import { FindWithById, NodeRef } from "../../types-consts/livetree.types";
import { Primitive } from "../../types-consts/core.types";
import { make_class_api, make_id_api, StyleSetter } from "./livetree-methods/style-setter";
import { ClassApi, IdApi, LiveTreeDom } from "../../types-consts/dom.types";
import { make_dom_api } from "./livetree-managers/dom-manager";
import { is_Node } from "../../utils/node-utils/node-guards";
export type MotionVars = Readonly<{
    x?: string;
    y?: string;
    tx?: string;
    ty?: string;
    dx?: string;
    dy?: string;
}>;
export function set_motion_transform(t: LiveTree): void {
    t.style.setMany({
        transform: "translate3d(" +
            "calc(var(--x, 0px) + var(--dx, 0px) + var(--tx, 0px))," +
            "calc(var(--y, 0px) + var(--dy, 0px) + var(--ty, 0px))," +
            "0)",
        "will-change": "transform",
    });
}
function makeRef(node: HsonNode): NodeRef {
    const q = ensure_quid(node);
    const ref: NodeRef = {
        q,
        resolveNode(): HsonNode {
            return node;
        },
        resolveElement(): Element | undefined {
            return element_for_node(node) ?? undefined;
        },
    };
    return ref;
}
export class LiveTree {
    private nodeRef!: NodeRef;
    private hostRoot!: HsonNode;
    private styleManagerInternal: StyleManager | undefined = undefined;
    private datasetManagerInternal: DataManager | undefined = undefined;
    private idApi?: IdApi;
    private classApi?: ClassApi;
    private setRef(input: HsonNode | LiveTree): void {
        this.invalidate_dom_api();
        if (input instanceof LiveTree) {
            this.nodeRef = makeRef(input.node);
            return;
        }
        this.nodeRef = makeRef(input);
    }
    private setRoot(input: HsonNode | LiveTree): void {
        this.invalidate_dom_api();
        if (input instanceof LiveTree) {
            this.hostRoot = input.hostRoot;
            if (!this.hostRoot) {
                throw new Error('could not set host root');
            }
            return;
        }
        this.hostRoot = input;
        if (!this.hostRoot) {
            throw new Error('could not set host root');
        }
    }
    constructor(input: HsonNode | LiveTree) {
        this.setRoot(input);
        this.setRef(input);
    }
    private domApiInternal: LiveTreeDom | undefined = undefined;
    public get dom(): LiveTreeDom {
        if (!this.domApiInternal) {
            this.domApiInternal = make_dom_api(this);
        }
        return this.domApiInternal;
    }
    private invalidate_dom_api(): void {
        this.domApiInternal = undefined;
    }
    public append = append_branch;
    public empty = empty_contents;
    public removeChildren(): number {
        const parent = this.nodeRef.resolveNode();
        const kids = parent!._content;
        if (!Array.isArray(kids) || kids.length === 0)
            return 0;
        const nodeKids = kids.filter(is_Node);
        if (nodeKids.length === 0)
            return 0;
        let removed = 0;
        for (const child of nodeKids) {
            const childTree = new LiveTree(child);
            childTree.setRoot(this);
            removed += remove_livetree.call(childTree);
        }
        return removed;
    }
    public removeSelf(): number {
        return remove_livetree.call(this);
    }
    public find: FindWithById = make_find_for(this);
    public findAll: FindMany = make_find_all_for(this);
    public get create(): LiveTreeCreateHelper {
        return make_tree_create(this);
    }
    public get quid(): string {
        return this.nodeRef.q;
    }
    public getHostRoots(): HsonNode {
        return this.hostRoot;
    }
    adoptRoots(root: HsonNode): this {
        this.hostRoot = root;
        return this;
    }
    public get node(): HsonNode {
        const n = this.nodeRef.resolveNode();
        if (!n) {
            throw new Error("LiveTree2.node: ref did not resolve");
        }
        return n;
    }
    public get style(): StyleSetter<LiveTree> {
        if (!this.styleManagerInternal) {
            this.styleManagerInternal = new StyleManager(this);
        }
        return this.styleManagerInternal.setter;
    }
    public get data(): DataManager {
        if (!this.datasetManagerInternal) {
            this.datasetManagerInternal = new DataManager(this);
        }
        return this.datasetManagerInternal;
    }
    public get css(): CssHandle {
        return css_for_quids(this, [this.quid]);
    }
    public get listen(): ListenerBuilder {
        return build_listener(this);
    }
    public getAttr(name: string): Primitive | undefined {
        return getAttrImpl(this, name);
    }
    public removeAttr(name: string): LiveTree {
        return removeAttrImpl(this, name);
    }
    public setFlags(...names: string[]): LiveTree {
        return setFlagsImpl(this, ...names);
    }
    public removeFlags(...names: string[]): LiveTree {
        return clearFlagsImpl(this, ...names);
    }
    public setAttrs(name: string, value: string | boolean | null): LiveTree;
    public setAttrs(map: Record<string, string | boolean | null>): LiveTree;
    public setAttrs(nameOrMap: string | Record<string, string | boolean | null>, value?: string | boolean | null): LiveTree {
        return setAttrsImpl(this, nameOrMap, value);
    }
    public setText(value: Primitive): LiveTree {
        set_node_content(this.node, value);
        return this;
    }
    public getText(): string {
        return get_node_text(this.node);
    }
    public setFormValue(value: string, opts?: {
        silent?: boolean;
        strict?: boolean;
    }): LiveTree {
        set_node_form_value(this.node, value, opts);
        return this;
    }
    public getFormValue(): string {
        return get_node_form_value(this.node);
    }
    public get id(): IdApi {
        if (!this.idApi)
            this.idApi = make_id_api(this);
        return this.idApi;
    }
    public get classlist(): ClassApi {
        if (!this.classApi)
            this.classApi = make_class_api(this);
        return this.classApi;
    }
    private invalidate_attr_api(): void {
        this.idApi = undefined;
        this.classApi = undefined;
    }
    public asDomElement(): Element | undefined {
        const firstRef = this.nodeRef;
        if (!firstRef)
            return undefined;
        return firstRef.resolveElement();
    }
}
