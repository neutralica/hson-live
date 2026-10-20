import { LiveTree } from '../../src/api/livetree/livetree.ts';
import { graft } from '../../src/api/livetree/creation/graft.ts';
import { project_livetree } from '../../src/api/livetree/creation/project-live-tree.ts';
import { default_livetree_runtime, runtime_for_tree, runtime_for_node, subject_for_tree } from '../../src/api/livetree/runtime/livetree-runtime.ts';
import { get_node_for_el, get_dom_for_node } from '../../src/api/livetree/utils/node-map-helpers.ts';
import { parent_for_node } from '../../src/api/livetree/lifecycle/graph-ownership.ts';
import { collect_subtree_nodes } from '../../src/api/livetree/utils/subtree-traversal.ts';
import { set_livetree_quid_candidate_source_for_tests } from '../../src/api/livetree/quid/data-quid.ts';
import { own_disposable_for_subject } from '../../src/api/livetree/managers/lifecycle-registry.ts';
import { append_branches_atomic } from '../../src/api/livetree/methods/appends.ts';
import { hsonLiveMap } from '../../src/api/livemap/livemap.facade.ts';
import { Hson } from '../../src/index.ts';
import type { HsonNode } from '../../src/core/types.ts';

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function reject(run: () => unknown): unknown { try { run(); } catch (cause) { return cause; } throw new Error('expected rejection'); }
function node(tag: string, ...content: HsonNode[]): HsonNode { return { $_tag: tag, $_content: content }; }
function mount(tree: LiveTree): Element { const el = project_livetree(subject_for_tree(tree)); check(el.nodeType === 1, 'element'); document.body?.appendChild(el); return tree.dom.el()!; }
function entriesEqual<T>(actual: readonly T[], expected: readonly T[], name: string): void { check(actual.length === expected.length && actual.every((v, i) => v === expected[i]), name); }
function state(tree: LiveTree) { const r = runtime_for_tree(tree); return { active: [...r.quidToNode], issued: [...r.issuedQuids], pending: [...r.pendingQuidClaims], resources: [...r.ownerDisposables].map(([owner, entries]) => ({owner, entries: [...entries]})), kinds: [...r.ownerDisposableKinds].map(([owner, entries]) => ({owner, entries: [...entries]})) }; }
function sameState(tree: LiveTree, before: ReturnType<typeof state>, history = before.issued): void {
  const after = state(tree);
  for (const key of ['active', 'pending'] as const) { check(after[key].length === before[key].length, key + ' count'); after[key].forEach(([q, n], i) => check(q === before[key][i]![0] && n === before[key][i]![1], key + ' ownership')); }
  entriesEqual(after.issued, history, 'issued history');
  check(after.resources.length === before.resources.length && after.kinds.length === before.kinds.length, 'resource count');
  after.resources.forEach((value, i) => { check(value.owner === before.resources[i]!.owner, 'resource owner'); entriesEqual(value.entries, before.resources[i]!.entries, 'resource entries'); });
  after.kinds.forEach((value, i) => { check(value.owner === before.kinds[i]!.owner && value.entries.length === before.kinds[i]!.entries.length, 'resource kinds'); value.entries.forEach(([off, kind], j) => check(off === before.kinds[i]!.entries[j]![0] && kind === before.kinds[i]!.entries[j]![1], 'resource kind entries')); });
}
let sequence = 0;

const mutationKinds = ['append', 'atomic', 'factory', 'empty', 'detachContents', 'detach', 'remove', 'text', 'attrs', 'form', 'style', 'css', 'listener', 'binding', 'adoptRoots', 'descendant', 'ancestor', 'incoming', 'capability'] as const;

/** Also exercised in actual custom-element reactions below. */
function mutationFamilyCase(kind: typeof mutationKinds[number], native: boolean): void {
  const host = new LiveTree(node('div', node('_hson_elem', node('main', node('_hson_elem', node('p'))), node('nav'))));
  mount(host);
  const target = host.find.must.byTag('main'), independent = host.find.must.byTag('nav'), alias = new LiveTree(target);
  const existing = target.find.must.byTag('p'), inner = new LiveTree(node('aside')), other = new LiveTree(node('footer'));
  const source = new LiveTree(node('section', node('_hson_elem', node('b')))), cap = source.detachContents();
  const bindingSource = hsonLiveMap.fromLibraries({state: {data: {value: 1}, schema: Hson.schema`<type "data" content <value "number">>`}}).data.must('state').at(['value']);
  const factory = target.create, cachedAttrs = alias.attrs, cachedText = alias.text, cachedStyle = alias.style, cachedCss = alias.css;
  const runtime = runtime_for_tree(target), receiverNode = subject_for_tree(target), root = subject_for_tree(inner);
  const oldContent = receiverNode.$_content, oldDom = [...target.dom.el()!.childNodes];
  let attempts = 0, rejected = false, independentSucceeded = false, notices = 0;
  const tag = 'x-cut5-family-' + (++sequence);
  let outer: LiveTree;
  const attempt = () => {
    if (attempts++) return;
    check(alias.node.$_tag === 'main' && alias.text.get() === '' && alias.attrs.keys().length === 0 && alias.quid === target.quid, 'legitimate reads blocked');
    const before = state(target), observedGraph = JSON.stringify(alias.node), incomingGraph = JSON.stringify(inner.node), graphDuring = receiverNode.$_content, nativeDuring = [...target.dom.el()!.childNodes];
    const operations: Record<typeof kind, () => unknown> = {
      append: () => alias.append(inner), atomic: () => append_branches_atomic(alias, [inner]), factory: () => factory.tags(['aside', 'footer']),
      empty: () => alias.empty(), detachContents: () => alias.detachContents(), detach: () => alias.detach(), remove: () => alias.remove(),
      text: () => cachedText.set('nested'), attrs: () => cachedAttrs.set('title', 'nested'), form: () => alias.form.setValue('nested'),
      style: () => cachedStyle.setMany({color: 'red'}), css: () => cachedCss.setMany({color: 'red'}), listener: () => alias.listen.onClick(() => {}),
      binding: () => alias.bind.path(bindingSource, () => {}),
      adoptRoots: () => alias.adoptRoots(subject_for_tree(host)), descendant: () => existing.remove(), ancestor: () => host.empty(),
      incoming: () => outer.text.set('nested'), capability: () => cap.appendTo(alias),
    };
    try { operations[kind](); } catch { rejected = true; }
    check(rejected, 'conflicting ' + kind + ' succeeded');
    sameState(target, before);
    check(JSON.stringify(alias.node) === observedGraph && JSON.stringify(inner.node) === incomingGraph, 'rejected write changed node storage');
    check(receiverNode.$_content === graphDuring, 'rejected write changed graph'); entriesEqual([...target.dom.el()!.childNodes], nativeDuring, 'rejected write changed DOM');
    check(!parent_for_node(root) && !inner.dom.el() && !cap.isAttached, 'rejected input consumed');
    independent.append(other); independentSucceeded = true;
  };
  if (native) customElements.define(tag, class extends HTMLElement {
    static get observedAttributes() { return ['hson:quid']; }
    attributeChangedCallback(_name: string, _old: string | null, value: string | null) { if (value) attempt(); }
  });
  outer = new LiveTree(node('section', node('_hson_elem', node(native ? tag : 'span'), node('p'))));
  const notify = () => notices++; runtime.realizationListeners.add(notify);
  const dom = target.dom.el()!, replace = dom.replaceChildren, attribute = native ? Element.prototype.setAttribute : undefined;
  if (native) Element.prototype.setAttribute = function(name, value) { attribute!.call(this, name, value); if (name === 'hson:quid' && this.localName === 'p') throw new Error('family late native fault'); };
  else dom.replaceChildren = function(...nodes) { replace.apply(this, nodes); attempt(); throw new Error('family late reconciliation fault'); };
  try { reject(() => target.append(outer)); }
  finally { if (native) Element.prototype.setAttribute = attribute!; else dom.replaceChildren = replace; }
  try {
    check(attempts >= 1 && rejected && independentSucceeded, 'callback did not attempt both regions');
    check(receiverNode.$_content === oldContent, 'outer rollback changed original graph'); entriesEqual([...dom.childNodes], oldDom, 'outer rollback changed original DOM');
    check(parent_for_node(subject_for_tree(other)) && other.dom.el()?.parentNode === independent.dom.el(), 'independent commit erased');
    check(notices === 1, 'conflict notified or independent completion missing');
    target.append(inner); check(parent_for_node(root), 'retry failed after boundary');
    cap.appendTo(target); check(cap.isAttached && target.find.byTag('b'), 'capability retry failed');
    target.append(outer); check(outer.dom.el()?.parentNode === dom, 'outer retry failed');
  } finally { runtime.realizationListeners.delete(notify); host.remove(); outer.remove(); inner.remove(); other.remove(); source.remove(); }
}

function nativeFootprintCase(operation: 'factory' | 'append' | 'transfer', populated: boolean, alias: boolean): void {
  const target = new LiveTree(node('main', ...(populated ? [node('_hson_elem', node('p'))] : []))), dom = mount(target);
  const section = new LiveTree(node('section', node('_hson_elem', node('nav')))), sectionDom = mount(section);
  const receiver = alias ? new LiveTree(section) : section, factory = receiver.create;
  const incoming = new LiveTree(node('span')), element = mount(incoming); incoming.detach(); sectionDom.appendChild(element); sectionDom.remove();
  const input = new LiveTree(node('aside')), independent = new LiveTree(node('footer'));
  const source = new LiveTree(node('article', node('_hson_elem', node('b')))), cap = source.detachContents();
  const runtime = runtime_for_tree(target), before = state(target), graph = subject_for_tree(target).$_content;
  const oldDom = [...dom.childNodes], oldSection = [...sectionDom.childNodes];
  let notices = 0, rejected = false;
  const notify = () => notices++; runtime.realizationListeners.add(notify);
  const replace = dom.replaceChildren;
  dom.replaceChildren = function(...nodes) {
    replace.apply(this, nodes);
    try {
      if (operation === 'factory') factory.tags(['aside']);
      else if (operation === 'append') receiver.append(input);
      else cap.appendTo(receiver);
    } catch { rejected = true; }
    section.find.must.byTag('nav').append(independent);
    throw new Error('native footprint outer fault');
  };
  try { reject(() => target.append(incoming)); } finally { dom.replaceChildren = replace; }
  try {
    check(rejected && notices === 1, 'native container conflict completed/notified');
    sameState(target, before);
    check(subject_for_tree(target).$_content === graph, 'native footprint outer graph'); entriesEqual([...dom.childNodes], oldDom, 'native footprint receiver');
    entriesEqual([...sectionDom.childNodes], oldSection, 'native footprint source');
    check(element.parentNode === sectionDom && incoming.dom.el() === element && !parent_for_node(subject_for_tree(incoming)), 'native footprint incoming correspondence');
    check(independent.dom.el()?.parentNode === section.find.must.byTag('nav').dom.el() && parent_for_node(subject_for_tree(independent)), 'independent retained child commit erased');
    check(!parent_for_node(subject_for_tree(input)) && !input.dom.el() && !cap.isAttached, 'native footprint rejected inputs consumed');
    incoming.detach(); target.append(incoming);
    receiver.append(input); cap.appendTo(receiver); factory.tags(['aside']);
    check(cap.isAttached && input.dom.el()?.parentNode === sectionDom, 'native footprint retry/guard release');
  } finally { runtime.realizationListeners.delete(notify); target.remove(); section.remove(); incoming.remove(); input.remove(); independent.remove(); source.remove(); }
}

export function cut5_reentrant_mutation_cases(runCase: (name: string, run: () => void) => void): number {
  for (const kind of mutationKinds) runCase('overlap mutation family ' + kind, () => mutationFamilyCase(kind, false));
  for (const operation of ['factory', 'append', 'transfer'] as const) for (const populated of [false, true]) for (const alias of [false, true])
    runCase('native footprint ' + [operation, populated, alias].join('/'), () => nativeFootprintCase(operation, populated, alias));
  return mutationKinds.length + 12;
}

/** Browser-only: actual custom-element reactions and queued native evidence. */
export async function cut5_graft_reentrancy_browser_cases(runCase: (name: string, run: () => Promise<void>) => Promise<void>) {
  let cases = 0;
  const evidence: Array<{fault: string; generated: string[]; observed: string[]; issued: string[]; active: string[]; pending: string[]; unprotectedReactions: string[]}> = [];
  for (const count of [1, 3]) for (const fault of ['partial-claims', 'native-attribute', 'custom-reaction'] as const) {
    await runCase('graft ' + fault + ' ' + count, async () => {
      const runtime = default_livetree_runtime(), prefix = ++sequence;
      const tag = 'x-graft-history-' + prefix;
      const candidates = Array.from({length: count}, (_, i) => ('g' + prefix.toString(36).padStart(6, '0') + i.toString(36).padStart(2, '0')));
      const reactions: string[] = [], unprotected: string[] = [];
      if (fault === 'custom-reaction') customElements.define(tag, class extends HTMLElement {
        static get observedAttributes() { return ['hson:quid']; }
        attributeChangedCallback(_name: string, _old: string | null, q: string | null) {
          if (q) { reactions.push(q); if (!runtime.issuedQuids.has(q)) unprotected.push(q); }
        }
      });
      const root = document.createElement(fault === 'custom-reaction' ? tag : 'main');
      root.setAttribute('data-original', 'retained');
      root.appendChild(document.createTextNode('original'));
      for (let i = 1; i < count; i++) { const p = document.createElement('p'); p.textContent = 'child'; root.appendChild(p); }
      document.body.appendChild(root);
      const elements = [root, ...root.querySelectorAll('*')];
      const children = elements.map(el => [...el.childNodes]), attrs = elements.map(el => el.outerHTML);
      let clicks = 0; root.addEventListener('click', () => clicks++);
      const legitimate = new LiveTree(node('aside')), pendingOwner = new LiveTree(node('nav'));
      const pendingQuid = 'p' + prefix.toString(36).padStart(8, '0');
      runtime.pendingQuidClaims.set(pendingQuid, subject_for_tree(pendingOwner));
      const before = state(legitimate);
      let index = 0, publications = 0;
      const observed: MutationRecord[] = [];
      const observer = new MutationObserver(records => observed.push(...records)); observer.observe(root, {subtree: true, attributes: true, attributeOldValue: true});
      const set = runtime.quidToNode.set, attribute = Element.prototype.setAttribute;
      set_livetree_quid_candidate_source_for_tests(runtime, () => { const q = candidates[index++]; check(q, 'candidate count'); return q; });
      if (fault === 'partial-claims') runtime.quidToNode.set = function(q, n) { const result = set.call(this, q, n); if (candidates.includes(q) && ++publications === count) throw new Error('partial claim fault'); return result; };
      else Element.prototype.setAttribute = function(name, value) { attribute.call(this, name, value); if (name === 'hson:quid' && candidates.includes(value) && ++publications === count) throw new Error('native identity fault'); };
      try { reject(() => graft(root)); }
      finally { runtime.quidToNode.set = set; Element.prototype.setAttribute = attribute; set_livetree_quid_candidate_source_for_tests(runtime, undefined); }
      try {
        await new Promise(resolve => setTimeout(resolve, 0));
        check(index === count, 'plan generation count');
        elements.forEach((el, i) => { check(el.outerHTML === attrs[i], 'attributes restored'); entriesEqual([...el.childNodes], children[i]!, 'original Element/Text restored'); check(!get_node_for_el(el), 'mapping leaked'); });
        const exposed = observed.filter(r => r.attributeName === 'hson:quid' && r.oldValue !== null).map(r => r.oldValue!);
        if (fault === 'partial-claims') { check(exposed.length === 0, 'identity escaped before publication completed'); sameState(legitimate, before); }
        else {
          entriesEqual(exposed.slice().sort(), candidates.slice().sort(), 'MutationObserver exposed identity');
          sameState(legitimate, before, [...before.issued, ...candidates]);
          if (fault === 'custom-reaction') { entriesEqual(reactions, candidates.slice(0, 1), 'actual synchronous reaction'); check(unprotected.length === 0, 'custom reaction observed unprotected identity'); }
          for (const q of candidates) { set_livetree_quid_candidate_source_for_tests(runtime, () => q); try { reject(() => new LiveTree(node('aside'))); } finally { set_livetree_quid_candidate_source_for_tests(runtime, undefined); } check(!runtime.quidToNode.has(q) && runtime.issuedQuids.has(q), 'observed identity reassigned'); }
        }
        evidence.push({fault, generated: candidates, observed: exposed, issued: [...runtime.issuedQuids].filter(q => candidates.includes(q)), active: [...runtime.quidToNode.keys()].filter(q => candidates.includes(q)), pending: [...runtime.pendingQuidClaims.keys()].filter(q => candidates.includes(q)), unprotectedReactions: unprotected});
        root.click(); check(clicks === 1, 'native listener lost');
        const adopted = graft(root); check(adopted.dom.el() === root, 'successful graft recreated Element');
        elements.forEach((el, i) => entriesEqual([...el.childNodes], children[i]!, 'successful graft replaced canonical Text/Element'));
        const repeated = graft(root); check(subject_for_tree(repeated) === subject_for_tree(adopted) && repeated.dom.el() === root, 'managed graft changed identity');
        check(legitimate.quid === before.active.find(([, n]) => n === subject_for_tree(legitimate))?.[0], 'preexisting identity lost');
        const forged = document.createElement('main'); forged.setAttribute('hson:quid', candidates[0]!); reject(() => graft(forged)); check(!get_node_for_el(forged), 'unauthorized import');
        adopted.remove();
      } finally { observer.disconnect(); runtime.pendingQuidClaims.delete(pendingQuid); legitimate.remove(); pendingOwner.remove(); root.remove(); }
    }); cases++;
  }
  for (const phase of ['attribute', 'constructor', 'connected', 'disconnected'] as const) for (const populated of [false, true]) for (const alias of [false, true]) {
    await runCase('native nested append ' + phase + '/' + populated + '/' + alias, async () => {
      const target = new LiveTree(node('main', ...(populated ? [node('_hson_elem', node('p'))] : [])));
      const receiver = alias ? new LiveTree(target) : target;
      const dom = mount(target), runtime = runtime_for_tree(target), inner = new LiveTree(node('aside'));
      const innerRoot = subject_for_tree(inner), before = state(target), graph = subject_for_tree(target).$_content, domBefore = [...dom.childNodes];
      const existing = populated ? target.find.must.byTag('p') : target;
      let releases = 0, clicks = 0, notices = 0, callback = 0, innerError: unknown, innerSucceeded = false;
      own_disposable_for_subject(subject_for_tree(existing), () => releases++, 'other', runtime); existing.listen.onClick(() => clicks++);
      const tag = 'x-nested-cut5-' + (++sequence);
      const attempt = () => {
          if (callback++) return;
          check(receiver.node.$_tag === 'main' && receiver.dom.el() === dom, 'reads blocked');
          try { receiver.append(inner); innerSucceeded = true; } catch (cause) { innerError = cause; }
      };
      customElements.define(tag, class extends HTMLElement {
        constructor() { super(); if (phase === 'constructor') attempt(); }
        static get observedAttributes() { return ['hson:quid']; }
        attributeChangedCallback(_name: string, _old: string | null, q: string | null) { if (q && phase === 'attribute') attempt(); }
        connectedCallback() { if (phase === 'connected') attempt(); }
        disconnectedCallback() { if (phase === 'disconnected') attempt(); }
      });
      const outer = new LiveTree(node('section', node('_hson_elem', node(tag), node('p'))));
      const outerState = state(target), set = Element.prototype.setAttribute;
      const notify = () => notices++; runtime.realizationListeners.add(notify);
      Element.prototype.setAttribute = function(name, value) { set.call(this, name, value); if (name === 'hson:quid' && this.localName === 'p') throw new Error('later outer native fault'); };
      try { reject(() => target.append(outer)); } finally { Element.prototype.setAttribute = set; }
      try {
        check(callback >= 1 && innerError && !innerSucceeded, 'nested append reported success');
        check(!parent_for_node(innerRoot) && runtime_for_node(innerRoot) === runtime && !inner.dom.el(), 'nested input changed ownership or DOM');
        check(subject_for_tree(target).$_content === graph, 'outer graph not restored'); entriesEqual([...dom.childNodes], domBefore, 'outer native placement');
        check(notices === 0 && releases === 0, 'premature notification/resource teardown');
        const after = state(target);
        sameState(target, outerState, after.issued);
        check(after.issued.length === outerState.issued.length + 2 && outerState.issued.every(q => runtime.issuedQuids.has(q)), 'outer history was forgotten');
        check(after.pending.length === before.pending.length, 'pending claims leaked');
        get_dom_for_node(subject_for_tree(existing))?.dispatchEvent(new Event('click')); check(clicks === 1, 'existing listener lost');
        target.append(inner); check(Number(notices) === 1 && parent_for_node(innerRoot), 'guard not released after failure');
        target.append(outer); check(Number(notices) === 2, 'outer retry failed');
        const next = new LiveTree(node('footer')); let observed = false;
        const reenter = () => { if (observed) return; observed = true; target.append(next); };
        runtime.realizationListeners.add(reenter);
        target.append(new LiveTree(node('nav'))); runtime.realizationListeners.delete(reenter);
        check(parent_for_node(subject_for_tree(next)), 'post-commit observer mutation blocked');
      } finally { runtime.realizationListeners.delete(notify); target.remove(); inner.remove(); outer.remove(); }
      check(Number(releases) === 1, 'resource terminal release count');
    }); cases++;
  }
  // A native parent can be outside the graph while still being restored by
  // capture_dom_placement. Its child list must be reserved before callbacks.
  for (const sourcePopulated of [false, true]) for (const populated of [false, true]) for (const mode of ['unmanaged', 'managed', 'alias'] as const)
    for (const operation of (mode === 'unmanaged' ? ['graft'] : ['graft', 'factory', 'append', 'transfer']) as Array<'graft' | 'factory' | 'append' | 'transfer'>)
      for (const callbackFault of [false, true]) {
    await runCase('native rollback container ' + [sourcePopulated, populated, mode, operation, callbackFault].join('/'), async () => {
      const target = new LiveTree(node('main', ...(populated ? [node('_hson_elem', node('p'))] : [])));
      const dom = mount(target), runtime = runtime_for_tree(target);
      const independent = new LiveTree(node('nav')); mount(independent);
      const independentInput = new LiveTree(node('footer')), retainedInput = new LiveTree(node('strong')), input = new LiveTree(node('aside'));
      const source = new LiveTree(node('article', node('_hson_elem', node('b')))), cap = source.detachContents();
      const section = document.createElement('section'), retained = document.createElement('p'), text = document.createTextNode('retained');
      retained.appendChild(text);
      const nativeSibling = document.createElement('nav');
      if (sourcePopulated) section.append(retained, nativeSibling);
      document.body.appendChild(section);
      let managed: LiveTree | undefined = mode === 'unmanaged' ? undefined : graft(section);
      const receiver = mode === 'alias' ? new LiveTree(managed!) : managed;
      const factory = receiver?.create;
      let armed = false, callbacks = 0, rejected = false, nestedSucceeded = false, nested: LiveTree | undefined, nestedCreated: LiveTree | undefined;
      let notices = 0, releases = 0, clicks = 0, callbackErrors = 0;
      const tag = 'x-native-footprint-' + (++sequence);
      const callbackMessage = 'expected footprint callback failure ' + tag;
      const onerror = (event: ErrorEvent) => { if (event.message.includes(callbackMessage)) { callbackErrors++; event.preventDefault(); } };
      window.addEventListener('error', onerror);
      customElements.define(tag, class extends HTMLElement {
        connectedCallback() {
          if (!armed || callbacks++) return;
          document.body.appendChild(section);
          try {
            if (operation === 'graft') { nested = graft(section); nestedCreated = nested.create.tags(['aside']).first(); }
            else if (operation === 'factory') nestedCreated = factory!.tags(['aside']).first();
            else if (operation === 'append') receiver!.append(input);
            else cap.appendTo(receiver!);
            nestedSucceeded = true;
          } catch { rejected = true; }
          independent.append(independentInput);
          // Restoring section's original child references does not overwrite
          // an independent existing child's own children.
          if (sourcePopulated && managed) managed.find.must.byTag('nav').append(retainedInput);
          if (callbackFault) throw new Error(callbackMessage);
        }
      });
      const element = document.createElement(tag), nativeText = document.createTextNode('custom text');
      element.appendChild(nativeText); section.appendChild(element);
      const outer = graft(element), outerNode = subject_for_tree(outer), quid = outer.quid;
      own_disposable_for_subject(outerNode, () => releases++, 'other', runtime); outer.listen.onClick(() => clicks++);
      section.remove();
      const before = state(target), oldGraph = subject_for_tree(target).$_content;
      const oldDom = [...dom.childNodes], oldSection = [...section.childNodes];
      const sectionGraph = managed && subject_for_tree(managed).$_content;
      const notify = () => notices++; runtime.realizationListeners.add(notify);
      const replace = dom.replaceChildren;
      dom.replaceChildren = function(...nodes) { replace.apply(this, nodes); throw new Error('outer footprint reconciliation fault'); };
      armed = true;
      try { reject(() => target.append(outer)); } finally { dom.replaceChildren = replace; armed = false; }
      try {
        const escaped = nestedCreated ?? (operation === 'append' ? input : undefined);
        const escapedNode = escaped && subject_for_tree(escaped);
        check(callbacks >= 1 && rejected && !nestedSucceeded, 'rollback-owned native container admitted a completed nested operation' +
          (escaped ? ` [parent=${Boolean(escapedNode && parent_for_node(escapedNode))},claim=${runtime.quidToNode.get(escaped.quid!) === escapedNode},nativeParent=${Boolean(escaped.dom.el()?.parentNode)}]` : ''));

        check(Number(notices) === (sourcePopulated && managed ? 2 : 1) && releases === 0, 'conflicting operation notified or released resources');
        check(callbackErrors === (callbackFault ? 1 : 0), 'actual callback failure coverage');
        check(subject_for_tree(target).$_content === oldGraph, 'outer graph changed'); entriesEqual([...dom.childNodes], oldDom, 'outer native receiver');
        entriesEqual([...section.childNodes], oldSection, 'native source container restored');
        check(retained.firstChild === text && outer.dom.el() === element && element.parentNode === section && element.firstChild === nativeText, 'native Element/Text identity');
        check(!parent_for_node(outerNode) && outer.quid === quid && element.getAttribute('hson:quid') === quid && runtime.quidToNode.get(quid!) === outerNode, 'outer parent/identity restoration');
        check(!parent_for_node(subject_for_tree(input)) && !input.dom.el() && !cap.isAttached, 'nested inputs consumed');
        if (managed) check(get_node_for_el(section) === subject_for_tree(managed) && subject_for_tree(managed).$_content === sectionGraph, 'managed container correspondence changed');
        else check(!get_node_for_el(section) && !get_node_for_el(retained), 'rejected graft acquired native ownership');
        if (sourcePopulated && managed) check(retainedInput.dom.el()?.parentNode === nativeSibling && parent_for_node(subject_for_tree(retainedInput)), 'independent native child commit erased');
        check(independentInput.dom.el()?.parentNode === independent.dom.el() && parent_for_node(subject_for_tree(independentInput)), 'independent sibling commit erased');
        sameState(target, before); // independent input already owned its QUID
        element.click(); check(clicks === 1, 'native listener lost');
        outer.detach();
        target.append(outer); check(element.parentNode === dom && parent_for_node(outerNode), 'outer retry/guard release');
        managed ??= graft(section);
        const retry = managed.create.tags(['aside']); check(retry.length === 1 && managed.find.must.byTag('aside').dom.el()?.parentNode === section, 'graft/factory retry failed');
        managed.append(input); cap.appendTo(managed); check(cap.isAttached && input.dom.el()?.parentNode === section, 'append/transfer retry failed');
        let observed = false;
        const observer = () => { if (observed) return; observed = true; managed!.create.tags(['footer']); };
        runtime.realizationListeners.add(observer);
        try { target.create.tags(['div']); } finally { runtime.realizationListeners.delete(observer); }
        check(observed && managed.find.byTag('footer')?.dom.el()?.parentNode === section, 'post-commit independent observer mutation');
      } finally {
        window.removeEventListener('error', onerror); runtime.realizationListeners.delete(notify);
        target.remove(); independent.remove(); managed?.remove(); nested && nested !== managed && nested.remove();
        outer.remove(); input.remove(); retainedInput.remove(); source.remove(); section.remove();
      }
      check(Number(releases) === 1, 'resource final release');
    }); cases++;
  }
  await runCase('native rollback placement rejects new wrapping graft owner', async () => {
    const target = new LiveTree(node('main')), dom = mount(target), runtime = runtime_for_tree(target);
    const section = document.createElement('section'), retained = document.createElement('p'), text = document.createTextNode('retained');
    retained.appendChild(text); section.appendChild(retained); document.body.appendChild(section);
    const wrapper = document.createElement('article'); document.body.appendChild(wrapper);
    let armed = false, attempted = false, rejected = false, nested: LiveTree | undefined, notices = 0;
    const tag = 'x-native-placement-' + (++sequence);
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() {
        if (!armed || attempted) return; attempted = true;
        wrapper.appendChild(retained);
        try { nested = graft(wrapper); nested.create.tags(['aside']); } catch { rejected = true; }
      }
    });
    const element = document.createElement(tag); section.appendChild(element);
    const outer = graft(element); section.remove(); const before = state(target), graph = subject_for_tree(target).$_content;
    const replace = dom.replaceChildren, notify = () => notices++; runtime.realizationListeners.add(notify);
    dom.replaceChildren = function(...nodes) { replace.apply(this, nodes); throw new Error('native original-child placement fault'); };
    armed = true;
    try { reject(() => target.append(outer)); } finally { dom.replaceChildren = replace; armed = false; }
    try {
      check(attempted && rejected && !nested && notices === 0, 'new wrapping graft owner published rollback-owned child placement');
      sameState(target, before);
      check(subject_for_tree(target).$_content === graph && !parent_for_node(subject_for_tree(outer)), 'placement graph rollback');
      entriesEqual([...section.childNodes], [retained, element], 'original child placements');
      check(retained.firstChild === text && !wrapper.childNodes.length, 'native placement/Text rollback');
      check(!get_node_for_el(wrapper) && !get_node_for_el(retained), 'wrapping graft ownership escaped');
      target.append(outer); check(element.parentNode === dom, 'placement retry/guard release');
      const retry = graft(wrapper); retry.create.tags(['aside']); check(retry.find.must.byTag('aside').dom.el()?.parentNode === wrapper, 'wrapping graft retry'); retry.remove();
    } finally { runtime.realizationListeners.delete(notify); target.remove(); outer.remove(); nested?.remove(); section.remove(); wrapper.remove(); }
  }); cases++;
  for (const kind of mutationKinds) { await runCase('custom reaction mutation family ' + kind, async () => mutationFamilyCase(kind, true)); cases++; }
  return {cases, evidence};
}
