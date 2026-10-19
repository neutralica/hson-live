import { hostedFailures } from "./hosted-continuation-failures.mjs";
globalThis.hostedFailures = hostedFailures;
import { internal_livemap_aggregate_authority } from '../../src/api/livemap/livemap.internal.ts';
import { echo_map_internal } from "../../src/internal/governor-maps.ts";
import { lookup_document_quad_internal } from "../../src/api/livemap/livemap.document.quad.ts";
import { hsonLiveMap, continue_hosted_document } from '../../src/index.ts';
import { get_node_for_el } from '../../src/api/livetree/utils/node-map-helpers.ts';
import { echo_receiving_document_handoff_internal } from '../../src/api/echo/echo.replica-preparation.ts';

const assert = (value, message) => { if (!value) throw Error(message); };
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
    receivers.push({ c, host, doc, root, nodes, text, transport, options, scoped, notify, pause, resume, ended, listenerCheck() { const before = clicks; button.dispatchEvent(new Event('click')); assert(clicks === before + 1, 'Original listener retained through live move'); }, armReject, rejected: () => rejection, reconcile: () => { omitCursor = true; } });
    assert(c.mirror.status === 'active', 'Mirror active');
    assert(c.tree.dom.el() === root, 'Original root adopted');
    assert(nodes.every((n, index) => [root, ...root.querySelectorAll('*')][index] === n), 'Every original Element retained');
    assert(text.every(n => n.isConnected), 'Original text nodes retained');
    assert(nodes.every((n, index) => computed(n) === styles[index]), 'First paint styles unchanged');
    assert(!nodes.some(n => n.hasAttribute('hson:quad')), 'Portable markers consumed');
    assert(doc.querySelectorAll('[data-hson-managed-document-css]').length === 1, 'One managed stylesheet');
    assert(doc.querySelector('[data-hson-managed-document-css]').textContent === c.map.css.snapshot(), 'Receiving stylesheet installed');
    for (const node of nodes) {
      const id = node.getAttribute('hson:quid');
      if (id) assert(c.tree.find.byQuid(id)?.dom.el() === node && get_node_for_el(node)?.$_meta?.quid === id, 'Exact receiving identity correspondence');
    }
    for (const name of scoped ? ['left', 'right', 'outside', 'bare'] : ['a', 'b']) {
      const subject = c.map.q(name); assert(subject?.active, `Authored QUAD ${name} active`);
      const el = doc.querySelector(scoped ? name === 'bare' ? 'aside:last-of-type' : `#${name}` : `#hosted-${name}`);
      assert(lookup_document_quad_internal(echo_map_internal(c.echo).lib("page"), name)?.quid === get_node_for_el(el)?.$_meta?.quid, `Authored QUAD ${name} owns intended Element`);
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
    assert(doc.querySelectorAll('[data-hson-managed-document-css]').length === 1, 'Exactly one managed stylesheet after update');
    assert(doc.querySelector('[data-hson-managed-document-css]').textContent === c.map.css.snapshot(), 'CSS and receiving graph agree');
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
    assert(r.doc.querySelector('[data-hson-managed-document-css]').textContent === r.c.map.css.snapshot(), 'Recovery CSS coherent');
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
  const r = receivers[1], before = r.root.outerHTML;
  await r.ended;
  assert(r.c.echo.session.status !== 'attached', 'Revoked session loses attachment');
  await rejects(() => r.c.echo.action('document.attrs.set', {
    library: 'page', target: { kind: 'path', path: [0] }, name: 'title', value: 'forbidden',
  }), 'Revoked authority cannot submit document mutations');
  // Established queued LiveTree work remains governed by normal Echo disposal.
  const queued = r.c.tree.async.attrs.set('title', 'forbidden');
  const rejected = rejects(() => queued, 'Disposal settles queued stale tree work');
  r.c.dispose(); r.c.echo.dispose(); await rejected;
  assert(r.root.outerHTML === before, 'Revocation does not reconstruct the adopted page');
};

globalThis.hostedArmRejection = () => receivers.forEach((r,i) => r.armReject(i === 0));
globalThis.hostedRejected = async () => { await Promise.all(receivers.map(r => r.rejected())); };
