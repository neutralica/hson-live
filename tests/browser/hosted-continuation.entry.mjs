import { hostedFailures } from "./hosted-continuation-failures.mjs";
import { hostedCssQueueRevocation } from "./hosted-css-queue.mjs";
import { hostedCssAdmission } from "./hosted-css-admission.mjs";
globalThis.hostedCssAdmission = hostedCssAdmission;
globalThis.hostedFailures = hostedFailures;
globalThis.hostedCssQueueRevocation = hostedCssQueueRevocation;
import { internal_livemap_aggregate_authority } from '../../src/api/livemap/livemap.internal.ts';
import { echo_map_internal } from "../../src/internal/governor-maps.ts";
import { lookup_document_quad_internal } from "../../src/api/livemap/livemap.document.quad.ts";
import { hsonLiveMap, continue_hosted_document } from '../../src/index.ts';
import { get_node_for_el } from '../../src/api/livetree/utils/node-map-helpers.ts';
import { echo_receiving_document_handoff_internal } from '../../src/api/echo/echo.replica-preparation.ts';
import { document_css_state_internal } from '../../src/api/livemap/livemap.libraries.ts';
import { render_portable_document_stylesheet_carriers } from '../../src/internal/css/portable-document-stylesheet.ts';

const assert = (value, message) => { if (!value) throw Error(message); };
const managedSelector = 'style[data-hson-managed-document-css]';
function checkCarriers(c, doc, previous) {
  // Derive the target from accepted receiver authority, independently of native styles.
  const state = document_css_state_internal(echo_map_internal(c.echo).doc.must('page'));
  const expected = render_portable_document_stylesheet_carriers(state);
  const count = state.order.reduce((total, entry, index) => total
    + (entry.kind === 'text' || index === 0 || state.order[index - 1].kind === 'text' ? 1 : 0), 0);
  assert(expected.length === count, 'Each raw contribution and contiguous structured run has its own carrier');
  assert(c.map.css.snapshot() === expected.join('\n\n'), 'Accepted stylesheet snapshot retains contribution order');
  const styles = [...doc.querySelectorAll(managedSelector)];
  assert(styles.length === count, 'Exact accepted managed carrier count');
  styles.forEach((style, index) => {
    assert(style.parentElement === doc.head && style.getAttribute('data-hson-managed-document-css') === 'managed', 'Managed carrier ownership and head placement');
    assert(style.textContent === expected[index], 'Exact ordered receiving contribution text');
    if (index) assert(styles[index - 1].nextSibling === style, 'Managed carriers are contiguous and ordered');
    if (index < previous.length) assert(style === previous[index], 'Surviving owned carrier retained in order');
  });
  previous.slice(count).forEach(style => assert(!style.isConnected, 'Retired owned carrier removed'));
  return styles;
}
const receivers = [];
const computed = element => { const s = element.ownerDocument.defaultView.getComputedStyle(element);
  return JSON.stringify([s.color,s.marginLeft,s.paddingLeft,s.borderTopWidth,s.backgroundColor]); };
async function frame(url) {
  const frame = document.createElement('iframe');
  const loaded = new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = reject; });
  frame.src = url; document.body.append(frame); await loaded;
  return frame;
}
async function rejects(run, message) {
  let error; try { await run(); } catch (cause) { error = cause; }
  assert(error instanceof Error, message); return error;
}
globalThis.hostedContinuationStart = async ({ sessions, endpoint, url, scoped }) => {
  for (const session of sessions) {
    const host = await frame(url), doc = host.contentDocument, root = doc.documentElement;
    const nodes = [root, ...root.querySelectorAll('*')], styles = nodes.map(computed);
    const originalManagedStyles = [...doc.querySelectorAll(managedSelector)];
    const originalPredecessor = originalManagedStyles[0]?.previousSibling;
    const reviewTokenParity = () => {
      if (!scoped) return;
      const button = doc.querySelector('button'), label = button.querySelector('span');
      const rootStyle = doc.defaultView.getComputedStyle(button);
      for (const suffix of ['nbsp', 'space', 'hex']) assert(rootStyle.getPropertyValue(`--review-${suffix}`) === rootStyle.getPropertyValue(`--text-${suffix}`), `Structured/textual ${suffix} token parity`);
      assert(rootStyle.fontFamily === doc.defaultView.getComputedStyle(label).fontFamily, 'Structured/textual Unicode font-family parity');
    };
    reviewTokenParity();
    if (scoped) assert(doc.defaultView.getComputedStyle(doc.querySelector('button span')).getPropertyValue('--structured-media').trim() === 'present', 'Structured media/QUAD styling applies before JavaScript adoption');
    const text = [];
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) text.push(walker.currentNode);
    const button = doc.querySelector('button'); let clicks = 0;
    button.addEventListener('click', () => clicks++);
    let http = hsonLiveMap.echo.transport.http({ endpoint });
    let notify, stopInner = () => {}, omitCursor = false, resolveEnded;
    const ended = new Promise(resolve => { resolveEnded = resolve; });
    const observe = listener => http.attachment.observe(event => {
      try { listener(event); } finally { if (event.kind === 'ended' || event.kind === 'fenced') resolveEnded(); }
    });
    let rejectNext, rejection;
    const armReject = duplicate => {
      rejection = new Promise((resolve, reject) => { rejectNext = { duplicate, resolve, reject }; });
    };
    const transport = { operations: { submit: (...args) => http.operations.submit(...args) }, synchronization: { open(request, observer, options) {
      const downstream = observer;
      observer = { ...downstream, async onOutput(output) {
        if (!rejectNext || output.type !== 'commit') return downstream.onOutput(output);
        const pending = rejectNext; rejectNext = undefined;
        const aggregate = internal_livemap_aggregate_authority(echo_map_internal(c.echo));
        const ledger = aggregate.identityEpoch().issued(), before = root.outerHTML, revision = c.echo.sync.appliedRev;
        const refs = [root, ...root.querySelectorAll('*')];
        const forged = structuredClone(output), effect = forged.commit.commit.operations.find(op => op.domain === 'document').effect;
        if (pending.duplicate) effect.subjects.push(effect.subjects[0]); else effect.before = '0'.repeat(64);
        try {
          try { await downstream.onOutput(forged); } catch {}
          assert(c.echo.sync.appliedRev === revision, 'Rejected correspondence does not advance progress');
          assert(aggregate.identityEpoch().issued() === ledger, 'Rejected correspondence does not install issuance');
          assert(root.outerHTML === before && refs.every((el,i) => [root,...root.querySelectorAll('*')][i] === el), 'Rejected correspondence leaves DOM, markers and CSS unchanged');
          pending.resolve();
        } catch (error) { pending.reject(error); }
      } };
      if (!omitCursor) return http.synchronization.open(request, observer, options);
      omitCursor = false; const { cursor: _cursor, ...fresh } = request;
      return http.synchronization.open(fresh, observer, options);
    } }, dispose: () => http.dispose(),
      attachment: { observe(listener) { notify = listener; stopInner = observe(listener); return () => stopInner(); } } };
    const pause = () => { stopInner(); http.dispose(); notify({ kind: 'observation-interrupted' }); };
    const resume = () => { http = hsonLiveMap.echo.transport.http({ endpoint }); stopInner = observe(notify); };
    const options = { now: session.cut, credential: session.credential, transport, root };
    const c = await continue_hosted_document(options);
    const receiver = { c, host, doc, root, nodes, text, transport, options, scoped, notify, pause, resume, ended, listenerCheck() { const before = clicks; button.dispatchEvent(new Event('click')); assert(clicks === before + 1, 'Original listener retained through live move'); }, armReject, rejected: () => rejection, reconcile: () => { omitCursor = true; } };
    receiver.cssRule = c.tree.css.global.sel('.cut3a');
    receiver.asyncCssRule = c.tree.async.css.global.sel('.cut3a');
    receivers.push(receiver);
    assert(c.mirror.status === 'active', 'Mirror active');
    assert(c.tree.dom.el() === root, 'Original root adopted');
    assert(nodes.every((n, index) => [root, ...root.querySelectorAll('*')][index] === n), 'Every original Element retained');
    assert(text.every(n => n.isConnected), 'Original text nodes retained');
    assert(nodes.every((n, index) => computed(n) === styles[index]), 'First paint styles unchanged');
    reviewTokenParity();
    assert(!nodes.some(n => n.hasAttribute('hson:quad')), 'Portable markers consumed');
    const sourceCss = session.cut.libs.libraries.find(entry => entry.name === 'page').css;
    const rawTexts = css => css.order.filter(entry => entry.kind === 'text').map(entry => entry.text);
    assert(JSON.stringify(rawTexts(document_css_state_internal(echo_map_internal(c.echo).doc.must('page')))) === JSON.stringify(rawTexts(sourceCss)), 'Accepted raw contributions preserve exact authored text and order');
    receiver.carriers = checkCarriers(c, doc, originalManagedStyles);
    assert(receiver.carriers.length === originalManagedStyles.length && originalManagedStyles.every(style => style.isConnected), 'Every original owned carrier preserved during adoption');
    assert(receiver.carriers[0]?.previousSibling === originalPredecessor, 'Managed carriers retain placement after authored head content');
    for (const node of nodes) {
      const id = node.getAttribute('hson:quid');
      if (id) assert(c.tree.find.byQuid(id)?.dom.el() === node && get_node_for_el(node)?.$_meta?.quid === id, 'Exact receiving identity correspondence');
    }
    for (const name of scoped ? ['left', 'right', 'outside', 'bare'] : ['a', 'b']) {
      const subject = c.map.q(name); assert(subject?.active, `Authored QUAD ${name} active`);
      const el = doc.querySelector(scoped ? name === 'bare' ? 'aside:last-of-type' : `#${name}` : `#hosted-${name}`);
      assert(lookup_document_quad_internal(echo_map_internal(c.echo).doc.must("page"), name)?.quid === get_node_for_el(el)?.$_meta?.quid, `Authored QUAD ${name} owns intended Element`);
    }
    button.dispatchEvent(new Event('click')); assert(clicks === 1, 'Existing listener survives');
    await rejects(() => continue_hosted_document(options), 'Repeated continuation rejects');
    await rejects(() => echo_receiving_document_handoff_internal(c.echo).prepare('page'), 'Consumed H3A evidence expired');
  }
  await rejects(() => continue_hosted_document({ ...receivers[1].options, root: receivers[0].root }), 'Another session cannot acquire an owned DOM root');
  const ids = receivers.map(r => r.nodes.flatMap(n => n.getAttribute('hson:quid') ?? []));
  assert(ids[0].every(id => !ids[1].includes(id)), 'Independent receivers never share identity authority');
  return { receivers: receivers.length, elements: receivers[0].nodes.length, identities: ids[0].length };
};
globalThis.hostedContinuationDispose = () => {
  for (const r of receivers.splice(0)) { r.c.dispose(); r.c.echo.dispose(); r.transport.dispose(); r.host.remove(); }
};
globalThis.hostedCssMap = async (writable = true) => {
  const receiver = receivers[0], tree = receiver.c.tree;
  const before = receiver.c.map.rev;
  const rule = tree.async.css.global.sel('.cut3a');
  const css = { '--cut3a': 'base', _hover: { '& > .child': { _focus: { '--cut3a': 'nested' } } },
    $media: { screen: { '& > .child': { __before: { '--cut3a': 'media' } } } } };
  await rejects(() => tree.css.global.sel('.cut3a').setMany(css), 'Hosted recursive CSS requires async authority');
  if (!writable) {
    const snapshot = receiver.c.map.css.snapshot();
    await rejects(() => rule.setMany(css), 'Read-only hosted sessions reject recursive CSS through authority');
    assert(receiver.c.map.rev === before && receiver.c.map.css.snapshot() === snapshot, 'Authority denial publishes no recursive branches');
    return { denied: true };
  }
  await rule.setMany(css);
  assert(receiver.c.map.rev === before + 1, 'One hosted recursive map produces one governed revision');
  await rule.setMany(css);
  assert(receiver.c.map.rev === before + 1, 'Hosted recursive no-op does not revise');
  const snapshot = receiver.c.map.css.snapshot();
  await rejects(() => rule.setMany({ '--cut3a': 'rejected', '& > .child': { _hover: { color: null } } }), 'Hosted later invalid nested branch rejects');
  assert(receiver.c.map.rev === before + 1 && receiver.c.map.css.snapshot() === snapshot, 'Hosted nested rejection is atomic');
  await Promise.all([
    rule.setMany({ _hover: { '& > .child': { _focus: { '--cut3a': 'first' } } } }),
    rule.setMany({ _hover: { '& > .child': { _focus: { '--cut3a': 'second' } } } }),
  ]);
  assert(receiver.c.map.rev === before + 3 && receiver.c.map.css.snapshot().includes('--cut3a:second'), 'Hosted recursive writes preserve async submission order');
  await rule.setMany({ '--cut3a': undefined, _hover: { '& > .child': { _focus: { '--cut3a': undefined } } },
    $media: { screen: { '& > .child': { __before: { '--cut3a': undefined } } } } });
  assert(receiver.c.map.rev === before + 4 && !receiver.c.map.css.snapshot().includes('.cut3a'), 'Hosted deletion retires the final declaration of every recursive rule');
  return { revisions: receiver.c.map.rev - before };
};
globalThis.hostedCssSubjects = async () => {
  const r = receivers[0], { c, doc } = r, before = c.echo.sync.appliedRev;
  const a = doc.querySelector('#hosted-a'), b = doc.querySelector('#hosted-b');
  const nodes = [a, b], identities = nodes.map(node => node.getAttribute('hson:quid'));
  const css = { '@:a': { '--subject-first': 'one', '--subject-second': 'two',
    _hover: { '& > i': { '--subject-nested': 'nested' } } },
    $media: { screen: { '@:b': { '--subject-media': 'right', __before: { '--subject-pseudo': 'pseudo' } } } } };
  const rule = c.tree.async.css.global.sel('.subject-browser');
  await rule.setMany(css);
  assert(c.echo.sync.appliedRev === before + 1, 'Multiple CSS subjects publish one authority transition');
  await globalThis.hostedRevision(before + 1);
  for (const receiver of receivers) {
    const left = receiver.doc.querySelector('#hosted-a'), right = receiver.doc.querySelector('#hosted-b');
    assert(receiver.doc.defaultView.getComputedStyle(left).getPropertyValue('--subject-first').trim() === 'one', 'Contextual CSS reaches each receiving subject');
    assert(receiver.doc.defaultView.getComputedStyle(right).getPropertyValue('--subject-media').trim() === 'right', 'Media reference reaches the other subject');
    assert(receiver.c.map.css.snapshot().includes(left.getAttribute('hson:quid')), 'Replay uses receiving-local identities');
    receiver.carriers = checkCarriers(receiver.c, receiver.doc, receiver.carriers);
  }
  await rule.setMany(css);
  assert(c.echo.sync.appliedRev === before + 1, 'Contextual CSS no-op retains canonical rule identity');
  assert(nodes.every((node, index) => node.getAttribute('hson:quid') === identities[index]), 'Subject authoring preserves native Elements and identities');
  await rule.setMany({ '@:a': { '--subject-first': undefined, '--subject-second': undefined,
    _hover: { '& > i': { '--subject-nested': undefined } } },
    $media: { screen: { '@:b': { '--subject-media': undefined, __before: { '--subject-pseudo': undefined } } } } });
  assert(c.echo.sync.appliedRev === before + 2, 'Complete contextual deletion publishes once');
  return { subjects: 2, receivers: receivers.length, revisions: 2 };
};
globalThis.hostedRevision = async rev => {
  await Promise.all(receivers.map(({ c }) => new Promise((resolve, reject) => {
    let stop = () => {};
    const check = () => {
      if (c.mirror.status !== 'active') { stop(); reject(c.mirror.failure ?? Error('Mirror failed')); }
      else if (c.echo.sync.appliedRev >= rev && c.mirror.sourceRevision === c.map.rev) { stop(); resolve(); }
    };
    stop = c.echo.commits.observe(() => queueMicrotask(check)); check();
  })));
};
globalThis.hostedCheckLive = phase => {
  for (const r of receivers) {
    const { c, doc, scoped } = r;
    const a = doc.querySelector(scoped ? '#left' : '#hosted-a'), b = doc.querySelector(scoped ? '#right' : '#hosted-b');
    if (phase === 'attrs') {
      assert(a.getAttribute('title') === 'authoritative', 'Attribute update on intended subject');
      assert((scoped ? a.querySelector('button') : a).hasAttribute('disabled'), 'Flag update');
      assert(!b.hasAttribute('title'), 'Repeated occurrence isolated');
      r.left = c.map.q(scoped ? 'left' : 'a'); r.right = c.map.q(scoped ? 'right' : 'b');
      r.a = a; r.b = b; r.oldId = a.getAttribute('hson:quid');
      r.oldIds = [a, ...a.querySelectorAll('*')].flatMap(el => el.getAttribute('hson:quid') ?? []);
      r.siblingStyle = computed(b);
    } else if (phase === 'content') {
      assert(a.textContent === 'Changed', 'Content update');
      r.inserted = doc.querySelector('#inserted');
      assert(r.inserted?.textContent === 'Inserted', 'Structural insert');
      assert(a === r.a && b === r.b, 'Surviving Elements retained through content edit');
      assert(doc.defaultView.getComputedStyle(a).color === 'rgb(21, 43, 65)', 'Subject CSS update');
    } else if (phase === 'demand') {
      assert(doc.querySelector('#inserted') === r.inserted, 'First CSS demand retains original Element');
      const id = r.inserted.getAttribute('hson:quid');
      assert(id && id !== '222222222' && c.tree.find.byQuid(id)?.dom.el() === r.inserted, 'New receiving identity and correspondence');
      assert(doc.defaultView.getComputedStyle(r.inserted).color === 'rgb(22, 44, 66)', 'First subject CSS applies');
    } else if (phase === 'move') {
      assert(a === r.a && b === r.b && a.previousElementSibling === b, 'Move preserves Elements');
      assert(a.getAttribute('hson:quid') === r.oldId, 'Move preserves receiving identity'); r.listenerCheck();
    } else if (phase === 'remove') {
      assert(!r.a.isConnected && r.b.isConnected, 'Only removed occurrence detached');
      assert(!r.left.active && r.right.active, 'Removed handle retired; sibling active');
      assert(!c.map.css.snapshot().includes(r.oldId), 'Retired subject CSS removed');
      assert(r.oldIds.every(id => !c.map.css.snapshot().includes(id)), 'Nested occurrence-owned CSS retired');
      assert(c.tree.find.byQuid(r.oldId) === undefined, 'Retired identity absent');
    } else if (phase === 'graph-first-cleanup') {
      const retired = r.nodes.find(el => el.id === 'hosted-disposable');
      assert(!retired.isConnected && !doc.querySelector('#hosted-disposable'), 'Graph-first CSS cleanup retires disposable subject');
      assert(!c.map.css.snapshot().includes(retired.getAttribute('hson:quid')), 'Retired disposable CSS stays absent');
    } else if (phase === 'replace') {
      const fresh = doc.querySelector('#replacement');
      assert(fresh && fresh !== r.a, 'Replacement has a new Element');
      assert(!r.left.active && fresh.getAttribute('hson:quid') !== r.oldId, 'Replacement never revives retired handle');
      assert(!c.map.css.snapshot().includes(r.oldId), 'Replacement never restores retired CSS');
      assert(r.oldIds.every(id => !c.map.css.snapshot().includes(id)), 'Replacement never restores retired nested CSS');
      if (scoped) {
        assert(doc.defaultView.getComputedStyle(fresh).borderTopWidth === '3px', 'Fresh occurrence CSS installed');
        assert(doc.defaultView.getComputedStyle(fresh.querySelector('span')).color === 'rgb(10, 20, 30)', 'Fresh nested occurrence CSS installed');
      }
    }
    assert(computed(b) === r.siblingStyle, 'Repeated sibling styles remain isolated');
    assert(doc.defaultView.getComputedStyle(doc.querySelector(scoped ? '#outside' : '#hosted-outside')).color
      === (scoped ? 'rgb(40, 50, 60)' : 'rgb(0, 0, 0)'), 'Unrelated subject retains its styles');
    r.carriers = checkCarriers(c, doc, r.carriers);
    assert(c.tree.dom.el() === r.root, 'Root continuity');
  }
  return phase;
};
globalThis.hostedReduced = () => {
  const r = receivers[0];
  assert(r.c.mirror.status === 'failed' || r.c.mirror.status === 'disposed', 'Projection loss retires Mirror');
  assert(!r.right.active, 'Projection loss retires authored handles');
  assert(r.doc.querySelectorAll('[data-hson-managed-document-css]').length === 0, 'Projection loss removes owned CSS');
  assert(receivers[1].c.mirror.status === 'active', 'Other authorized receiver unaffected');
};
globalThis.hostedRefresh = async () => { for (const r of receivers) { r.pause(); r.resume(); await r.c.echo.session.reattach(); } };

globalThis.hostedPause = () => { for (const r of receivers) r.pause(); };
globalThis.hostedResume = async rev => {
  receivers[0].reconcile();
  for (const r of receivers) { r.resume(); await r.c.echo.session.reattach();
    assert(r.c.echo.sync.appliedRev === rev && r.c.mirror.sourceRevision === r.c.map.rev, 'Recovery revisions coherent');
    assert(r.c.mirror.status === 'active' && r.c.tree.dom.el() === r.root, 'Recovery retains adopted root');
    assert(r.doc.querySelector(r.scoped ? '#right' : '#hosted-b').getAttribute('title') === 'missed', 'Missed update recovered');
    r.carriers = checkCarriers(r.c, r.doc, r.carriers);
  }
  assert(receivers[0].c.echo.sync.strategy === 'reconcile', 'Forced full reconciliation exercised');
  assert(receivers[1].c.echo.sync.strategy === 'replay', 'Missed revision replay exercised');
};

globalThis.hostedTopologies = async ({ variants, endpoint }) => {
  for (const variant of variants) {
    const host = await frame(variant.url), doc = host.contentDocument;
    const root = variant.document === 'live' ? doc.querySelector('main') : doc.documentElement;
    const nodes = [root, ...root.querySelectorAll('*')];
    const transport = hsonLiveMap.echo.transport.http({ endpoint });
    const options = { now: variant.cut, credential: variant.credential, transport, root };
    const c = await continue_hosted_document(options);
    assert(c.mirror.status === 'active' && c.tree.dom.el() === root, 'Topology adopted');
    assert(nodes.every((n,i) => [root, ...root.querySelectorAll('*')][i] === n), 'CSS-free references stable');
    assert(doc.querySelectorAll('[data-hson-managed-document-css]').length === 0, 'CSS-free adoption creates no stylesheet');
    const initial = variant.cut.libs.libraries.find(e => e.name === variant.document);
    if (variant.document === 'flat') {
      assert(initial.scopes === undefined, 'Flat topology retained alongside scoped Libraries');
    } else if (variant.document === 'page') assert(initial.scopes.occurrences.length === 0, 'Scoped-empty provenance retained');
    else assert(initial.scopes.occurrences.length === 1, 'CSS-free scoped occurrence retained');
    await c.tree.async.attrs.set('title', 'browser');
    assert(root.getAttribute('title') === 'browser', 'Authorized projected mutation reaches adopted DOM');
    c.dispose(); c.echo.dispose();
    const before = root.outerHTML;
    await rejects(() => continue_hosted_document(options), 'Retained native identity cannot be acquired by another receiver');
    assert(root.outerHTML === before, 'Rejected repeated continuation preserves disposed realization');
    transport.dispose(); host.remove();
  }
  return { topologies: variants.length };
};

globalThis.hostedRevoked = async () => {
  const r = receivers[1], owned = new Set(r.carriers);
  const authoredStyle = r.doc.createElement('style');
  authoredStyle.textContent = '/* authored revocation sentinel */'; r.doc.head.prepend(authoredStyle);
  // Exclude only the known owned carriers; every other node, including text,
  // must survive with its exact identity, attributes, order and native mapping.
  const capture = node => ({ node, value: node.nodeValue,
    attrs: node.nodeType === 1 ? [...node.attributes].map(attr => [attr.name, attr.value]) : undefined,
    mapped: node.nodeType === 1 ? get_node_for_el(node) : undefined,
    children: [...node.childNodes].filter(child => !owned.has(child)).map(capture) });
  const before = capture(r.root), unrelated = capture(receivers[0].root);
  const button = r.doc.querySelector(r.scoped ? '#right button' : '#hosted-b');
  let clicks = 0; const listener = () => clicks++;
  button.addEventListener('click', listener);
  await r.ended;
  assert(r.c.echo.session.status !== 'attached', 'Revoked session loses attachment');
  await rejects(() => r.c.echo.action('document.attrs.set', {
    library: 'page', target: { kind: 'path', path: [0] }, name: 'title', value: 'forbidden',
  }), 'Revoked authority cannot submit document mutations');
  // Established queued LiveTree work remains governed by normal Echo disposal.
  const queued = r.c.tree.async.attrs.set('title', 'forbidden');
  const rejected = rejects(() => queued, 'Disposal settles queued stale tree work');
  r.c.dispose(); r.c.echo.dispose(); await rejected;
  const revokedRevision = r.c.echo.sync.appliedRev;
  const revokedCss = { '& > .child': { _hover: { '--cut3a': 'forbidden' } } };
  await rejects(() => r.cssRule.setMany(revokedCss), 'Revoked hosted binding rejects retained recursive sync authoring');
  await rejects(() => r.asyncCssRule.setMany(revokedCss), 'Revoked hosted binding rejects retained recursive async authoring');
  assert(r.c.echo.sync.appliedRev === revokedRevision, 'Revoked recursive CSS cannot advance the replica');
  const preserved = (expected, node) => {
    assert(node === expected.node && node.nodeValue === expected.value, 'Revocation retains exact authored nodes and text');
    if (expected.attrs) {
      assert(JSON.stringify([...node.attributes].map(attr => [attr.name, attr.value])) === JSON.stringify(expected.attrs), 'Revocation preserves all authored and QUID/QUAD attributes');
      assert(get_node_for_el(node) === expected.mapped, 'Revocation retains native node correspondence');
    }
    assert(node.childNodes.length === expected.children.length, 'Only owned carriers are removed');
    expected.children.forEach((child, index) => preserved(child, node.childNodes[index]));
  };
  assert(r.doc.querySelectorAll(managedSelector).length === 0 && [...owned].every(style => !style.isConnected), 'Revocation disposal retires every owned managed carrier');
  assert(r.doc.documentElement === r.root && r.root.isConnected && receivers[0].doc.documentElement === receivers[0].root, 'Adopted and unrelated document roots remain mounted');
  preserved(before, r.root); preserved(unrelated, receivers[0].root);
  button.dispatchEvent(new Event('click')); assert(clicks === 1, 'Surviving authored listener remains attached after revocation disposal');
  button.removeEventListener('click', listener);
};

globalThis.hostedArmRejection = () => receivers.forEach((r,i) => r.armReject(i === 0));
globalThis.hostedRejected = async () => { await Promise.all(receivers.map(r => r.rejected())); };
