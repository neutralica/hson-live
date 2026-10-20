import { hsonLiveMap, continue_hosted_document } from '../../src/index.ts';
import { set_hosted_startup_fault_hook_for_tests } from '../../src/api/continuation/continue-hosted-document.ts';
import { set_document_adoption_fault_hook_for_tests } from '../../src/api/continuation/continuation.adopt.ts';
import { get_node_for_el } from '../../src/api/livetree/utils/node-map-helpers.ts';
import { runtime_for_node, runtime_owns_document } from '../../src/api/livetree/runtime/livetree-runtime.ts';
import { echo_map_internal } from '../../src/internal/governor-maps.ts';
import { register_livemap_document_identity_participant } from '../../src/api/livemap/livemap.document.registration.ts';
import { reserve_continuation_root } from '../../src/api/continuation/continuation.common.ts';

const assert = (value, message) => { if (!value) throw Error(message); };
const css = element => { const s = element.ownerDocument.defaultView.getComputedStyle(element);
  return JSON.stringify([s.color,s.marginLeft,s.paddingLeft,s.borderTopWidth]); };
function inventory(root) {
  const result = [];
  const visit = node => { result.push(node); for (const child of node.childNodes) visit(child);
    if (node.localName === 'template') visit(node.content); };
  visit(root); return result;
}
const errors = error => [error, ...(error instanceof AggregateError ? error.errors.flatMap(errors) : []),
  ...(error?.cause instanceof Error ? errors(error.cause) : [])];
export async function hostedFailures({ session, endpoint, url, recovered = false, flat = false, nativeFaults = false, revision }) {
  const modes = recovered ? ['recovered', 'publish', 'cleanup', 'carrier-cleanup'] :
    ['missing', 'duplicate', 'misplaced', 'forged', 'foreign', 'css', 'preflight', 'stale', 'carrier', 'native', 'mirror', 'transport'];
  const nativeModes = ['remove-after', 'remove-before', 'insert-after', 'insert-before', 'sibling-remove', 'sibling-insert',
    'parent-fault', 'native-and-cleanup', 'persistent-remove', 'persistent-insert', 'persistent-silent-insert'];
  if (nativeFaults) modes.push(...nativeModes);
  for (const mode of modes) {
    const frame = document.createElement('iframe');
    const loaded = new Promise(resolve => { frame.onload = resolve; });
    frame.src = url; document.body.append(frame); await loaded;
    const doc = frame.contentDocument, root = doc.documentElement, http = hsonLiveMap.echo.transport.http({ endpoint });
    let attachments = 0, subscriptions = 0, inject = true, runtime, failedEcho, undo = () => {};
    const marked = [...root.querySelectorAll('*')].filter(e => e.hasAttribute('hson:quad'));
    if (['missing','duplicate','misplaced','forged'].includes(mode)) {
      const a = marked[0], b = marked[1], x = a.getAttribute('hson:quad'), y = b.getAttribute('hson:quad');
      undo = () => { a.setAttribute('hson:quad',x); b.setAttribute('hson:quad',y); };
      if (mode === 'missing') a.removeAttribute('hson:quad');
      if (mode === 'duplicate') b.setAttribute('hson:quad',x);
      if (mode === 'misplaced') { a.setAttribute('hson:quad',y); b.setAttribute('hson:quad',x); }
      if (mode === 'forged') a.setAttribute('hson:quad','forged');
    }
    if (mode === 'foreign') { root.setAttribute('hson:quid','foreign'); undo = () => root.removeAttribute('hson:quid'); }
    if (mode === 'css') { const style = doc.querySelector('style'), value = style.textContent;
      style.firstChild.data += '\nbutton{color:purple}'; undo = () => { style.firstChild.data = value; }; }
    const before = root.outerHTML, headBefore = doc.head.outerHTML, nodes = inventory(root), elements = nodes.filter(n => n.nodeType === 1), styles = elements.map(css);
    const relationships = nodes.map(node => ({ node, children: [...node.childNodes] }));
    const parents = ['p', 'q'].map(id => doc.getElementById(`rollback-${id}`));
    const nativeMode = nativeModes.includes(mode), persistent = mode.startsWith('persistent-');
    let faults = 0, calls = 0, recoveredNodes = [], receivingDocument, faultedChild, resolvedCause;
    const attempts = new Map(), cleanupCauses = [];
    const cleanupFault = message => { const error = Error(message); cleanupCauses.push(error); throw error; };
    const target = doc.querySelector('button'); let clicks = 0; target.addEventListener('click', () => clicks++);
    const transport = {
      operations: { submit(...args) { if (inject && mode === 'transport') return Promise.reject(Error('Injected transport attach'));
        return http.operations.submit(...args); } },
      attachment: { observe(listener) { const stop = http.attachment.observe(listener); attachments++;
        return () => { attachments--; stop(); if (inject && ['cleanup','native-and-cleanup'].includes(mode)) cleanupFault('Injected observer cleanup'); }; } },
      synchronization: { async open(request, observer, options) {
        subscriptions++; let active = true;
        const finish = () => { if (active) { active = false; subscriptions--; } };
        let sub;
        try { sub = await http.synchronization.open(request, {
          onOutput: observer.onOutput, onEnd(end) { finish(); observer.onEnd(end); },
        }, options); } catch (cause) { finish(); throw cause; }
        return { cancel() { finish(); sub.cancel();
          if (inject && ['cleanup','native-and-cleanup'].includes(mode)) cleanupFault('Injected subscription cleanup'); } };
      } },
    };
    const options = { now: session.cut, credential: session.credential, transport, root };
    let restoreSetter = () => {}, replaySeen = false;
    set_document_adoption_fault_hook_for_tests(point => {
      if (mode === 'preflight' && point === 'after-first-link') throw Error('Injected adoption preflight');
    });
    set_hosted_startup_fault_hook_for_tests((point, echo) => {
      failedEcho = echo;
      if (point === 'adopted') {
        runtime = runtime_for_node(get_node_for_el(root));
        if (mode === 'stale') echo.disconnect();
        if (mode === 'carrier') {
          const element = marked[0], set = element.setAttribute; let once = true;
          element.setAttribute = function(name, value) { set.call(this,name,value);
            if (name === 'hson:quid' && once) { once = false; throw Error('Injected carrier write'); } };
          restoreSetter = () => { element.setAttribute = set; };
        }
      }
      if (mode === 'mirror' && point === 'native') root.setAttribute('title', 'unplanned');
      if (point === 'recovered' && recovered) {
        const selected = doc.querySelector(flat ? '#hosted-a' : '#left');
        assert(selected?.getAttribute('title') === 'replayed', 'Recovery attribute accepted before failure');
        assert((flat ? selected : doc.querySelector('#left span'))?.textContent === 'Recovered text', 'Recovery content accepted before failure');
        assert(doc.querySelector(flat ? '#hosted-disposable' : '#right') === null && doc.querySelector('#recovery-insert'), 'Recovery removal and insertion accepted');
        const styled = flat ? doc.querySelector('#hosted-outside') : selected;
        assert(doc.defaultView.getComputedStyle(styled).color === 'rgb(77, 88, 99)', 'Recovery CSS accepted before failure');
        if (flat) assert(styled.getAttribute('hson:quid') && styled.getAttribute('hson:quid') !== '444444444', 'Recovery introduced receiver-owned identity demand');
        replaySeen = true;
        recoveredNodes = inventory(root);
        receivingDocument = echo_map_internal(echo).doc.must('page').document;
        if (nativeFaults) {
          assert(echo.sync.appliedRev === revision && revision - session.cut.libs.revision >= 3, 'Multiple accepted revisions recovered before failure');
          assert(['p','q'].map(id => doc.getElementById(`rollback-${id}`))
            .every(parent => parent.children.length === 3 && parent.firstChild.id.startsWith('recovery-')), 'Both nested parents require restoration');
        }
        if (nativeMode) {
          const insertion = mode.includes('insert') || mode === 'parent-fault';
          const parent = mode === 'parent-fault' || persistent && insertion ? parents[0] : doc.body;
          const method = insertion ? 'insertBefore' : 'removeChild', original = parent[method];
          const introduced = new Set(recoveredNodes.filter(node => node.id?.startsWith('recovery-')));
          const at = mode.startsWith('sibling-') ? 2 : 1;
          parent[method] = function(child, ...args) {
            // Target checkpoint work, not the earlier disposal of linked nodes.
            const relevant = insertion ? nodes.includes(child) : introduced.has(child);
            if (!relevant) return original.call(this, child, ...args);
            calls++;
            attempts.set(child, (attempts.get(child) ?? 0) + 1);
            if (persistent || (!faults && calls === at)) {
              faults++; faultedChild = child;
              if (mode === 'persistent-silent-insert') return child;
              if (mode.endsWith('-after') || ['sibling-remove','sibling-insert','parent-fault','native-and-cleanup'].includes(mode)) {
                original.call(this, child, ...args);
              }
              throw Error(`Injected native ${mode}`);
            }
            return original.call(this, child, ...args);
          };
          restoreSetter = () => { parent[method] = original; };
          if (persistent) {
            const sibling = parents[1], insert = sibling.insertBefore, restorePrimary = restoreSetter;
            sibling.insertBefore = function(...args) {
              const result = insert.apply(this, args);
              if (!resolvedCause) { resolvedCause = Error('Injected resolved sibling cleanup'); throw resolvedCause; }
              return result;
            };
            restoreSetter = () => { restorePrimary(); sibling.insertBefore = insert; };
          }
        }
        if (mode === 'carrier-cleanup') {
          const element = doc.querySelector(flat ? '#hosted-outside' : '#left'), remove = element.removeAttribute; let once = true;
          element.removeAttribute = function(name) { remove.call(this, name);
            if (name === 'hson:quid' && once) { once = false; throw Error('Injected carrier cleanup'); } };
          restoreSetter = () => { element.removeAttribute = remove; };
        }
      }
      if (point === mode || (point === 'recovered' && ['cleanup', 'carrier-cleanup'].includes(mode))
        || (point === 'publish' && nativeMode)) throw Error(`Injected ${mode}`);
    });
    try {
      let failure;
      try { await continue_hosted_document(options); } catch (cause) { failure = cause; }
      assert(failure instanceof Error, `${mode}: continuation rejects`);
      if (mode === "mirror") assert(failure.phase === "mirror", "Actual Mirror attachment rejected");
      assert(!recovered || replaySeen, `${mode}: accepted recovery was exercised`);
      restoreSetter();
      if (nativeMode) {
        assert(faults > 0, `${mode}: native fault exercised (${calls} calls; ${errors(failure).map(error => error.message).join('; ')})`);
        assert(errors(failure).some(error => error.message === `Injected ${mode}`), `${mode}: original publication failure retained`);
        const incomplete = errors(failure).some(error => error.message === 'Hosted startup DOM restoration incomplete.');
        assert(incomplete === persistent, `${mode}: final restoration reported accurately`);
        assert([...attempts.values()].every(count => count <= 2), `${mode}: at most two calls per incomplete operation`);
        if (mode.endsWith('-after')) assert(attempts.get(faultedChild) === 1, `${mode}: completed mutation is not retried`);
        if (mode.endsWith('-before')) assert(attempts.get(faultedChild) === 2, `${mode}: incomplete mutation is retried once`);
        if (mode === 'native-and-cleanup') assert(cleanupCauses.length > 0 && cleanupCauses.every(cause => errors(failure).includes(cause)), 'Cleanup callback errors remain visible after DOM recovery');
      }
      assert([...elements, ...recoveredNodes.filter(node => node.nodeType === 1)].every(el => get_node_for_el(el) === undefined), `${mode}: original and recovery mappings released`);
      assert(!runtime || (runtime.quidToNode.size === 0 && runtime.pendingQuidClaims.size === 0 && !runtime_owns_document(runtime, doc)), `${mode}: runtime ownership released`);
      assert(attachments === 0 && subscriptions === 0, `${mode}: no transport attachment leak (${attachments}/${subscriptions})`);
      assert(!failedEcho || failedEcho.sync.status === 'disposed', `${mode}: Echo disposed despite cleanup exceptions`);
      reserve_continuation_root(root)();
      if (receivingDocument) {
        const unexpected = () => { throw Error('Unexpected participant invocation'); };
        register_livemap_document_identity_participant(receivingDocument, {
          preflight: unexpected, preflightLocalIdentity: unexpected, verifyExisting: unexpected, realize: unexpected,
        })();
      }
      if (persistent) {
        assert(root.outerHTML !== before, `${mode}: incomplete restoration is observable`);
        assert(resolvedCause && !errors(failure).includes(resolvedCause), `${mode}: resolved sibling exception is not reported as unresolved`);
        assert(errors(failure).some(error => error.message === (mode === 'persistent-silent-insert'
          ? 'Startup DOM checkpoint does not match its original state.' : `Injected native ${mode}`)), `${mode}: unresolved cause retained`);
        const unaffected = mode === 'persistent-remove' ? parents : [parents[1]];
        assert(relationships.filter(({ node }) => unaffected.some(parent => parent === node || parent.contains(node)))
          .every(({ node, children }) => node.childNodes.length === children.length && children.every((child, i) => node.childNodes[i] === child)), `${mode}: other parents restored`);
        assert(doc.head.outerHTML === headBefore && elements.every((el, i) => !el.isConnected || css(el) === styles[i]), `${mode}: CSS cleanup continued`);
        target.dispatchEvent(new Event('click')); assert(clicks === 1, `${mode}: listener retained despite incomplete cleanup`);
        continue;
      }
      assert(root.outerHTML === before, `${mode}: original markup, attributes, CSS and markers restored`);
      const restored = inventory(root);
      assert(restored.length === nodes.length && nodes.every((node, i) => restored[i] === node), `${mode}: all original native references restored`);
      assert(relationships.every(({ node, children }) => children.every(child => child.parentNode === node)), `${mode}: original parent relationships restored`);
      assert(elements.every((el, i) => css(el) === styles[i]), `${mode}: original computed styles restored`);
      target.dispatchEvent(new Event('click')); assert(clicks === 1, `${mode}: original listener survives`);
      inject = false; undo(); set_document_adoption_fault_hook_for_tests(undefined); set_hosted_startup_fault_hook_for_tests(undefined);
      const retry = await continue_hosted_document(options);
      assert(retry.tree.dom.el() === root && retry.mirror.status === 'active', `${mode}: legitimate retry adopts original root`);
      retry.dispose(); retry.echo.dispose();
      assert(attachments === 0 && subscriptions === 0, `${mode}: retry disposed cleanly`);
    } finally {
      restoreSetter(); set_document_adoption_fault_hook_for_tests(undefined); set_hosted_startup_fault_hook_for_tests(undefined);
      http.dispose(); frame.remove();
    }
  }
  return { failures: modes.length, recovered };
}
