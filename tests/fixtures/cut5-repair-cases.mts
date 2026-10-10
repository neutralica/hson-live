import { LiveTree } from '../../src/api/livetree/livetree.ts';
import type { HsonNode, ReadonlyHsonNode } from '../../src/core/types.ts';
import { is_Node } from '../../src/core/node-guards.ts';
import { Hson } from '../../src/index.ts';
import { hsonLiveMap } from '../../src/api/livemap/livemap.facade.ts';
import { hsonMirror } from '../../src/api/mirror/mirror.facade.ts';
import { validate_document_path } from '../../src/api/livemap/livemap.document.path.ts';
import { subject_for_tree, runtime_for_tree, runtime_for_node, historic_root_for_tree } from '../../src/api/livetree/runtime/livetree-runtime.ts';
import { parent_for_node } from '../../src/api/livetree/lifecycle/graph-ownership.ts';
import { document_binding_for_node } from '../../src/api/livetree/lifecycle/document-binding-state.ts';
import { get_dom_for_node, get_el_for_node, get_node_for_dom, link_node_to_el } from '../../src/api/livetree/utils/node-map-helpers.ts';
import { project_livetree } from '../../src/api/livetree/creation/project-live-tree.ts';
import { append_branches_atomic } from '../../src/api/livetree/methods/appends.ts';
import { collect_subtree_nodes } from '../../src/api/livetree/utils/subtree-traversal.ts';
import { content_target_for_owner } from '../../src/api/livetree/lifecycle/mutation-dom.ts';
import { set_livetree_quid_candidate_source_for_tests } from '../../src/api/livetree/quid/data-quid.ts';
import { own_disposable_for_subject } from '../../src/api/livetree/managers/lifecycle-registry.ts';
const n = (tag: string, ...children: HsonNode[]): HsonNode => ({ $_tag: tag, $_content: children });
const str = (value: string): HsonNode => ({ $_tag: '_hson_str', $_content: [value] });
function must(value: unknown, message: string): asserts value { if (!value)
    throw new Error(message); }
function at(node: HsonNode, ...path: number[]): HsonNode { for (const index of path) {
    const child = node.$_content[index];
    must(is_Node(child), 'missing graph path');
    node = child;
} return node; }
function same(actual: unknown, expected: unknown, message: string): void { must(actual === expected, message); }
function rejects(run: () => unknown): void { let rejected = false; try {
    run();
}
catch {
    rejected = true;
} must(rejected, 'expected rejection'); }
function equalEntries<T>(actual: readonly T[], expected: readonly T[], message: string): void { must(actual.length === expected.length && actual.every((v, i) => v === expected[i]), message); }
function claims(tree: LiveTree) { const r = runtime_for_tree(tree); return { active: [...r.quidToNode], pending: [...r.pendingQuidClaims], issued: [...r.issuedQuids], resources: [...r.ownerDisposables], kinds: [...r.ownerDisposableKinds] }; }
function unchangedClaims(tree: LiveTree, prior: ReturnType<typeof claims>): void { const now = claims(tree); for (const key of ['active', 'pending', 'resources', 'kinds'] as const) {
    same(now[key].length, prior[key].length, key + ' count');
    now[key].forEach((entry, i) => { same(entry[0], prior[key][i]![0], key + ' key'); same(entry[1], prior[key][i]![1], key + ' value'); });
} equalEntries(now.issued, prior.issued, 'issued ledger changed'); }
function correspondence(root: HsonNode): void {
    const seen = new Set<HsonNode>();
    const walk = (owner: HsonNode): void => {
        must(!seen.has(owner), 'duplicate active graph placement');
        seen.add(owner);
        const native = get_dom_for_node(owner);
        if (native)
            same(get_node_for_dom(native), owner, 'native mapping does not round-trip');
        for (const child of owner.$_content)
            if (is_Node(child)) {
                same(parent_for_node(child), owner, 'stale final parent for ' + child.$_tag);
                if (owner.$_tag === '_hson_elem') {
                    const elementOwner = parent_for_node(owner), target = elementOwner && content_target_for_owner(elementOwner), childNative = get_dom_for_node(child);
                    if (target && childNative)
                        same(childNative.parentNode, target, 'native child differs from final graph placement');
                }
                walk(child);
            }
    };
    walk(root);
}
function mount(tree: LiveTree): Element { const dom = project_livetree(subject_for_tree(tree)); must(dom.nodeType === 1, 'expected element'); const element = get_el_for_node(subject_for_tree(tree)); must(element, 'missing mapped element'); document.body?.appendChild(element); return element; }
const path = (...segments: number[]) => ({ kind: 'path' as const, path: validate_document_path([0, ...segments]) });
function mirrorFixture() {
    const schema = Hson.schema.fromHson('<type "document" tag "main" content <repeat <tag "section" content <repeat <tag "p" content "empty">>>>>' as never);
    const registry = hsonLiveMap.fromLibraries({ page: { document: n('_hson_root', n('main', n('_hson_elem', n('section', n('_hson_elem', n('p'), n('p'))), n('section', n('_hson_elem', n('p')))))), schema } });
    const page = registry.lib('page'), binding = hsonMirror(page), root = subject_for_tree(binding.tree), main = at(root, 0);
    const a = binding.tree.findAll.byTag('p').array();
    // Explicit canonical acquisition supplies continuity evidence for only two subjects.
    const qa = a[0]!.quid, qb = a[2]!.quid;
    const replacement = () => n('_hson_elem', n('section', n('_hson_elem', n('p'), n('p'))), n('section', n('_hson_elem', n('p'))));
    const lineage = [{ source: validate_document_path([0, 0, 0]), destination: validate_document_path([1, 0, 0]) }, { source: validate_document_path([1, 0, 0]), destination: validate_document_path([0, 0, 0]) }];
    return { registry, page, binding, root, main, a: a[0]!, b: a[2]!, qa, qb, replacement, lineage };
}
export function cut5_repair_cases(check: (name: string, run: () => void) => void): void {
    check('F1 cross-parent lineage swap publishes exact final parent indexes', () => {
        const f = mirrorFixture(), dom = mount(f.binding.tree.find.must.byTag('main')), a = subject_for_tree(f.a), b = subject_for_tree(f.b), ad = get_dom_for_node(a), bd = get_dom_for_node(b);
        try {
            f.page.document.content.replace(path(), 0, f.replacement(), f.lineage);
            same(f.binding.status, 'active', 'continuity failed');
            same(at(f.main, 0, 1, 0, 0), a, 'a identity replaced');
            same(at(f.main, 0, 0, 0, 0), b, 'b identity replaced');
            correspondence(f.root);
            same(get_dom_for_node(a), ad, 'a native identity changed');
            same(get_dom_for_node(b), bd, 'b native identity changed');
            must(dom.childNodes.length === 2, 'native owners missing');
            f.a.remove();
            same(at(f.main, 0, 1).$_content.length, 0, 'remove left ELEM[]');
            correspondence(f.root);
            f.binding.dispose();
            f.b.detach();
            correspondence(f.root);
            const elsewhere = new LiveTree(n('main'));
            mount(elsewhere);
            elsewhere.append(f.b);
            same(get_dom_for_node(b), bd, 'detach append changed native');
            correspondence(subject_for_tree(elsewhere));
            elsewhere.remove();
        }
        finally {
            f.binding.dispose();
            f.binding.tree.remove();
        }
    });
    check('F1 same-parent reorder and sparse moves preserve placement and no-mint', () => {
        const f = mirrorFixture();
        mount(f.binding.tree.find.must.byTag('main'));
        try {
            const original = subject_for_tree(f.a), native = get_dom_for_node(original);
            f.page.document.content.move(path(0, 0, 0), 0, 1);
            correspondence(f.root);
            same(at(f.main, 0, 0, 0, 1), original, 'reorder cloned subject');
            same(get_dom_for_node(original), native, 'reorder cloned DOM');
            const sparse = at(f.main, 0, 0, 0, 0), before = claims(f.binding.tree);
            f.page.document.content.move(path(0, 0, 0), 0, 1);
            same(at(f.main, 0, 0, 0, 1), sparse, 'sparse move replaced subject');
            same(sparse.$_meta, undefined, 'sparse move minted');
            unchangedClaims(f.binding.tree, before);
            correspondence(f.root);
        }
        finally {
            f.binding.dispose();
            f.binding.tree.remove();
        }
    });
    check('F1/F2 Mirror notification observes completed correspondence and revision', () => {
        const f = mirrorFixture();
        mount(f.binding.tree.find.must.byTag('main'));
        const runtime = runtime_for_tree(f.binding.tree), before = f.registry.rev, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'reportError'), reports: unknown[] = [];
        let delivered = 0;
        Object.defineProperty(globalThis, 'reportError', { configurable: true, value: (error: unknown) => { reports.push(error); } });
        const first = () => { same(f.binding.sourceRevision, f.registry.rev, 'notification saw stale Mirror revision'); correspondence(f.root); throw new Error('Mirror realization observer failure'); }, second = () => { delivered++; };
        runtime.realizationListeners.add(first);
        runtime.realizationListeners.add(second);
        try {
            f.page.document.content.replace(path(), 0, f.replacement(), f.lineage);
            same(f.binding.status, 'active', 'observer failed completed Mirror');
            same(f.binding.sourceRevision, before + 1, 'Mirror completion lost revision');
            same(delivered, 1, 'Mirror fan-out aborted');
            same(reports.length, 1, 'Mirror observer error discarded');
            same(at(f.main, 0, 1, 0, 0), subject_for_tree(f.a), 'observer disturbed continuity');
        }
        finally {
            runtime.realizationListeners.delete(first);
            runtime.realizationListeners.delete(second);
            if (descriptor)
                Object.defineProperty(globalThis, 'reportError', descriptor);
            else
                Reflect.deleteProperty(globalThis, 'reportError');
            f.binding.dispose();
            f.binding.tree.remove();
        }
    });
    check('F5 failed mixed replacement restores bindings, exact graph and correspondence', () => {
        const f = mirrorFixture(), dom = get_el_for_node(f.main) ?? mount(f.binding.tree.find.must.byTag('main'));
        const nodes = collect_subtree_nodes(f.root, 'pre'), content = nodes.map(node => node.$_content), registrations = nodes.map(document_binding_for_node), parents = nodes.map(parent_for_node), natives = nodes.map(get_dom_for_node), before = claims(f.binding.tree), revision = f.registry.rev;
        const original = dom.replaceChildren;
        dom.replaceChildren = () => { throw new Error('injected Mirror native failure'); };
        try {
            f.page.document.content.replace(path(), 0, f.replacement(), f.lineage);
        }
        finally {
            dom.replaceChildren = original;
        }
        try {
            same(f.binding.status, 'failed', 'Mirror did not fail closed');
            same(f.registry.rev, revision + 1, 'accepted map commit reversed');
            same(f.page.document.byQuid(f.qa)?.$_tag, 'p', 'canonical identity lost');
            nodes.forEach((node, i) => { same(node.$_content, content[i], 'old graph shell not restored'); same(document_binding_for_node(node), registrations[i], 'restored binding lost'); same(parent_for_node(node), parents[i], 'restored parent lost'); same(get_dom_for_node(node), natives[i], 'restored DOM mapping lost'); });
            unchangedClaims(f.binding.tree, before);
            correspondence(f.root);
            const graph = JSON.stringify(f.root);
            rejects(() => f.a.attrs.set('title', 'illegal local mutation'));
            rejects(() => f.a.quid);
            same(JSON.stringify(f.root), graph, 'failed bound handle mutated locally');
            same(document_binding_for_node(subject_for_tree(f.a))?.canonicalPath.join('.'), '0.0.0.0.0', 'restored path index lost');
        }
        finally {
            f.binding.dispose();
            f.binding.tree.remove();
        }
    });
    check('F1/F5 fallible correspondence validation restores the prior failed projection', () => {
        const f = mirrorFixture(), dom = mount(f.binding.tree.find.must.byTag('main')), nodes = collect_subtree_nodes(f.root, 'pre'), content = nodes.map(node => node.$_content), registrations = nodes.map(document_binding_for_node), natives = nodes.map(get_dom_for_node), before = claims(f.binding.tree), revision = f.registry.rev;
        const replace = dom.replaceChildren, get = dom.getAttribute;
        let armed = false;
        dom.replaceChildren = function (...children: (Node | string)[]) { const result = replace.apply(this, children); armed = true; return result; };
        dom.getAttribute = function (name) { if (armed && name === 'hson:quid')
            throw new Error('late correspondence validation fault'); return get.call(this, name); };
        try {
            f.page.document.content.replace(path(), 0, f.replacement(), f.lineage);
        }
        finally {
            dom.replaceChildren = replace;
            dom.getAttribute = get;
        }
        try {
            must(armed, 'failure preceded native application');
            same(f.binding.status, 'failed', 'late correspondence failure was not fenced');
            same(f.registry.rev, revision + 1, 'late failure reversed accepted map commit');
            nodes.forEach((node, i) => { same(node.$_content, content[i], 'late failure left final graph installed'); same(document_binding_for_node(node), registrations[i], 'late failure changed binding identity'); same(get_dom_for_node(node), natives[i], 'late failure lost native identity'); });
            unchangedClaims(f.binding.tree, before);
            correspondence(f.root);
            same(f.binding.diagnostics().registeredElements, registrations.filter(Boolean).length - 1, 'late failure kept abandoned registrations');
            rejects(() => f.a.text.set('illegal'));
            rejects(() => f.b.detach());
            rejects(() => f.a.remove());
            same(f.registry.rev, revision + 1, 'failed handle delegated mutation');
        }
        finally {
            f.binding.dispose();
            f.binding.tree.remove();
        }
    });
    for (const mode of ['single', 'atomic', 'factory', 'detached'] as const)
        check('F2 ' + mode + ' completes before fair observer notification', () => {
            const target = new LiveTree(n('main')), source = new LiveTree(n('section', n('_hson_elem', n('b')))), a = new LiveTree(n('p')), b = new LiveTree(n('i')), dom = mount(target);
            mount(source);
            const transferred = at(subject_for_tree(source), 0, 0), native = get_dom_for_node(transferred), cap = source.detachContents(), runtime = runtime_for_tree(target);
            const order: number[] = [], reports: unknown[] = [];
            const priorReporter = Object.getOwnPropertyDescriptor(globalThis, 'reportError');
            Object.defineProperty(globalThis, 'reportError', { configurable: true, value: (cause: unknown) => { reports.push(cause); } });
            const first = () => { order.push(1); if (mode === 'detached')
                must(cap.isAttached, 'capability not consumed before observer'); const children = at(subject_for_tree(target), 0).$_content.filter(is_Node); same(children.length, mode === 'atomic' || mode === 'factory' ? 2 : 1, 'observer saw partial graph'); children.forEach(child => { const q = runtime.nodeToQuid.get(child); must(q && runtime.quidToNode.get(q) === child && runtime.issuedQuids.has(q), 'observer saw partial identity'); }); throw new Error('first observer fault'); };
            const second = () => { order.push(2); throw new Error('second observer fault'); };
            const third = () => { order.push(3); };
            [first, second, third].forEach(listener => runtime.realizationListeners.add(listener));
            try {
                if (mode === 'single')
                    same(target.append(a), target, 'single completion');
                else if (mode === 'atomic')
                    same(append_branches_atomic(target, [a, b]), target, 'atomic completion');
                else if (mode === 'factory')
                    same(target.create.tags(['p', 'i']).length, 2, 'factory completion');
                else {
                    same(cap.appendTo(target), target, 'transfer completion');
                    same(get_dom_for_node(transferred), native, 'transfer changed DOM');
                    rejects(() => cap.appendTo(target));
                }
                equalEntries(order, [1, 2, 3], 'observer order/delivery');
                same(reports.length, 2, 'observer errors discarded');
                correspondence(subject_for_tree(target));
                same(dom.childNodes.length, mode === 'atomic' || mode === 'factory' ? 2 : 1, 'DOM completion');
            }
            finally {
                [first, second, third].forEach(listener => runtime.realizationListeners.delete(listener));
                if (priorReporter)
                    Object.defineProperty(globalThis, 'reportError', priorReporter);
                else
                    Reflect.deleteProperty(globalThis, 'reportError');
                target.remove();
                source.remove();
                a.remove();
                b.remove();
            }
        });
    for (const mode of ['missing', 'throws', 'getter'] as const)
        check('F2 reporting fallback ' + mode + ' never rejects completion', () => {
            const tree = new LiveTree(n('main')), child = new LiveTree(n('p'));
            mount(tree);
            const runtime = runtime_for_tree(tree), error = new Error('observer error'), reportingError = new Error('reporting error'), reports: unknown[] = [];
            const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'reportError'), original = console.error;
            if (mode === 'missing')
                Reflect.deleteProperty(globalThis, 'reportError');
            else if (mode === 'getter')
                Object.defineProperty(globalThis, 'reportError', { configurable: true, get() { throw reportingError; } });
            else
                Object.defineProperty(globalThis, 'reportError', { configurable: true, value() { throw reportingError; } });
            console.error = (...args: unknown[]) => { reports.push(...args); };
            let delivered = false;
            const throwing = () => { throw error; }, following = () => { delivered = true; };
            runtime.realizationListeners.add(throwing);
            runtime.realizationListeners.add(following);
            try {
                same(tree.append(child), tree, 'reporting failure rejected mutation');
                must(delivered, 'reporting failure interrupted delivery');
                same(reports.length, 1, 'fallback did not report');
                const report = reports[0];
                must(report instanceof Error, 'missing reported error');
                if (mode === 'missing')
                    same(report.cause, error, 'original observer error discarded');
                else {
                    must(report instanceof AggregateError, 'reporting failure not retained');
                    same(report.errors[0].cause, error, 'observer error lost');
                    same(report.errors[1], reportingError, 'reporter error lost');
                }
            }
            finally {
                runtime.realizationListeners.delete(throwing);
                runtime.realizationListeners.delete(following);
                console.error = original;
                if (descriptor)
                    Object.defineProperty(globalThis, 'reportError', descriptor);
                else
                    Reflect.deleteProperty(globalThis, 'reportError');
                tree.remove();
                child.remove();
            }
        });
    check('F2 subscription changes retain snapshot order and nested batch notifications', () => {
        const target = new LiveTree(n('main')), nested = new LiveTree(n('section')), a = new LiveTree(n('p')), b = new LiveTree(n('p')), c = new LiveTree(n('i'));
        mount(target);
        mount(nested);
        const runtime = runtime_for_tree(target), order: string[] = [];
        let nesting = false;
        const added = () => { order.push('added'); }, second = () => { order.push(nesting ? 'inner2' : 'outer2'); };
        const first = () => { order.push(nesting ? 'inner1' : 'outer1'); if (nesting)
            return; runtime.realizationListeners.delete(second); runtime.realizationListeners.add(added); nesting = true; same(nested.append(c), nested, 'nested completion'); nesting = false; };
        runtime.realizationListeners.add(first);
        runtime.realizationListeners.add(second);
        try {
            same(append_branches_atomic(target, [a, b]), target, 'batch completion');
            equalEntries(order, ['outer1', 'inner1', 'added', 'outer2'], 'notification snapshot/order changed');
            correspondence(subject_for_tree(target));
            correspondence(subject_for_tree(nested));
        }
        finally {
            [first, second, added].forEach(listener => runtime.realizationListeners.delete(listener));
            target.remove();
            nested.remove();
            a.remove();
            b.remove();
            c.remove();
        }
    });
    for (const newCount of [1, 3])
        check('F3 late routing rollback preserves existing mapped identities and pending claims ' + newCount, () => {
            const target = new LiveTree(n('main')), branch = new LiveTree(n('section', n('_hson_elem', n('b'), ...Array.from({ length: newCount }, () => n('p'))))), parked = branch.find.must.byTag('b'), unrelated = new LiveTree(n('aside'));
            mount(target);
            const retainedNative = mount(parked);
            parked.detach();
            branch.append(parked);
            const runtime = runtime_for_tree(target), nodes = collect_subtree_nodes(subject_for_tree(branch), 'pre'), oldMeta = nodes.map(node => node.$_meta), oldQ = nodes.map(node => runtime.nodeToQuid.get(node)), oldDom = nodes.map(get_dom_for_node), oldParents = nodes.map(node => get_dom_for_node(node)?.parentNode), context = historic_root_for_tree(branch), priorTarget = subject_for_tree(target).$_content;
            runtime.issuedQuids.add('000000998');
            runtime.pendingQuidClaims.set('000000997', subject_for_tree(unrelated));
            const before = claims(target), disposed = Object.getOwnPropertyDescriptor(runtime, 'disposed')!, add = runtime.issuedQuids.add;
            let newlyIssued = 0, armed = false;
            runtime.issuedQuids.add = function (q) { const result = add.call(this, q); if (!before.issued.includes(q) && ++newlyIssued === newCount)
                armed = true; return result; };
            Object.defineProperty(runtime, 'disposed', { configurable: true, get() { if (armed)
                    throw new Error('late runtime routing failure after identity plans'); return false; } });
            try {
                rejects(() => target.append(branch));
            }
            finally {
                runtime.issuedQuids.add = add;
                Object.defineProperty(runtime, 'disposed', disposed);
            }
            try {
                same(newlyIssued, newCount, 'missing complete identity staging');
                unchangedClaims(target, before);
                same(subject_for_tree(target).$_content, priorTarget, 'target rollback lost graph');
                same(historic_root_for_tree(branch), context, 'historic context changed');
                nodes.forEach((node, i) => { same(node.$_meta, oldMeta[i], 'prior metadata changed'); same(runtime.nodeToQuid.get(node), oldQ[i], 'prior reverse identity changed'); same(get_dom_for_node(node), oldDom[i], 'prior DOM mapping changed'); same(get_dom_for_node(node)?.parentNode, oldParents[i], 'prior native parent changed'); same(runtime_for_node(node), runtime, 'prior routing released'); });
                same(get_dom_for_node(subject_for_tree(parked)), retainedNative, 'retained native was recreated');
                correspondence(subject_for_tree(branch));
                target.append(branch);
                correspondence(subject_for_tree(target));
            }
            finally {
                runtime.pendingQuidClaims.delete('000000997');
                target.remove();
                branch.remove();
                unrelated.remove();
            }
        });
    for (const mounted of [false, true])
        check('F3 private factory failure rolls back earlier root issuance ' + mounted, () => {
            const tree = new LiveTree(n('main'));
            if (mounted)
                mount(tree);
            const runtime = runtime_for_tree(tree), before = claims(tree), original = runtime.quidToNode.set;
            let writes = 0;
            runtime.quidToNode.set = function (q, node) { if (!before.active.some(([known]) => known === q) && ++writes === 2)
                throw new Error('second factory identity fault'); return original.call(this, q, node); };
            try {
                rejects(() => tree.create.tags(['p', 'i']));
            }
            finally {
                runtime.quidToNode.set = original;
            }
            try {
                unchangedClaims(tree, before);
                same(subject_for_tree(tree).$_content.length, 0, 'factory graph partially attached');
                if (mounted)
                    same(get_el_for_node(subject_for_tree(tree))!.childNodes.length, 0, 'factory DOM partially attached');
                same(tree.create.tags(['p', 'i']).length, 2, 'factory retry failed');
            }
            finally {
                tree.remove();
            }
        });
    for (const newCount of [1, 3])
        check('F3 partial publication preserves prior identity with ' + newCount + ' new descendants', () => {
            const target = new LiveTree(n('main')), branch = new LiveTree(n('section', n('_hson_elem', ...Array.from({ length: newCount }, () => n('p'))))), other = new LiveTree(n('aside', n('_hson_elem', n('i'))));
            mount(target);
            const runtime = runtime_for_tree(target), nodes = [...collect_subtree_nodes(subject_for_tree(branch), 'pre'), ...collect_subtree_nodes(subject_for_tree(other), 'pre')], oldMeta = nodes.map(node => node.$_meta), oldQ = nodes.map(node => runtime.nodeToQuid.get(node)), oldRuntime = nodes.map(runtime_for_node), before = claims(target), targetContent = subject_for_tree(target).$_content, contexts = [historic_root_for_tree(branch), historic_root_for_tree(other)];
            const original = runtime.quidToNode.set;
            let published = 0, partial = false;
            runtime.quidToNode.set = function (q, node) { if (oldQ[nodes.indexOf(node)] === undefined && ++published > newCount) {
                partial = published > 1;
                throw new Error('injected late identity publication');
            } return original.call(this, q, node); };
            try {
                rejects(() => append_branches_atomic(target, [branch, other]));
            }
            finally {
                runtime.quidToNode.set = original;
            }
            try {
                must(partial, 'fault was not after partial publication');
                unchangedClaims(target, before);
                same(subject_for_tree(target).$_content, targetContent, 'target graph changed');
                same(get_el_for_node(subject_for_tree(target))!.childNodes.length, 0, 'target DOM changed');
                nodes.forEach((node, i) => { same(node.$_meta, oldMeta[i], 'identity metadata shell changed'); same(runtime.nodeToQuid.get(node), oldQ[i], 'reverse claim changed'); same(runtime_for_node(node), oldRuntime[i], 'runtime association changed'); same(get_dom_for_node(node), undefined, 'staged mapping leaked'); });
                same(historic_root_for_tree(branch), contexts[0], 'branch historic context changed');
                same(historic_root_for_tree(other), contexts[1], 'other context changed');
                same(parent_for_node(subject_for_tree(branch)), undefined, 'failed branch placement');
                append_branches_atomic(target, [branch, other]);
                correspondence(subject_for_tree(target));
            }
            finally {
                target.remove();
                branch.remove();
                other.remove();
            }
        });
    for (const mounted of [false, true])
        for (const kind of ['set', 'add', 'insert', 'overwrite'] as const)
            check('F4 ' + kind + ' late routing failure ' + (mounted ? 'mounted' : 'headless'), () => {
                const tree = new LiveTree(n('main', n('_hson_elem', str('old'), n('button')))), root = subject_for_tree(tree), bucket = at(root, 0), nodes = collect_subtree_nodes(root, 'pre'), prior = bucket.$_content, parents = nodes.map(parent_for_node), runtime = runtime_for_tree(tree);
                if (mounted)
                    mount(tree);
                let retired = 0;
                own_disposable_for_subject(at(root, 0, 0), () => retired++, 'other', runtime);
                own_disposable_for_subject(at(root, 0, 1), () => retired++, 'other', runtime);
                const natives = nodes.map(get_dom_for_node), dom = get_el_for_node(root), children = dom ? Array.from(dom.childNodes) : [], before = claims(tree);
                let candidate: HsonNode | undefined;
                const descriptor = Object.getOwnPropertyDescriptor(runtime, 'disposed')!;
                Object.defineProperty(runtime, 'disposed', { configurable: true, get() { if (bucket.$_content !== prior) {
                        candidate = bucket.$_content.find((child): child is HsonNode => is_Node(child) && !prior.includes(child));
                        throw new Error('injected late text routing');
                    } return false; } });
                try {
                    rejects(() => kind === 'insert' ? tree.text.insert(1, 'new') : tree.text[kind]('new'));
                }
                finally {
                    Object.defineProperty(runtime, 'disposed', descriptor);
                }
                try {
                    must(candidate, 'new text was not staged');
                    same(bucket.$_content, prior, 'text graph did not roll back');
                    nodes.forEach((node, i) => { same(parent_for_node(node), parents[i], 'prior parent lost'); same(runtime_for_node(node), runtime, 'prior routing lost'); same(get_dom_for_node(node), natives[i], 'prior native mapping lost'); });
                    if (dom)
                        equalEntries(Array.from(dom.childNodes), children, 'old native Text not restored');
                    same(parent_for_node(candidate), undefined, 'new text parent leaked');
                    same(runtime_for_node(candidate), undefined, 'new routing leaked');
                    same(get_dom_for_node(candidate), undefined, 'new text mapping leaked');
                    unchangedClaims(tree, before);
                    same(retired, 0, 'failed text write retired prior resources');
                    correspondence(root);
                    if (kind === 'insert')
                        tree.text.insert(1, 'retry');
                    else
                        tree.text[kind]('retry');
                    correspondence(root);
                }
                finally {
                    tree.remove();
                }
            });
    for (const mounted of [false, true])
        check('F4 fresh text relationship rolls back late routing ' + mounted, () => {
            const tree = new LiveTree(n('main'));
            if (mounted)
                mount(tree);
            const root = subject_for_tree(tree), prior = root.$_content, runtime = runtime_for_tree(tree), before = claims(tree), descriptor = Object.getOwnPropertyDescriptor(runtime, 'disposed')!;
            let candidate: HsonNode | undefined, leaf: HsonNode | undefined;
            Object.defineProperty(runtime, 'disposed', { configurable: true, get() { if (root.$_content !== prior) {
                    candidate = at(root, 0);
                    leaf = at(candidate, 0);
                    throw new Error('new relationship routing fault');
                } return false; } });
            try {
                rejects(() => tree.text.set('new'));
            }
            finally {
                Object.defineProperty(runtime, 'disposed', descriptor);
            }
            try {
                must(candidate && leaf, 'new relationship was not staged');
                same(root.$_content, prior, 'new relationship graph leaked');
                same(parent_for_node(candidate), undefined, 'new relationship parent leaked');
                same(runtime_for_node(candidate), undefined, 'new relationship runtime leaked');
                same(runtime_for_node(leaf), undefined, 'new leaf routing leaked');
                same(parent_for_node(leaf), undefined, 'new leaf parent leaked');
                unchangedClaims(tree, before);
                tree.text.set('retry');
                correspondence(root);
            }
            finally {
                tree.remove();
            }
        });
    for (const populated of [false, true])
        check('F2/F6 late transfer routing remains transactional ' + populated, () => {
            const source = new LiveTree(n('section', n('_hson_elem', n('p')))), target = new LiveTree(populated ? n('main', n('_hson_elem', n('i'))) : n('main'));
            mount(source);
            const dom = mount(target), relationship = at(subject_for_tree(source), 0), content = [...relationship.$_content], native = content.filter(is_Node).map(get_dom_for_node), parents = content.filter(is_Node).map(parent_for_node), cap = source.detachContents(), graph = subject_for_tree(target).$_content, childContent = populated ? at(subject_for_tree(target), 0).$_content : undefined, children = Array.from(dom.childNodes), runtime = runtime_for_tree(target), before = claims(target), descriptor = Object.getOwnPropertyDescriptor(runtime, 'disposed')!;
            let publishedChecks = 0;
            Object.defineProperty(runtime, 'disposed', { configurable: true, get() { if (subject_for_tree(target).$_content !== graph || (populated && at(subject_for_tree(target), 0).$_content !== childContent))
                    if (++publishedChecks === 2)
                        throw new Error('late detached transfer routing fault'); return false; } });
            try {
                rejects(() => cap.appendTo(target));
            }
            finally {
                Object.defineProperty(runtime, 'disposed', descriptor);
            }
            try {
                same(publishedChecks, 2, 'routing failure was not late');
                same(cap.isAttached, false, 'transactional failure consumed capability');
                same(subject_for_tree(target).$_content, graph, 'rejected transfer changed graph');
                equalEntries(Array.from(dom.childNodes), children, 'rejected transfer changed native children');
                same(parent_for_node(relationship), undefined, 'rejected transfer claimed relationship');
                content.filter(is_Node).forEach((node, i) => { same(parent_for_node(node), parents[i], 'rejected transfer changed child parent'); same(get_dom_for_node(node), native[i], 'rejected transfer replaced native'); must(get_dom_for_node(node)?.parentNode == null, 'rejected transfer moved detached native'); });
                unchangedClaims(target, before);
                cap.appendTo(target);
                must(cap.isAttached, 'late rejection prevented valid retry');
                correspondence(subject_for_tree(target));
            }
            finally {
                source.remove();
                target.remove();
            }
        });
    check('F2/F3 batch context retains authenticated retired roots and rejects invented roots', () => {
        const original = new LiveTree(n('main', n('_hson_elem', n('section')))), detacher = original.find.must.byTag('section'), target = new LiveTree(detacher), a = new LiveTree(n('p')), b = new LiveTree(n('i'));
        const context = historic_root_for_tree(target);
        detacher.detach();
        original.remove();
        mount(target);
        try {
            rejects(() => target.adoptRoots(n('_hson_root', n('main'))));
            const before = claims(target);
            rejects(() => append_branches_atomic(target, [a, a]));
            unchangedClaims(target, before);
            same(historic_root_for_tree(a), subject_for_tree(a), 'rejection changed prior standalone context');
            append_branches_atomic(target, [a, b]);
            same(historic_root_for_tree(a), context, 'retired context not inherited');
            same(historic_root_for_tree(b), context, 'batch context diverged');
            must(original.isDisposed && !a.isDisposed && !b.isDisposed, 'historical root was reactivated');
            correspondence(subject_for_tree(target));
        }
        finally {
            target.remove();
            a.remove();
            b.remove();
            original.remove();
        }
    });
    check('F6 shared HTML/SVG title spellings use actual receiving namespace', () => {
        for (const mounted of [false, true]) {
            const source = new LiveTree(n('section', n('_hson_elem', n('title', n('_hson_elem', str('title')))))), target = new LiveTree(n('main'));
            if (mounted) {
                mount(source);
                mount(target);
            }
            const title = at(subject_for_tree(source), 0, 0), native = get_dom_for_node(title), cap = source.detachContents();
            try {
                cap.appendTo(target);
                same(at(subject_for_tree(target), 0, 0), title, 'HTML title was recreated');
                same(get_dom_for_node(title), native, 'HTML title native identity changed');
                if (mounted)
                    same(get_el_for_node(title)?.namespaceURI, 'http://www.w3.org/1999/xhtml', 'HTML title namespace changed');
            }
            finally {
                source.remove();
                target.remove();
            }
        }
        const source = new LiveTree(n('svg', n('_hson_elem', n('title', n('_hson_elem', str('svg title')))))), html = new LiveTree(n('main')), svg = new LiveTree(n('svg'));
        mount(source);
        mount(html);
        mount(svg);
        const title = at(subject_for_tree(source), 0, 0), native = get_dom_for_node(title), cap = source.detachContents();
        try {
            rejects(() => cap.appendTo(html));
            same(cap.isAttached, false, 'SVG title rejection consumed capability');
            cap.appendTo(svg);
            same(get_dom_for_node(title), native, 'SVG title retry recreated native');
        }
        finally {
            source.remove();
            html.remove();
            svg.remove();
        }
    });
    check('F6 complete transferred subtree checks descendant namespace before staging', () => {
        const source = new LiveTree(n('section', n('_hson_elem', n('svg', n('_hson_elem', n('circle')))))), target = new LiveTree(n('main'));
        mount(source);
        const targetDom = mount(target), svg = at(subject_for_tree(source), 0, 0), circle = at(svg, 0, 0), original = get_el_for_node(circle)!;
        const foreign = document.createElement('circle');
        link_node_to_el(circle, foreign);
        const cap = source.detachContents(), graph = subject_for_tree(target).$_content, before = claims(target);
        try {
            rejects(() => cap.appendTo(target));
            same(cap.isAttached, false, 'descendant mismatch consumed capability');
            same(subject_for_tree(target).$_content, graph, 'descendant mismatch changed graph');
            same(targetDom.childNodes.length, 0, 'descendant mismatch staged DOM');
            unchangedClaims(target, before);
            same(get_dom_for_node(circle), foreign, 'preflight rewrote native mapping');
            link_node_to_el(circle, original);
            cap.appendTo(target);
            same(get_el_for_node(svg)?.namespaceURI, 'http://www.w3.org/2000/svg', 'nested transition lost SVG namespace');
            same(get_dom_for_node(circle), original, 'valid retry recreated descendant');
        }
        finally {
            link_node_to_el(circle, original);
            source.remove();
            target.remove();
        }
    });
    for (const mounted of [false, true])
        for (const populated of [false, true])
            check('F6 SVG transfer rejects HTML and retries in SVG ' + mounted + '/' + populated, () => {
                const source = new LiveTree(n('svg', n('_hson_elem', n('circle')))), html = new LiveTree(populated ? n('main', n('_hson_elem', n('p'))) : n('main')), svg = new LiveTree(populated ? n('svg', n('_hson_elem', n('path'))) : n('svg'));
                if (mounted) {
                    mount(source);
                    mount(html);
                    mount(svg);
                }
                const circle = at(subject_for_tree(source), 0, 0), native = get_dom_for_node(circle);
                let released = 0, clicks = 0;
                own_disposable_for_subject(circle, () => released++, 'other', runtime_for_tree(source));
                if (mounted)
                    source.find.must.byTag('circle').listen.onClick(() => clicks++);
                const cap = source.detachContents(), before = claims(html), graph = subject_for_tree(html).$_content;
                try {
                    rejects(() => cap.appendTo(html));
                    same(cap.isAttached, false, 'incompatible transfer consumed');
                    same(subject_for_tree(html).$_content, graph, 'HTML graph changed');
                    unchangedClaims(html, before);
                    same(released, 0, 'rejection retired transferred resources');
                    same(get_dom_for_node(circle), native, 'native mapping changed');
                    if (mounted) {
                        native!.dispatchEvent(new Event('click'));
                        same(clicks, 1, 'rejection released retained listener');
                    }
                    cap.appendTo(svg);
                    same(cap.isAttached, true, 'valid retry did not consume');
                    same(at(subject_for_tree(svg), 0).$_content.at(-1), circle, 'retry cloned subject');
                    same(get_dom_for_node(circle), native, 'retry cloned native');
                    if (mounted)
                        same(get_el_for_node(circle)?.namespaceURI, 'http://www.w3.org/2000/svg', 'wrong SVG namespace');
                    correspondence(subject_for_tree(svg));
                    same(released, 0, 'retry retired retained resource');
                    if (mounted) {
                        native!.dispatchEvent(new Event('click'));
                        same(clicks, 2, 'retry lost native listener');
                    }
                }
                finally {
                    source.remove();
                    html.remove();
                    svg.remove();
                }
                same(released, 1, 'terminal cleanup did not release retained resource exactly once');
            });
    for (const mounted of [false, true])
        for (const populated of [false, true])
            check('F6 foreignObject receives HTML children ' + mounted + '/' + populated, () => {
                const source = new LiveTree(n('main', n('_hson_elem', n('p', n('_hson_elem', str('html'))))));
                const target = new LiveTree(n('svg', n('_hson_elem', populated ? n('foreignObject', n('_hson_elem', n('div'))) : n('foreignObject'))));
                if (mounted) { mount(source); mount(target); }
                const receiver = target.find.must.byTag('foreignObject'), child = at(subject_for_tree(source), 0, 0);
                const nodes = collect_subtree_nodes(child, 'pre'), natives = nodes.map(get_dom_for_node), before = claims(target);
                const cap = source.detachContents();
                try {
                    same(cap.appendTo(receiver), receiver, 'foreignObject transfer rejected');
                    must(cap.isAttached, 'foreignObject capability remained available');
                    same(at(subject_for_tree(receiver), 0).$_content.at(-1), child, 'foreignObject cloned graph child');
                    nodes.forEach((node, i) => same(get_dom_for_node(node), natives[i], 'foreignObject replaced native correspondence'));
                    unchangedClaims(target, before);
                    correspondence(subject_for_tree(target));
                    if (mounted) same(get_el_for_node(child)?.namespaceURI, 'http://www.w3.org/1999/xhtml', 'foreignObject child is not HTML');
                    // Headless transfer must also realize through the lawful
                    // SVG -> foreignObject -> HTML receiving context later.
                    if (!mounted) {
                        mount(target);
                        same(get_el_for_node(child)?.namespaceURI, 'http://www.w3.org/1999/xhtml', 'headless foreignObject realization is not HTML');
                        correspondence(subject_for_tree(target));
                    }
                    rejects(() => cap.appendTo(receiver));
                } finally { source.remove(); target.remove(); }
            });
    check('F6 complete nested SVG/foreignObject forest retains native namespace and identity', () => {
        const source = new LiveTree(n('main', n('_hson_elem', n('svg', n('_hson_elem', n('foreignObject', n('_hson_elem', n('p')))))))), target = new LiveTree(n('section'));
        mount(source); mount(target);
        const child = at(subject_for_tree(source), 0, 0), nodes = collect_subtree_nodes(child, 'pre'), natives = nodes.map(get_dom_for_node);
        const cap = source.detachContents();
        try {
            cap.appendTo(target);
            nodes.forEach((node, i) => same(get_dom_for_node(node), natives[i], 'nested integration replaced native'));
            same(get_el_for_node(at(child, 0, 0, 0, 0))?.namespaceURI, 'http://www.w3.org/1999/xhtml', 'nested integration lost HTML namespace');
            correspondence(subject_for_tree(target));
        } finally { source.remove(); target.remove(); }
    });
    check('F6 lawful HTML and nested SVG transfer retain native identity', () => {
        for (const nested of [false, true]) {
            const child = nested ? n('svg', n('_hson_elem', n('circle'))) : n('p'), source = new LiveTree(n('section', n('_hson_elem', child))), target = new LiveTree(n('main', n('_hson_elem', n('i'))));
            mount(source);
            mount(target);
            const original = at(subject_for_tree(source), 0, 0), native = get_dom_for_node(original), cap = source.detachContents();
            try {
                cap.appendTo(target);
                same(at(subject_for_tree(target), 0, 1), original, 'lawful transfer cloned');
                same(get_dom_for_node(original), native, 'lawful transfer DOM changed');
                correspondence(subject_for_tree(target));
            }
            finally {
                source.remove();
                target.remove();
            }
        }
    });
}
/** Reporting failure must survive the next host turn without uncaught handlers. */
export async function cut5_nonfatal_reporting_cases(): Promise<number> {
    let cases = 0;
    for (const mode of ['single', 'atomic', 'factory', 'detached'] as const)
        for (const facilities of ['throwing', 'missing', 'inaccessible'] as const) {
            const tree = new LiveTree(n('main')), child = new LiveTree(n('p'));
            const source = new LiveTree(n('section', n('_hson_elem', n('b'))));
            mount(tree); mount(source);
            const cap = source.detachContents(), runtime = runtime_for_tree(tree);
            const reporter = Object.getOwnPropertyDescriptor(globalThis, 'reportError');
            const consoleDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'console');
            const order: number[] = [];
            const throwing = () => { order.push(1); throw new Error('observer fault'); };
            const following = () => { order.push(2); };
            runtime.realizationListeners.add(throwing); runtime.realizationListeners.add(following);
            try {
                if (facilities === 'inaccessible') {
                    Object.defineProperty(globalThis, 'reportError', { configurable: true, get() { throw new Error('reportError inaccessible'); } });
                    Object.defineProperty(globalThis, 'console', { configurable: true, get() { throw new Error('console inaccessible'); } });
                } else if (facilities === 'missing') {
                    Reflect.deleteProperty(globalThis, 'reportError');
                    Reflect.deleteProperty(globalThis, 'console');
                } else {
                    Object.defineProperty(globalThis, 'reportError', { configurable: true, value() { throw new Error('reportError failed'); } });
                    Object.defineProperty(globalThis, 'console', { configurable: true, value: { error() { throw new Error('console failed'); } } });
                }
                if (mode === 'single') same(tree.append(child), tree, 'append completion');
                else if (mode === 'atomic') same(append_branches_atomic(tree, [child]), tree, 'atomic completion');
                else if (mode === 'factory') same(tree.create.tags(['p', 'i']).length, 2, 'factory completion');
                else { same(cap.appendTo(tree), tree, 'transfer completion'); must(cap.isAttached, 'capability was not consumed'); }
                equalEntries(order, [1, 2], 'failed reporting interrupted fan-out');
                correspondence(subject_for_tree(tree));
                for (const child of at(subject_for_tree(tree), 0).$_content) if (is_Node(child)) {
                    const q = runtime.nodeToQuid.get(child);
                    must(q && runtime.quidToNode.get(q) === child && runtime.issuedQuids.has(q), 'reporting failure damaged completed identity');
                }
                // An uncaught microtask or host task would terminate ordinary
                // Node/Worker execution before this awaited turn completes.
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                equalEntries(order, [1, 2], 'reporting scheduled duplicate delivery');
                cases++;
            } finally {
                runtime.realizationListeners.delete(throwing); runtime.realizationListeners.delete(following);
                if (reporter) Object.defineProperty(globalThis, 'reportError', reporter);
                else Reflect.deleteProperty(globalThis, 'reportError');
                if (consoleDescriptor) Object.defineProperty(globalThis, 'console', consoleDescriptor);
                else Reflect.deleteProperty(globalThis, 'console');
                tree.remove(); child.remove(); source.remove();
            }
        }
    return cases;
}

/** Native observer evidence survives rollback even when current attrs do not. */
export async function cut5_observable_identity_browser_cases() {
    let cases = 0;
    const evidence: Array<{
        fault: string; generated: string[]; observed: string[]; callbackIdentities: string[];
        attributeRecords: Array<{ name: string | null; oldValue: string | null }>;
        issuedAfterRejection: string[]; activeAfterRejection: string[]; pendingAfterRejection: string[];
        graphRestored: boolean; nativeRestored: boolean; candidateRejected: boolean;
    }> = [];
    for (const newCount of [1, 3])
        for (const fault of ['native-before-claims', 'partial-claims', 'native-identity', 'native-callback'] as const) {
            const target = new LiveTree(n('main'));
            let branch: LiveTree;
            const callbackIdentities: string[] = [];
            const customTag = 'x-cut5-exposure-' + newCount;
            if (fault === 'native-callback') customElements.define(customTag, class extends HTMLElement {
                static get observedAttributes() { return ['hson:quid']; }
                attributeChangedCallback(_name: string, _old: string | null, value: string | null) {
                    if (value === null) return;
                    // This is public observation in a real native callback.
                    const visit = (node: ReadonlyHsonNode): void => {
                        const q = node.$_meta?.quid;
                        if (typeof q === 'string') callbackIdentities.push(q);
                        for (const child of node.$_content) if (typeof child === 'object' && child !== null) visit(child);
                    };
                    visit(branch.node);
                }
            });
            branch = new LiveTree(n('section', n('_hson_elem', n('b'), ...Array.from({ length: newCount }, (_, index) => n(fault === 'native-callback' && index === 0 ? customTag : 'p', n('_hson_elem', str('new')))))));
            const parked = branch.find.must.byTag('b'), dom = mount(target), retained = mount(parked);
            parked.detach(); branch.append(parked);
            let released = 0, clicks = 0, notices = 0;
            const runtime = runtime_for_tree(target);
            parked.listen.onClick(() => clicks++);
            own_disposable_for_subject(subject_for_tree(parked), () => released++, 'other', runtime);
            const pendingOwner = new LiveTree(n('aside'));
            const pending = '000000996';
            runtime.pendingQuidClaims.set(pending, subject_for_tree(pendingOwner));
            const before = claims(target), root = subject_for_tree(branch), nodes = collect_subtree_nodes(root, 'pre');
            const shells = nodes.map(node => node.$_content), metas = nodes.map(node => node.$_meta), parents = nodes.map(parent_for_node), natives = nodes.map(get_dom_for_node), placements = natives.map(node => node?.parentNode);
            const historic = historic_root_for_tree(branch), graph = subject_for_tree(target).$_content;
            const candidates = Array.from({ length: newCount }, (_, i) => '000000v' + String(i + 1).padStart(2, '0'));
            // Each case uses a new candidate range: exposed history intentionally
            // remains unavailable for the lifetime of this shared runtime.
            for (let i = 0; candidates.some(q => runtime.issuedQuids.has(q)); i++)
                candidates.forEach((_, index) => { candidates[index] = '00000' + (i + 1).toString(36).padStart(2, '0') + (index + 1).toString(36).padStart(2, '0'); });
            const generated: string[] = [], records: MutationRecord[] = [];
            let nextCandidate = 0;
            let candidateProbe: LiveTree | undefined;
            set_livetree_quid_candidate_source_for_tests(runtime, () => {
                const candidate = candidates[nextCandidate++];
                must(candidate, 'unexpected extra identity generation'); generated.push(candidate); return candidate;
            });
            const observer = new MutationObserver(changes => records.push(...changes));
            observer.observe(dom, { subtree: true, childList: true, attributes: true, attributeOldValue: true });
            const notify = () => { notices++; };
            runtime.realizationListeners.add(notify);
            const replace = dom.replaceChildren, set = runtime.quidToNode.set, attr = Element.prototype.setAttribute;
            let publications = 0;
            if (fault === 'native-before-claims') dom.replaceChildren = () => { throw new Error('native reconciliation before identity'); };
            else if (fault === 'partial-claims') runtime.quidToNode.set = function (q, node) {
                const result = set.call(this, q, node);
                if (candidates.includes(q) && ++publications === Math.min(2, newCount)) throw new Error('partial internal identity publication');
                return result;
            };
            else Element.prototype.setAttribute = function (name, value) {
                attr.call(this, name, value);
                if (name === 'hson:quid' && candidates.includes(value) && ++publications === Math.min(2, newCount)) throw new Error('partial native identity publication');
            };
            try { rejects(() => target.append(branch)); }
            finally {
                dom.replaceChildren = replace; runtime.quidToNode.set = set; Element.prototype.setAttribute = attr;
                set_livetree_quid_candidate_source_for_tests(runtime, undefined);
            }
            try {
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                equalEntries(generated, candidates, 'identity plan did not generate complete candidates');
                same(subject_for_tree(target).$_content, graph, 'identity fault changed receiving graph');
                same(dom.childNodes.length, 0, 'identity fault retained native children');
                same(historic_root_for_tree(branch), historic, 'identity fault changed historic context');
                nodes.forEach((node, i) => {
                    same(node.$_content, shells[i], 'identity fault changed source array');
                    same(node.$_meta, metas[i], 'identity fault changed source metadata');
                    same(parent_for_node(node), parents[i], 'identity fault changed source parent');
                    same(runtime_for_node(node), runtime, 'identity fault changed source routing');
                    same(get_dom_for_node(node), natives[i], 'identity fault changed source native');
                    same(get_dom_for_node(node)?.parentNode, placements[i], 'identity fault changed native placement');
                });
                const after = claims(target);
                for (const key of ['active', 'pending', 'resources', 'kinds'] as const) {
                    same(after[key].length, before[key].length, key + ' count after identity fault');
                    after[key].forEach((entry, i) => { same(entry[0], before[key][i]![0], key + ' key'); same(entry[1], before[key][i]![1], key + ' ownership'); });
                }
                const exposed = records.filter(record => record.attributeName === 'hson:quid' && record.oldValue !== null && candidates.includes(record.oldValue)).map(record => record.oldValue!);
                if (fault === 'native-identity' || fault === 'native-callback') {
                    same(exposed.length, Math.min(2, newCount), 'native records did not retain exposed values');
                    equalEntries(after.issued, [...before.issued, ...candidates], 'observable plan history was forgotten');
                    if (fault === 'native-callback') for (const q of candidates) must(callbackIdentities.includes(q), 'native callback did not observe complete published identity plan');
                    for (const q of candidates) {
                        must(!runtime.quidToNode.has(q) && !runtime.pendingQuidClaims.has(q), 'rejected identity retained active or pending claim');
                        set_livetree_quid_candidate_source_for_tests(runtime, () => q);
                        try { rejects(() => new LiveTree(n('aside'))); }
                        finally { set_livetree_quid_candidate_source_for_tests(runtime, undefined); }
                        must(runtime.issuedQuids.has(q) && !runtime.quidToNode.has(q), 'deterministic candidate reused exposed identity');
                    }
                } else {
                    same(exposed.length, 0, 'provisional identities escaped before acceptance');
                    equalEntries(after.issued, before.issued, 'unobservable issuance was retained');
                    set_livetree_quid_candidate_source_for_tests(runtime, () => candidates[0]!);
                    try { candidateProbe = new LiveTree(n('aside')); same(candidateProbe.quid, candidates[0], 'unobservable provisional value became unavailable'); }
                    finally { set_livetree_quid_candidate_source_for_tests(runtime, undefined); }
                }
                same(notices, 0, 'rejected identity publication notified');
                same(released, 0, 'rejected identity publication released resource');
                retained.dispatchEvent(new Event('click')); same(clicks, 1, 'rejection lost retained listener');
                target.append(branch);
                correspondence(subject_for_tree(target));
                same(get_dom_for_node(subject_for_tree(parked)), retained, 'retry recreated existing native');
                if (fault === 'native-identity' || fault === 'native-callback') for (const q of candidates) must(!runtime.quidToNode.has(q), 'retry reassigned exposed identity');
                same(notices, 1, 'retry notification missing or duplicated');
                retained.dispatchEvent(new Event('click')); same(clicks, 2, 'retry lost retained listener');
                evidence.push({ fault, generated, observed: exposed, callbackIdentities, attributeRecords: records.filter(record => record.type === 'attributes').map(record => ({ name: record.attributeName, oldValue: record.oldValue })), issuedAfterRejection: after.issued.filter(q => candidates.includes(q)), activeAfterRejection: after.active.filter(([q]) => candidates.includes(q)).map(([q]) => q), pendingAfterRejection: after.pending.map(([q]) => q), graphRestored: true, nativeRestored: true, candidateRejected: fault === 'native-identity' || fault === 'native-callback' });
                cases++;
            } finally {
                observer.disconnect(); runtime.realizationListeners.delete(notify);
                runtime.pendingQuidClaims.delete(pending);
                target.remove(); branch.remove(); pendingOwner.remove(); candidateProbe?.remove();
            }
            same(released, 1, 'retained resource did not drain once');
        }
    return { cases, evidence };
}
