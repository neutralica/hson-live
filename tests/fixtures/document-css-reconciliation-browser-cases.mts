import { hsonLiveMap } from '../../src/api/livemap/index.ts';
import { Hson } from '../../src/index.ts';
import { add_interaction, enable_interactions, set_interaction_activation_initialization_materialization_hook_for_tests } from '../../src/api/interactions/interactions.ts';
import type { LiveMap } from '../../src/types/livemap.types.ts';
import type { DocumentCssRecord } from '../../src/types/document-css.types.ts';
import { continue_document } from '../../src/api/continuation/continue-document.ts';
import { adopt_exact_existing_document } from '../../src/api/continuation/continuation.adopt.ts';
import { capture_continuation_document_root } from '../../src/api/continuation/continuation.common.ts';
import { reflect_existing_document_in_runtime } from '../../src/api/mirror/mirror.document.ts';
import { runtime_for_tree, subject_for_tree } from '../../src/api/livetree/runtime/livetree-runtime.ts';
import { get_node_for_el } from '../../src/api/livetree/utils/node-map-helpers.ts';
import { bind_document_css_tree, runtime_has_document_css_binding } from '../../src/api/livetree/managers/bound-document-css.ts';
import { lookup_document_quad_internal } from '../../src/api/livemap/livemap.document.quad.ts';
import { document_css_state_internal, reconcile_client_projection_snapshot_internal } from '../../src/api/livemap/livemap.libraries.ts';
import { internal_livemap_aggregate_authority } from '../../src/api/livemap/livemap.internal.ts';
import { compose_client_projection_internal } from '../../src/api/echo/echo.projection.ts';
import { authority_projection_as_client_composition_internal } from '../../src/api/locus/locus.authority-projection-snapshot.ts';
import { encode_portable_document_stylesheet, render_portable_document_stylesheet_carriers } from '../../src/internal/css/portable-document-stylesheet.ts';
import { validate_document_path } from '../../src/api/livemap/livemap.document.path.ts';
import { enumerate_livemap_issued_quids } from '../../src/api/livemap/livemap.identity-epoch.ts';

const markup = '<html <head/> <body <button class="target"/>/>/>';
const record = (color: string): DocumentCssRecord => ({
  rules: [
    { ruleKey: 'managed', selector: '.target', scopes: [], declarations: [['color', color]] },
    { ruleKey: 'tail', selector: '.target', scopes: [], declarations: [['opacity', '.7']] },
  ], properties: [], keyframes: [], order: [
    { kind: 'text', text: `/* ${color} */ .target{color:red} /* unclosed` },
    { kind: 'rule', ruleKey: 'managed', scopes: [] },
    { kind: 'text', text: `.target{padding-left:11px} /* ${color} */` },
    { kind: 'rule', ruleKey: 'tail', scopes: [] },
  ],
});
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
function rejects(run: () => unknown): boolean {
  try { run(); return false; } catch { return true; }
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

/** Faults attach to one exact native node, never a realm-wide DOM prototype. */
function fault_text(node: Node, after: boolean, persistent = false, onWrite?: () => void) {
  let prototype: object | null = node, descriptor: PropertyDescriptor | undefined;
  while (prototype && !descriptor) {
    descriptor = Object.getOwnPropertyDescriptor(prototype, 'nodeValue');
    prototype = Object.getPrototypeOf(prototype);
  }
  assert(descriptor?.get && descriptor.set, 'Native text descriptor is missing.');
  const native = descriptor, own = Object.getOwnPropertyDescriptor(node, 'nodeValue');
  let calls = 0;
  Object.defineProperty(node, 'nodeValue', { configurable: true,
    get() { return native.get!.call(this); },
    set(value) {
      calls++;
      const fail = persistent || calls === 1;
      if (fail && !after) throw Error('CSS text fault before mutation');
      native.set!.call(this, value);
      onWrite?.();
      if (fail && after) throw Error('CSS text fault after mutation');
    },
  });
  return { calls: () => calls, restore() {
    if (own) Object.defineProperty(node, 'nodeValue', own);
    else Reflect.deleteProperty(node, 'nodeValue');
  } };
}
function fault_remove(style: HTMLStyleElement, after: boolean, persistent = false) {
  const native = style.remove;
  let calls = 0;
  style.remove = () => {
    calls++;
    const fail = persistent || calls === 1;
    if (fail && !after) throw Error('CSS removal fault before mutation');
    native.call(style);
    if (fail && after) throw Error('CSS removal fault after mutation');
  };
  return { calls: () => calls, restore() { Reflect.deleteProperty(style, 'remove'); } };
}
function attach(map: LiveMap, hosted = false) {
  const page = map.doc.must('page');
  const frame = document.createElement('iframe'); document.body.append(frame);
  const doc = frame.contentDocument!, win = frame.contentWindow!;
  doc.open(); doc.write(page.render()); doc.close();
  const carriers = () => Array.from(doc.querySelectorAll<HTMLStyleElement>('style[data-hson-managed-document-css]'));
  const expected = () => render_portable_document_stylesheet_carriers(document_css_state_internal(page));
  let dispose: () => void, tree;
  if (hosted) {
    const adoption = adopt_exact_existing_document(capture_continuation_document_root(page), doc.documentElement, expected());
    const mirror = reflect_existing_document_in_runtime(page, adoption.tree, runtime_for_tree(adoption.tree));
    const stop = bind_document_css_tree(mirror.tree, page, adoption.managedStyles, true, () => mirror.tree);
    adoption.commit(() => mirror.tree);
    tree = mirror.tree;
    dispose = () => { stop(); mirror.dispose(); };
  } else {
    const continuation = continue_document({ map, document: page, root: doc.documentElement });
    tree = continuation.tree;
    dispose = () => continuation.dispose();
  }
  const global = tree.css.global;
  const foreign = doc.createElement('style'); foreign.textContent = '.foreign{color:purple}'; doc.head.append(foreign);
  const settled = () => {
    assert(JSON.stringify(carriers().map(style => style.textContent)) === JSON.stringify(expected()), 'Native carriers differ from accepted canonical CSS.');
    assert(carriers().every((style, index, all) => index + 1 === all.length || style.nextSibling === all[index + 1]), 'Carrier cascade order is wrong.');
    assert(carriers().every(style => style.sheet?.ownerNode === style), 'An owned native stylesheet is not active.');
    assert(carriers().every(style => style.parentNode === doc.head), 'An owned carrier has the wrong mount.');
    assert(foreign.parentNode === doc.head && foreign.textContent === '.foreign{color:purple}', 'Another stylesheet owner was changed.');
  };
  return { map, page, doc, win, frame, carriers, expected, settled, global, tree, foreign,
    close() { dispose(); frame.remove(); }, dispose };
}
function local() {
  const map = hsonLiveMap.fromLibraries({ page: { document: markup } });
  replace(map, record('green'));
  return attach(map);
}
function replace(map: LiveMap, stylesheet: DocumentCssRecord): void {
  map.batch(writer => { writer.doc.must('page').css({ domain: 'css', kind: 'replace', stylesheet }); });
}

export async function document_css_reconciliation_browser_cases(): Promise<{ name: string; pass: boolean }[]> {
  const checks: { name: string; pass: boolean }[] = [];
  const check = (name: string, run: () => void) => { run(); checks.push({ name, pass: true }); };
  const priorReporter = Object.getOwnPropertyDescriptor(globalThis, 'reportError');
  const reports: unknown[] = [];
  Object.defineProperty(globalThis, 'reportError', { configurable: true, value: (error: unknown) => reports.push(error) });
  try {
    const reuseName = 'styled disposal, failed interaction reuse, rollback and successful reuse retain exact ownership';
    await (async () => {
      const map: LiveMap = hsonLiveMap.fromLibraries({ page: { document:
        '<html <head <style ".foreign{color:purple}"/>/> <body <button @:target class="target"/>/>/>' } });
      const page = map.doc.must('page');
      enable_interactions(map);
      replace(map, record('green'));
      add_interaction(map, { id: 'reuse-click', kind: 'browser', key: 'click', args: Hson.data.from(null),
        subject: { library: 'page', path: lookup_document_quad_internal(page, 'target')!.path },
        listener: { event: 'click', target: 'element', capture: false, once: false, passive: false,
          missingTarget: 'throw', preventDefault: false, stopPropagation: false, stopImmediatePropagation: false } });
      const frame = document.createElement('iframe'); document.body.append(frame);
      const doc = frame.contentDocument!, win = frame.contentWindow!;
      doc.open(); doc.write(page.render()); doc.close();
      const root = doc.documentElement, button = doc.querySelector<HTMLButtonElement>('button')!;
      const carriers = () => Array.from(root.querySelectorAll<HTMLStyleElement>('style[data-hson-managed-document-css]'));
      const expected = render_portable_document_stylesheet_carriers(document_css_state_internal(page));
      let calls = 0;
      const interactions = { local: { click: () => { calls++; } } };
      let binding = continue_document({ map, document: page, root, interactions });
      const tree = binding.tree, runtime = runtime_for_tree(tree), old = carriers();
      const foreign = doc.head.querySelector('style:not([data-hson-managed-document-css])')!;
      const authority = internal_livemap_aggregate_authority(map), ledger = authority.identityEpoch().issued();
      const canonical = JSON.stringify(map.capture()), issued = [...runtime.issuedQuids];
      const claims = new Map(runtime.quidToNode);
      const resources = () => [...runtime.ownerDisposables.values()].reduce((count, set) => count + set.size, 0);
      try {
        assert(old.length === 4 && old.every((style, index) => style.textContent === expected[index]), 'Mixed initial carriers changed.');
        assert(win.getComputedStyle(button).color === 'rgb(0, 128, 0)', 'Initial structured CSS did not follow opaque text.');
        button.click(); assert(calls === 1, 'Initial interaction did not dispatch once.');
        const oldGlobal = tree.css.global;
        binding.dispose();
        const disposedResources = resources(), disposedMarkup = root.outerHTML;
        assert(carriers().length === 0 && old.every(style => style.parentNode === null && style.sheet === null), 'Disposal kept active CSS resources.');
        assert(!runtime_has_document_css_binding(runtime) && rejects(() => oldGlobal.clearAll()), 'Disposed owner retained CSS authority.');
        assert(rejects(() => adopt_exact_existing_document(capture_continuation_document_root(page), root, expected)), 'Exact adoption accepted missing required carriers.');
        const forged = doc.createElement('html'); forged.innerHTML = root.innerHTML;
        forged.setAttribute('hson:quid', lookup_document_quad_internal(page, 'target')!.quid);
        assert(rejects(() => continue_document({ map, document: page, root: forged, interactions })), 'DOM identity attributes acquired retained-root authority.');
        const head = doc.head, insert = head.insertBefore;
        for (const after of [false, true]) {
          head.insertBefore = function<T extends Node>(node: T, following: Node | null): T {
            if (node.isSameNode(old[2]!) && !after) throw Error('Reuse placement fault');
            insert.call(this, node, following);
            if (node.isSameNode(old[2]!) && after) throw Error('Reuse placement fault');
            return node;
          };
          let phase: unknown;
          try { continue_document({ map, document: page, root, interactions }); }
          catch (error) { phase = error instanceof Error && 'phase' in error ? error.phase : undefined; }
          finally { Reflect.deleteProperty(head, 'insertBefore'); }
          assert(phase === 'adopt' && root.outerHTML === disposedMarkup
            && old.every(style => style.parentNode === null && style.sheet === null)
            && get_node_for_el(root) === subject_for_tree(tree) && resources() === disposedResources,
          'Partial carrier restoration escaped rollback or lost retained ownership.');
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          let phase: unknown, activated = false;
          set_interaction_activation_initialization_materialization_hook_for_tests(() => {
            activated = true;
            assert(carriers().every((style, index) => style === old[index] && style.textContent === expected[index]), 'Reuse did not restore exact carriers before interaction setup.');
            throw Error('styled reuse activation fault');
          });
          try { continue_document({ map, document: page, root, interactions }); }
          catch (error) { phase = error instanceof Error && 'phase' in error ? error.phase : undefined; }
          finally { set_interaction_activation_initialization_materialization_hook_for_tests(undefined); }
          assert(activated && phase === 'interactions', `Failed reuse rejected during ${String(phase)} instead of interaction setup.`);
          button.click();
          assert(calls === 1 && resources() === disposedResources && !runtime_has_document_css_binding(runtime), 'Failed reuse leaked dispatch or CSS/listener ownership.');
          assert(root.outerHTML === disposedMarkup && old.every(style => style.parentNode === null && style.sheet === null), 'Failed reuse did not restore disposed native state.');
          assert(get_node_for_el(root) === subject_for_tree(tree) && !tree.isDisposed, 'Rollback lost the legitimate retained root.');
          assert(runtime.quidToNode.size === claims.size && [...claims].every(([quid, node]) => runtime.quidToNode.get(quid) === node), 'Rollback changed issued subject ownership.');
        }
        const cleanupFault = fault_remove(old[0]!, false);
        let activated = false, cleanupFailure: unknown;
        set_interaction_activation_initialization_materialization_hook_for_tests(() => {
          activated = true; throw Error('styled reuse cleanup fault');
        });
        try { continue_document({ map, document: page, root, interactions }); }
        catch (error) { cleanupFailure = error; }
        finally { set_interaction_activation_initialization_materialization_hook_for_tests(undefined); }
        try {
          assert(activated && cleanupFailure instanceof AggregateError && !runtime_has_document_css_binding(runtime), 'Rollback cleanup failure was hidden or revived authoring.');
          await tick();
          assert(root.outerHTML === disposedMarkup && old.every(style => style.parentNode === null && style.sheet === null), 'Bounded rollback cleanup retry left active CSS.');
        } finally { cleanupFault.restore(); }
        binding = continue_document({ map, document: page, root, interactions });
        assert(binding.tree === tree && carriers().length === old.length
          && carriers().every((style, index) => style === old[index] && style.textContent === expected[index]), 'Successful reuse duplicated owners or replaced exact carriers.');
        assert(runtime_has_document_css_binding(runtime) && rejects(() => oldGlobal.clearAll()), 'Reuse revived a retired CSS capability.');
        assert(rejects(() => continue_document({ map, document: page, root, interactions })), 'Reuse allowed a second concurrent owner.');
        assert(win.getComputedStyle(button).color === 'rgb(0, 128, 0)' && win.getComputedStyle(button).paddingLeft === '11px', 'Reused raw and structured cascade changed.');
        button.click(); assert(Number(calls) === 2, 'Reused interaction did not dispatch exactly once.');
        assert(JSON.stringify(map.capture()) === canonical && authority.identityEpoch().issued() === ledger
          && JSON.stringify([...runtime.issuedQuids]) === JSON.stringify(issued), 'Reuse published state or issued identity.');
        binding.dispose(); binding.dispose(); button.click();
        assert(Number(calls) === 2 && resources() === disposedResources && carriers().length === 0
          && old.every(style => style.parentNode === null && style.sheet === null), 'Final cleanup leaked dispatch or CSS resources.');
        assert(foreign.parentNode === doc.head && foreign.textContent === '.foreign{color:purple}', 'Cleanup changed another stylesheet owner.');
        let retired = false;
        head.insertBefore = function<T extends Node>(node: T, following: Node | null): T {
          insert.call(this, node, following);
          if (!retired) {
            retired = true;
            root.remove(); // The fixture owner retires its browser-owned document first.
            tree.remove();
          }
          return node;
        };
        try { assert(rejects(() => continue_document({ map, document: page, root, interactions })), 'Retirement during reuse did not fence carrier preparation.'); }
        finally { Reflect.deleteProperty(head, 'insertBefore'); }
        assert(tree.isDisposed && get_node_for_el(root) === undefined
          && rejects(() => continue_document({ map, document: page, root, interactions })) && carriers().length === 0
          && old.every(style => style.parentNode === null && style.sheet === null),
        'Retired root restored CSS or resurrected identity.');
      } finally {
        set_interaction_activation_initialization_materialization_hook_for_tests(undefined);
        binding.dispose(); frame.remove();
      }
    })();
    checks.push({ name: reuseName, pass: true });
    for (const after of [false, true]) for (const index of [0, 1, 2]) {
      const f = local(), old = f.carriers(), before = f.map.rev, count = reports.length;
      const fault = fault_text(old[index]!.firstChild!, after);
      try {
        replace(f.map, record('blue'));
        check(`accepted mixed replacement reports ${after ? 'after' : 'before'} write fault at carrier ${index + 1}`, () => {
          assert(f.map.rev === before + 1 && reports.length === count + 1, 'Accepted commit/error visibility changed.');
          assert(JSON.stringify(document_css_state_internal(f.page).order) === JSON.stringify(record('blue').order), 'Canonical replacement was undone.');
        });
        await tick();
        check('automatic retry reaches accepted CSS without another semantic change and reuses carriers', () => {
          f.settled(); assert(f.map.rev === before + 1, 'Recovery made a compensating commit.');
          assert(f.carriers().every((style, i) => style === old[i]), 'Successful carrier reuse was lost.');
          assert(f.win.getComputedStyle(f.doc.querySelector('.target')!).color === 'rgb(0, 0, 255)', 'Recovered cascade is wrong.');
        });
        replace(f.map, record('blue')); f.settled();
        assert(f.map.rev === before + 1, 'Already accepted replacement was not a semantic no-op.');
      } finally { fault.restore(); f.close(); }
    }
    {
      const f = local(), old = f.carriers(), before = f.map.rev;
      const fault = fault_text(old[1]!.firstChild!, false, true);
      try {
        replace(f.map, record('blue')); await tick();
        const calls = fault.calls(), count = reports.length;
        await tick();
        check('persistent write fault stays visible, pending and bounded', () => {
          assert(calls === 2 && fault.calls() === calls, 'Automatic retries are unbounded.');
          assert(count >= 2 && f.map.rev === before + 1, 'Persistent failure was hidden or changed authority.');
          assert(rejects(() => f.page.css.snapshot()), 'Pending native failure was presented as a synchronized CSS read.');
        });
        await tick(); fault.restore();
        check('identical governed batch retries pending realization without a semantic publication', () => {
          replace(f.map, record('blue'));
          f.settled(); assert(f.map.rev === before + 1, 'No-op batch recovery advanced authority.');
        });
        f.page.css.stylesheet('/* accepted raw */');
        f.settled();
        const raw = f.carriers()[0]!, rawFault = fault_text(raw.firstChild!, false, true);
        f.page.css.stylesheet('/* final raw */'); await tick();
        const acceptedRev = f.map.rev;
        rawFault.restore(); f.page.css.stylesheet('/* final raw */');
        check('identical direct stylesheet command retries pending realization without a semantic publication', () => {
          f.settled(); assert(f.map.rev === acceptedRev, 'Direct no-op recovery advanced authority.');
        });
      } finally { fault.restore(); f.close(); }
    }
    for (const after of [false, true]) {
      const f = local(), old = f.carriers(), before = f.map.rev, count = reports.length;
      const fault = fault_remove(old[0]!, after);
      try {
        f.page.css.clearAll();
        check(`clear attempts every owned carrier despite ${after ? 'after' : 'before'} first-removal failure`, () => {
          assert(f.map.rev === before + 1 && document_css_state_internal(f.page).order.length === 0, 'Clear was not accepted.');
          assert(reports.length === count + 1, 'Clear failure was hidden.');
          assert(old.slice(1).every(style => style.parentNode === null), 'Later carriers were not attempted.');
        });
        await tick(); f.settled();
        assert(old.every(style => style.sheet === null), 'Cleared CSSOM sheets remain active.');
        f.page.css.clearAll(); assert(f.map.rev === before + 1, 'Repeated clear advanced authority.');
      } finally { fault.restore(); f.close(); }
    }
    {
      const f = local(), old = f.carriers(), fault = fault_remove(old[0]!, false, true);
      try {
        f.page.css.clearAll(); await tick(); const rev = f.map.rev;
        assert(old[0]!.parentNode === f.doc.head, 'Persistent-removal precondition is missing.');
        fault.restore(); f.page.css.clearAll();
        check('persistent clear recovers through an unchanged direct command', () => { f.settled(); assert(f.map.rev === rev, 'Recovery advanced revision.'); });
      } finally { fault.restore(); f.close(); }
    }
    for (const after of [false, true]) {
      const f = local(), old = f.carriers(), target = old[1]!, native = f.doc.head.insertBefore;
      target.remove(); let faulted = false;
      f.doc.head.insertBefore = function<T extends Node>(node: T, following: Node | null): T {
        const fail = node.isSameNode(target) && !faulted;
        if (fail) { faulted = true; if (!after) throw Error('Carrier insertion fault before mutation'); }
        native.call(this, node, following);
        if (fail && after) throw Error('Carrier insertion fault after mutation');
        return node;
      };
      try {
        replace(f.map, record('blue')); await tick();
        check(`carrier reinsertion recovers ${after ? 'after' : 'before'} native failure with exact ownership/order`, () => {
          assert(faulted && f.carriers().every((style, i) => style === old[i]), 'Carrier tracking lost a partly placed node.'); f.settled();
        });
      } finally { Reflect.deleteProperty(f.doc.head, 'insertBefore'); f.close(); }
    }
    {
      const f = local(), first = f.carriers()[0]!;
      try {
        f.page.css.stylesheet('/* one */'); f.settled();
        replace(f.map, record('blue')); f.settled();
        check('normal shrink, creation and clearing preserve the reusable carrier and unrelated styles', () => {
          assert(f.carriers().length === 4 && f.carriers()[0] === first, 'Normal replacement lost carrier reuse.');
          f.page.css.clearAll(); f.settled();
        });
      } finally { f.close(); }
    }
    {
      const f = local(), old = f.carriers(), fault = fault_text(old[1]!.firstChild!, false, true);
      try {
        replace(f.map, record('blue')); await tick();
        check('failed disposal revokes authoring and cleans its partly realized exact nodes', () => {
          assert(rejects(f.dispose), 'Unresolved realization was silently disposed as synchronized.');
          assert(old.every(style => style.parentNode === null), 'Failed disposal abandoned partial CSS.');
          assert(rejects(() => f.global.stylesheet('disposed')), 'Disposed binding resumed authoring.');
          assert(f.doc.head.querySelector('style')?.textContent === '.foreign{color:purple}', 'Disposal removed unrelated CSS.');
        });
      } finally { fault.restore(); f.close(); }
    }
    for (const mode of ['normal', 'transient', 'persistent'] as const) {
      const locus = hsonLiveMap.locus.create({ page: { document: markup, access: 'shared' }, keep: { data: { n: 1 }, access: 'shared' } },
        { authorizeProjection: ({ requested }) => ({ libraries: requested.libraries }) });
      await locus.stage(writer => writer.doc.must('page').css({ domain: 'css', kind: 'replace', stylesheet: record('green') }));
      const session = await locus.session.create({ libraries: ['page', 'keep'] });
      const client = compose_client_projection_internal(session.now().libs, []);
      const f = attach(client, true), authority = internal_livemap_aggregate_authority(client), manager = {};
      authority.claimManagement(manager);
      const old = f.carriers(), fault = mode === 'normal' ? { calls: () => 0, restore() {} }
        : fault_remove(old[0]!, mode === 'transient', mode === 'persistent'), count = reports.length;
      try {
        await session.update({ libraries: ['keep'] });
        reconcile_client_projection_snapshot_internal(client, manager, authority_projection_as_client_composition_internal(session.now().libs));
        check('hosted retirement revokes authoring before partial native cleanup', () => {
          assert(rejects(() => client.doc.must('page')), 'Retired Library remains granted.');
          assert(rejects(() => f.global.stylesheet('revoked')), 'Disposed binding accepted authoring.');
          assert(mode === 'normal' ? reports.length === count : reports.length > count, 'Retirement failure visibility is wrong.');
          assert(old.slice(1).every(style => style.parentNode === null), 'Retirement stopped at its first failed removal.');
        });
        await tick();
        if (mode === 'persistent') {
          const calls = fault.calls(); await tick(); assert(fault.calls() === calls, 'Retirement retry loop is unbounded.');
          fault.restore();
          // The retired handle still rejects authority access, after retrying cleanup.
          assert(rejects(() => f.page.css.snapshot()), 'Retired handle regained read authority.');
        }
        check('retirement retry removes exact owned carriers without reviving the binding', () => {
          assert(old.every(style => style.parentNode === null && style.sheet === null) && f.carriers().length === 0, 'Retirement left stale CSS.');
          assert(f.doc.head.querySelector('style')?.textContent === '.foreign{color:purple}', 'Retirement removed another owner.');
          assert(rejects(() => f.global.clearAll()), 'Retired binding revived authoring.');
          assert(client.data.must('keep').at(['n']).snap() === 1, 'Surviving Library changed.');
        });
      } finally { fault.restore(); f.close(); authority.releaseManagement(manager); locus.dispose(); }
    }
  } finally {
    if (priorReporter) Object.defineProperty(globalThis, 'reportError', priorReporter);
    else Reflect.deleteProperty(globalThis, 'reportError');
  }
  return checks;
}

const raw = (color: string): DocumentCssRecord => ({ rules: [], properties: [], keyframes: [],
  order: [{ kind: 'text', text: `.target{color:${color}}` }] });
const subject = (color: string): DocumentCssRecord => ({
  rules: [{ ruleKey: 'subject', selector: '[hson\\:quid="123456789"]', scopes: [], declarations: [['color', color]] }],
  properties: [], keyframes: [], order: [{ kind: 'rule', ruleKey: 'subject', scopes: [] }],
});
function subject_fixture(demanded: boolean) {
  const map = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body <x-css-reaction class="target"/>/>/>' } });
  const authority = internal_livemap_aggregate_authority(map), library = authority.libraries()[0]!;
  authority.acquireLocalDocumentIdentity(library, validate_document_path([0, 0, 1, 0, 0]), '123456789');
  replace(map, raw('green'));
  const f = attach(map);
  if (demanded) replace(map, subject('green'));
  return f;
}
function identity_reaction(f: ReturnType<typeof attach>, react: (value: string | null) => void): void {
  const NativeElement: typeof HTMLElement = Reflect.get(f.win, 'HTMLElement');
  f.win.customElements.define('x-css-reaction', class extends NativeElement {
    static get observedAttributes() { return ['hson:quid']; }
    attributeChangedCallback(_name: string, before: string | null, after: string | null) {
      if (before !== after) react(after);
    }
  });
}
function canonical(f: ReturnType<typeof attach>, expected: DocumentCssRecord): void {
  assert(JSON.stringify(encode_portable_document_stylesheet(document_css_state_internal(f.page))) === JSON.stringify(expected), 'Accepted canonical stylesheet changed.');
}
function color(f: ReturnType<typeof attach>): string { return f.win.getComputedStyle(f.doc.querySelector('.target')!).color; }
function cleaned(f: ReturnType<typeof attach>, owned: readonly HTMLStyleElement[]): void {
  assert(owned.every(style => style.parentNode === null && style.sheet === null) && f.carriers().length === 0, 'Disposal lost owned carrier cleanup.');
  assert(f.foreign.parentNode === f.doc.head && f.foreign.textContent === '.foreign{color:purple}', 'Cleanup changed unrelated CSS.');
  assert(color(f) === f.win.getComputedStyle(f.doc.body).color, 'Disposed CSS still affects the target.');
  assert(rejects(() => f.global.stylesheet('revoked')), 'Disposed authoring was reactivated.');
}

/** These include the three independently reproduced native custom-element failures. */
export async function document_css_reentrancy_browser_cases(): Promise<{ name: string; pass: boolean; error?: string }[]> {
  const checks: { name: string; pass: boolean; error?: string }[] = [], reports: unknown[] = [];
  const priorReporter = Object.getOwnPropertyDescriptor(globalThis, 'reportError');
  Object.defineProperty(globalThis, 'reportError', { configurable: true, value: (error: unknown) => reports.push(error) });
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run(); checks.push({ name, pass: true }); }
    catch (cause) { checks.push({ name, pass: false, error: cause instanceof Error ? cause.message : String(cause) }); }
  };
  try {
    for (const transient of [false, true]) await check(`final obsolete identity removal preserves its reentrant commit${transient ? ' during automatic recovery' : ''}`, async () => {
      const f = subject_fixture(true), old = f.carriers(), rev = f.map.rev, count = reports.length;
      let reactions = 0, commits = 0;
      const stop = f.page.commits.observe(() => commits++);
      const fault = transient ? fault_remove(old[0]!, false) : undefined;
      identity_reaction(f, value => { if (value === null) { reactions++; replace(f.map, raw('purple')); } });
      try {
        f.page.css.clearAll();
        if (transient) assert(reports.length === count + 1, 'Transient removal failure was hidden.');
        await tick();
        canonical(f, raw('purple')); f.settled();
        assert(reactions === 1 && commits === 2 && f.map.rev === rev + 2, 'Cleanup lost or duplicated a governed commit.');
        assert(color(f) === 'rgb(128, 0, 128)', 'New accepted CSS has no computed effect.');
        f.page.css.snapshot(); f.page.css.stylesheet('.target{color:purple}'); replace(f.map, raw('purple'));
        f.settled(); assert(commits === 2 && f.map.rev === rev + 2, 'Recovery required a compensating commit.');
      } finally { fault?.restore(); stop(); f.close(); }
    });
    await check('a commit from the final carrier removal is processed at a safe boundary', async () => {
      const f = local(), old = f.carriers(), last = old.at(-1)!, native = last.remove, rev = f.map.rev;
      let commits = 0, reactions = 0;
      const stop = f.page.commits.observe(() => commits++);
      last.remove = () => { native.call(last); reactions++; replace(f.map, raw('purple')); };
      try {
        f.page.css.clearAll(); await tick(); canonical(f, raw('purple')); f.settled();
        assert(reactions === 1 && commits === 2 && f.map.rev === rev + 2 && color(f) === 'rgb(128, 0, 128)', 'Final native removal lost newer CSS.');
      } finally { Reflect.deleteProperty(last, 'remove'); stop(); f.close(); }
    });
    await check('a transient text failure recovers a commit made inside the automatic retry', async () => {
      const f = local(), old = f.carriers(), rev = f.map.rev, count = reports.length;
      let entered = false, commits = 0;
      const stop = f.page.commits.observe(() => commits++);
      const fault = fault_text(old[1]!.firstChild!, false, false, () => {
        if (!entered) { entered = true; replace(f.map, record('purple')); }
      });
      try {
        replace(f.map, record('blue')); assert(reports.length === count + 1, 'Initial native failure was hidden.');
        await tick(); canonical(f, record('purple')); f.settled();
        assert(entered && commits === 2 && f.map.rev === rev + 2 && color(f) === 'rgb(128, 0, 128)', 'Reentrant retry lost its new target.');
        assert(f.carriers().every((style, index) => style === old[index]), 'Recovery lost reusable carriers.');
      } finally { fault.restore(); stop(); f.close(); }
    });
    await check('attributeChangedCallback disposal during identity projection retains cleanup', async () => {
      const f = subject_fixture(false), old = f.carriers(), rev = f.map.rev;
      let reactions = 0, revokedInCallback = false, commits = 0;
      const stop = f.page.commits.observe(() => commits++);
      identity_reaction(f, value => {
        if (value !== null) { reactions++; f.dispose(); revokedInCallback = rejects(() => f.global.clearAll()); }
      });
      try {
        replace(f.map, subject('blue')); await tick(); canonical(f, subject('blue')); cleaned(f, old);
        assert(reactions === 1 && revokedInCallback && commits === 1 && f.map.rev === rev + 1, 'Reentrant disposal changed authority or failed to revoke.');
        f.page.css.snapshot(); await tick(); cleaned(f, old);
      } finally { stop(); f.close(); }
    });
    await check('disposal inside a running native text operation defers cleanup without reinstalling styles', async () => {
      const f = local(), old = f.carriers(), rev = f.map.rev;
      let entered = false, deferred = false, revoked = false;
      const fault = fault_text(old[1]!.firstChild!, true, false, () => {
        if (!entered) {
          entered = true; f.dispose(); revoked = rejects(() => f.global.clearAll());
          deferred = old.some(style => style.parentNode !== null);
        }
      });
      try {
        replace(f.map, record('blue')); await tick(); canonical(f, record('blue')); cleaned(f, old);
        assert(entered && deferred && revoked && f.map.rev === rev + 1, 'Disposal nested native cleanup or admitted authoring.');
      } finally { fault.restore(); f.close(); }
    });
    await check('disposal on the second recovery pass retains its own cleanup boundary', async () => {
      const f = subject_fixture(false), old = f.carriers(), rev = f.map.rev;
      let entered = false, disposed = false, commits = 0;
      const stop = f.page.commits.observe(() => commits++);
      identity_reaction(f, value => { if (value !== null) { disposed = true; f.dispose(); } });
      const fault = fault_text(old[0]!.firstChild!, false, false, () => {
        if (!entered) { entered = true; replace(f.map, subject('blue')); }
      });
      try {
        replace(f.map, raw('blue')); await tick(); canonical(f, subject('blue')); cleaned(f, old);
        assert(entered && disposed && commits === 2 && f.map.rev === rev + 2, 'Bounded recovery dropped a late disposal request.');
      } finally { fault.restore(); stop(); f.close(); }
    });
    await check('native disposal reactions cannot author through a retained CSS handle', async () => {
      const f = subject_fixture(true), old = f.carriers(), style = old[0]!, target = f.doc.querySelector('x-css-reaction')!;
      const rev = f.map.rev, native = style.remove, fault = fault_text(style.firstChild!, false, true);
      let reactions = 0, accepted = false, revoked = false, commits = 0;
      const stop = f.page.commits.observe(() => commits++);
      identity_reaction(f, value => {
        if (value === null) {
          reactions++;
          try { f.global.stylesheet('.target{color:purple}'); accepted = true; } catch { revoked = true; }
        }
      });
      style.remove = () => { native.call(style); target.removeAttribute('hson:quid'); };
      try {
        replace(f.map, raw('blue')); await tick(); fault.restore();
        try { f.dispose(); } catch { /* The unresolved projection error remains caller-visible. */ }
        await tick(); canonical(f, raw('blue')); cleaned(f, old);
        assert(reactions === 1 && revoked && !accepted && commits === 1 && f.map.rev === rev + 1, 'Disposal callback published CSS before revocation.');
      } finally { fault.restore(); Reflect.deleteProperty(style, 'remove'); stop(); f.close(); }
    });
    for (const after of [false, true]) await check(`partial disposal retries a ${after ? 'post' : 'pre'}-removal fault without a semantic commit`, async () => {
      const f = local(), old = f.carriers(), rev = f.map.rev, fault = fault_remove(old[0]!, after);
      let commits = 0;
      const stop = f.page.commits.observe(() => commits++);
      try {
        assert(rejects(f.dispose), 'Native disposal failure was hidden from its caller.');
        assert(old.slice(1).every(style => style.parentNode === null), 'One failed removal abandoned later carriers.');
        assert(rejects(() => f.global.clearAll()), 'Pending disposal left authoring active.');
        await tick(); canonical(f, record('green')); cleaned(f, old);
        assert(commits === 0 && f.map.rev === rev, 'Disposal recovery published a semantic commit.');
      } finally { fault.restore(); stop(); f.close(); }
    });
    await check('persistent disposal remains bounded and a retained read can finish exact-node cleanup', async () => {
      const f = local(), old = f.carriers(), rev = f.map.rev, count = reports.length, fault = fault_remove(old[0]!, false, true);
      try {
        assert(rejects(f.dispose), 'Persistent disposal silently succeeded.'); await tick();
        const calls = fault.calls(); await tick();
        assert(calls === 2 && fault.calls() === calls && reports.length > count, 'Persistent cleanup was hidden or retried without bound.');
        assert(old[0]!.parentNode === f.doc.head && old.slice(1).every(style => style.parentNode === null), 'Partial ownership inventory was lost.');
        assert(rejects(() => f.page.css.snapshot()), 'Unresolved cleanup was reported as complete.');
        await tick(); fault.restore(); f.page.css.snapshot(); await tick(); cleaned(f, old);
        canonical(f, record('green')); assert(f.map.rev === rev, 'Read cleanup advanced authority.');
      } finally { fault.restore(); f.close(); }
    });
    await check('consecutive pending commits recover the latest canonical record with unchanged identities', async () => {
      const f = local(), old = f.carriers(), rev = f.map.rev, runtime = runtime_for_tree(f.tree), issued = runtime.issuedQuids.size;
      const authority = internal_livemap_aggregate_authority(f.map), ledger = enumerate_livemap_issued_quids(authority.identityEpoch().issued());
      const fault = fault_text(old[1]!.firstChild!, false, true);
      let commits = 0;
      const stop = f.page.commits.observe(() => commits++);
      try {
        replace(f.map, record('blue')); replace(f.map, record('purple')); canonical(f, record('purple'));
        fault.restore(); await tick(); f.settled();
        assert(color(f) === 'rgb(128, 0, 128)' && f.carriers().every((style, index) => style === old[index]), 'Pending recovery restored obsolete CSS or lost carriers.');
        assert(f.map.rev === rev + 2 && commits === 2 && runtime.issuedQuids.size === issued
          && JSON.stringify(enumerate_livemap_issued_quids(authority.identityEpoch().issued())) === JSON.stringify(ledger), 'Recovery committed or issued identity.');
      } finally { fault.restore(); stop(); f.close(); }
    });
    await check('disposal removes moved and detached exact carriers while preserving foreign ownership', async () => {
      const f = local(), old = f.carriers(), rev = f.map.rev;
      try {
        f.doc.body.append(old[0]!); old[1]!.remove(); f.doc.body.append(old[3]!);
        f.dispose(); await tick(); canonical(f, record('green')); cleaned(f, old);
        assert(f.map.rev === rev, 'Disposing moved carriers changed authority.');
      } finally { f.close(); }
    });
  } finally {
    await tick();
    if (priorReporter) Object.defineProperty(globalThis, 'reportError', priorReporter);
    else Reflect.deleteProperty(globalThis, 'reportError');
  }
  return checks;
}
