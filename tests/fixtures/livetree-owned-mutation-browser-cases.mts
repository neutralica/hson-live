import { LiveTree } from "../../src/api/livetree/livetree.ts";
import type { HsonNode } from "../../src/core/types.ts";
import { subject_for_tree, historic_root_for_tree, runtime_for_tree, observe_livetree_realizations_internal } from "../../src/api/livetree/runtime/livetree-runtime.ts";
import { get_dom_for_node, get_el_for_node } from "../../src/api/livetree/utils/node-map-helpers.ts";
import { project_livetree } from "../../src/api/livetree/creation/project-live-tree.ts";
import { append_branches_atomic } from "../../src/api/livetree/methods/appends.ts";
import { parent_for_node } from "../../src/api/livetree/lifecycle/graph-ownership.ts";
import { hsonMirror } from "../../src/api/mirror/mirror.facade.ts";
import { hsonLiveMap } from "../../src/api/livemap/livemap.facade.ts";
import { Hson } from "../../src/index.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
const n = (tag: string, ...children: HsonNode[]): HsonNode => ({ $_tag: tag, $_content: children });
const str = (value: string): HsonNode => ({ $_tag: "_hson_str", $_content: [value] });
const at = (node: HsonNode, ...path: number[]): HsonNode => { for (const index of path) node = node.$_content[index] as HsonNode; return node; };
function must(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function rejects(run: () => unknown): void { let failed = false; try { run(); } catch { failed = true; } must(failed, "missing mutation rejection"); }
const accounting = (tree: LiveTree): string => { const runtime = runtime_for_tree(tree); return JSON.stringify({
  claims: [...runtime.quidToNode.keys()], issued: [...runtime.issuedQuids], pending: [...runtime.pendingQuidClaims.keys()] }); };
const mount = (tree: LiveTree): Element => { const element = project_livetree(subject_for_tree(tree)) as Element; document.body.appendChild(element); return element; };
export function owned_mutation_browser_cases(): number {
  let cases = 0;
  const check = (name: string, run: () => void): void => { try { run(); cases++; } catch (cause) { throw new Error(name, { cause }); } };
  check("fresh sharing realizes independent native Elements and Text", () => {
    const text = str(""), p = n("p", n("_hson_elem", text, text)), source = n("main", n("_hson_elem", p, p)), tree = new LiveTree(source);
    const root = subject_for_tree(tree), a = at(root, 0, 0), b = at(root, 0, 1), dom = mount(tree);
    try {
      must(dom.children.length === 2 && dom.children[0] !== dom.children[1], "shared occurrence collapsed in native DOM");
      must(a !== b && get_dom_for_node(at(a, 0, 0)) !== get_dom_for_node(at(a, 0, 1)), "native text occurrence sharing");
      const handles = tree.findAll.byTag("p").array(); must(handles[0]!.quid !== handles[1]!.quid, "occurrence identities collapsed");
      handles[0]!.attrs.set("title", "first"); must(!dom.children[1]!.hasAttribute("title"), "mutation crossed positions");
      source.$_content.length = 0; must(dom.children.length === 2, "caller changed owner");
    } finally { tree.remove(); }
  });
  check("single/batch incompatible native plan rejects before identity or placement", () => {
    const target = new LiveTree(n("textarea")), source = new LiveTree(n("p", n("_hson_elem", n("i")))); mount(target);
    const graph = target.node, account = accounting(target), historic = historic_root_for_tree(source); let notices = 0;
    const off = observe_livetree_realizations_internal(target, () => notices++);
    try {
      for (const run of [() => target.append(source), () => append_branches_atomic(target, [source])]) {
        rejects(run); must(JSON.stringify(target.node) === JSON.stringify(graph), "graph changed on rejected plan");
        must(accounting(target) === account && notices === 0, "identity or notification leaked");
        must(historic_root_for_tree(source) === historic && parent_for_node(subject_for_tree(source)) === undefined, "context changed");
        must(get_el_for_node(subject_for_tree(source)) === undefined, "projection published");
      }
    } finally { off(); target.remove(); source.remove(); }
  });
  check("partial staged projection restores mappings without identity issuance", () => {
    const host = new LiveTree(n("main")), a = new LiveTree(n("p", n("_hson_elem", n("b")))), b = new LiveTree(n("i")); const dom = mount(host);
    const before = accounting(host), original = document.createElement; let notices = 0;
    const off = observe_livetree_realizations_internal(host, () => notices++);
    document.createElement = function(name: string, options?: ElementCreationOptions): HTMLElement { if (name === "i") throw new Error("injected factory failure"); return original.call(this, name, options); };
    try {
      rejects(() => append_branches_atomic(host, [a, b])); must(accounting(host) === before && notices === 0, "failed stage published identity");
      must(dom.childNodes.length === 0 && subject_for_tree(host).$_content.length === 0, "partial stage attached");
      must(get_el_for_node(subject_for_tree(a)) === undefined && at(subject_for_tree(a), 0, 0).$_meta === undefined, "stage retained mapping/identity");
    } finally { document.createElement = original; off(); }
    append_branches_atomic(host, [a, b]); must(dom.children.length === 2, "retry failed"); host.remove();
  });
  check("final reconciliation failure restores prior native parentage and historic context", () => {
    const host = new LiveTree(n("main")), branch = new LiveTree(n("p")); const dom = mount(host), native = mount(branch), root = historic_root_for_tree(branch);
    branch.detach(); const parking = document.createElement("div"); parking.append(native);
    const before = accounting(host), original = dom.replaceChildren; let notices = 0;
    const off = observe_livetree_realizations_internal(host, () => notices++);
    dom.replaceChildren = () => { throw new Error("injected reconciliation failure"); };
    try {
      rejects(() => host.append(branch)); must(accounting(host) === before && notices === 0, "failed reconcile published");
      must(native.parentNode === parking && get_el_for_node(subject_for_tree(branch)) === native, "native placement lost");
      must(historic_root_for_tree(branch) === root && parent_for_node(subject_for_tree(branch)) === undefined, "historic/parent context changed");
      must(dom.childNodes.length === 0 && subject_for_tree(host).$_content.length === 0, "host rollback failed");
    } finally { dom.replaceChildren = original; off(); }
    host.append(branch); must(dom.firstChild === native, "retry did not reuse native Element"); host.remove();
  });
  check("factory batches do not publish earlier identities on failure", () => {
    const host = new LiveTree(n("main")), dom = mount(host), before = accounting(host), original = dom.replaceChildren;
    rejects(() => host.create.tags(["p", "xmlbad"] as never)); must(accounting(host) === before, "invalid names published");
    dom.replaceChildren = () => { throw new Error("injected factory attachment failure"); };
    try { rejects(() => host.create.tags(["p", "i"])); must(accounting(host) === before && dom.childNodes.length === 0, "factory batch leaked"); }
    finally { dom.replaceChildren = original; }
    const children = host.create.tags(["p", "i"]).array(); must(children.length === 2 && children[0]!.quid !== children[1]!.quid, "valid factory identity"); host.remove();
  });
  check("fallible detach/remove native cleanup is atomic with listeners and resources", () => {
    for (const operation of ["detach", "remove"] as const) {
      const host = new LiveTree(n("main", n("_hson_elem", n("button")))), dom = mount(host), child = host.find.must.byTag("button"), native = child.dom.el()!;
      let clicks = 0, disposed = 0; child.listen.onClick(() => clicks++); child.events.on("dispose", () => disposed++);
      const before = host.node, account = accounting(host), original = native.remove;
      native.remove = () => { throw new Error("injected native cleanup failure"); };
      try { rejects(() => child[operation]()); must(JSON.stringify(host.node) === JSON.stringify(before) && accounting(host) === account, "cleanup changed owner");
        must(!child.isDisposed && dom.firstChild === native, "failed cleanup retired or unmounted"); native.dispatchEvent(new Event("click")); must(clicks === 1 && disposed === 0, "failed cleanup released resources");
      } finally { native.remove = original; }
      child[operation](); must(subject_for_tree(host).$_content.length === 0, "last relationship remains"); if (operation === "detach") { host.append(child); must(dom.firstChild === native, "detached reuse lost native identity"); }
      host.remove(); child.remove();
    }
  });
  check("empty and detachContents native failures preserve all prior children", () => {
    for (const operation of ["empty", "detachContents"] as const) {
      const host = new LiveTree(n("main", n("_hson_elem", n("button"), n("i")))), dom = mount(host);
      const children = Array.from(dom.childNodes), graph = host.node, original = dom.replaceChildren;
      let clicks = 0; host.find.must.byTag("button").listen.onClick(() => clicks++);
      const afterHandle = accounting(host);
      dom.replaceChildren = () => { throw new Error("injected empty/contents failure"); };
      try {
        rejects(() => host[operation]()); must(JSON.stringify(host.node) === JSON.stringify(graph), "failed clear changed graph");
        must(accounting(host) === afterHandle && dom.childNodes.length === children.length && dom.childNodes[0] === children[0], "failed clear lost placement/identity");
        children[0]!.dispatchEvent(new Event("click")); must(clicks === 1, "failed clear released listener");
      } finally { dom.replaceChildren = original; }
      if (operation === "detachContents") { const cap = host.detachContents(), target = new LiveTree(n("section")); const el = mount(target); cap.appendTo(target); must(el.firstChild === children[0], "cleared content did not retain native identity"); target.remove(); }
      else host.empty();
      host.remove();
    }
  });
  check("failed native listener release preserves owner and earlier listener registrations", () => {
    const host = new LiveTree(n("main", n("_hson_elem", n("button"), n("i")))), dom = mount(host);
    const a = host.find.must.byTag("button"), b = host.find.must.byTag("i"), native = b.dom.el()!;
    let calls = 0; a.listen.onClick(() => calls++); b.listen.onClick(() => calls++);
    const graph = host.node, account = accounting(host), children = Array.from(dom.childNodes), original = native.removeEventListener;
    native.removeEventListener = () => { throw new Error("injected listener cleanup failure"); };
    try {
      rejects(() => host.empty()); must(JSON.stringify(host.node) === JSON.stringify(graph) && accounting(host) === account && !a.isDisposed && !b.isDisposed, "listener cleanup changed owner");
      must(dom.childNodes[0] === children[0] && dom.childNodes[1] === children[1], "listener failure changed DOM");
      children.forEach(child => child.dispatchEvent(new Event("click"))); must(calls === 2, "earlier listener was irreversibly released");
    } finally { native.removeEventListener = original; }
    host.remove();
  });
  check("failed terminal identity attribute cleanup restores exact graph and DOM", () => {
    const host = new LiveTree(n("main", n("_hson_elem", n("p")))), dom = mount(host), child = host.find.must.byTag("p"), native = child.dom.el()!;
    const before = host.node, account = accounting(host), original = native.removeAttribute;
    native.removeAttribute = () => { throw new Error("injected identity attribute failure"); };
    try { rejects(() => child.remove()); must(JSON.stringify(host.node) === JSON.stringify(before) && accounting(host) === account, "identity cleanup changed graph/claims"); must(dom.firstChild === native && !child.isDisposed, "identity cleanup lost native/lifecycle state"); }
    finally { native.removeAttribute = original; } host.remove();
  });
  check("detached mixed content composes without losing native text or capability on failure", () => {
    const source = new LiveTree(n("main", n("_hson_elem", str(""), str("x"), n("i")))), target = new LiveTree(n("section", n("_hson_elem", str("b")))), bad = new LiveTree(n("textarea"));
    mount(source); const dom = mount(target); mount(bad); const relation = at(subject_for_tree(source), 0), children = relation.$_content.slice(), native = children.map(item => get_dom_for_node(item as HsonNode)), cap = source.detachContents();
    rejects(() => cap.appendTo(bad)); must(!cap.isAttached && subject_for_tree(bad).$_content.length === 0, "failed transfer consumed capability");
    cap.appendTo(target); const result = at(subject_for_tree(target), 0); must(subject_for_tree(target).$_content.length === 1 && result.$_content.length === 4, "duplicate relationship");
    children.forEach((child, index) => { must(result.$_content[index + 1] === child && get_dom_for_node(child as HsonNode) === native[index], "transferred identity changed"); });
    must(dom.querySelectorAll("i").length === 1, "native content lost"); rejects(() => cap.appendTo(target)); source.remove(); target.remove(); bad.remove();
  });
  check("template text clearing and failed insertion use the real native child receiver", () => {
    const tree = new LiveTree(n("template", n("_hson_elem", str(""), str("x")))), element = mount(tree) as HTMLTemplateElement;
    const original = element.content.replaceChildren, before = tree.node, natives = Array.from(element.content.childNodes), account = accounting(tree);
    element.content.replaceChildren = () => { throw new Error("injected template receiver failure"); };
    try { rejects(() => tree.create.p()); must(JSON.stringify(tree.node) === JSON.stringify(before) && accounting(tree) === account, "template failed insertion changed ownership");
      must(element.content.childNodes.length === natives.length && element.content.firstChild === natives[0], "template rollback lost native text"); }
    finally { element.content.replaceChildren = original; }
    tree.empty(); must(element.content.childNodes.length === 0 && subject_for_tree(tree).$_content.length === 0, "template empty retained text/markers");
    tree.create.p(); must(element.content.children.length === 1, "fresh template insertion did not realize occurrence"); tree.remove();
  });
  check("Mirror insert/replacements own independent fresh positions with native correspondence", () => {
    const schema = Hson.schema.fromHson('<type "document" tag "main" content <repeat <tag "section" content <repeat <tag "p" content "empty">>>>>' as never);
    const incoming = (): HsonNode => { const p = n("p"); return n("section", n("_hson_elem", p, p)); };
    const map = hsonLiveMap.fromLibraries({ page: { document: n("_hson_root", n("main", n("_hson_elem", incoming()))), schema } });
    const page = map.lib("page"), binding = hsonMirror(page), root = subject_for_tree(binding.tree), owner = at(root, 0);
    const dom = project_livetree(owner) as Element; document.body.append(dom);
    const path = (...segments: number[]) => ({ kind: "path" as const, path: validate_document_path([0, ...segments]) });
    try {
      page.document.content.insert(path(0), 1, incoming());
      let section = at(owner, 0, 1), a = at(section, 0, 0), b = at(section, 0, 1);
      must(a !== b && get_dom_for_node(a) !== get_dom_for_node(b) && dom.children[1]!.children.length === 2, "Mirror shared insertion collapsed");
      page.document.attrs.set(path(0, 1, 0, 0), "title", "first"); must(!get_el_for_node(b)!.hasAttribute("title"), "Mirror attr update crossed position");
      page.document.content.replace(path(0), 1, incoming()); section = at(owner, 0, 1); must(at(section, 0, 0) !== at(section, 0, 1), "Mirror branch replacement shared");
      page.document.content.replace(path(0, 1), 0, at(incoming(), 0)); section = at(owner, 0, 1); must(at(section, 0, 0) !== at(section, 0, 1) && dom.children[1]!.children.length === 2, "Mirror content replacement shared");
      must(binding.status === "active", "Mirror failed on valid occurrences");
    } finally { binding.dispose(); binding.tree.remove(); }
  });
  return cases;
}
