import { hsonLiveMap } from '../../src/api/livemap/index.ts';
import { echo_receiving_document_handoff_internal } from '../../src/api/echo/echo.replica-preparation.ts';
import { echo_map_internal } from '../../src/internal/governor-maps.ts';
import { capture_continuation_document_root } from '../../src/api/continuation/continuation.common.ts';
import { adopt_exact_existing_document } from '../../src/api/continuation/continuation.adopt.ts';
import { get_node_for_el } from '../../src/api/livetree/utils/node-map-helpers.ts';

const assert = (value, message) => { if (!value) throw Error(message); };
const rejectsExpired = run => {
  let failure;
  try { run(); } catch (error) { failure = error; }
  assert(failure instanceof Error && /Receiving handoff has expired/.test(failure.message), 'Expected handoff freshness rejection');
};
// Deliberately stop at aborting preflight: no commit, CSS switch, Mirror, or public continuation.
globalThis.receivingHandoffPreflight = async ({ sessions, endpoint }) => {
  const root = document.documentElement, nodes = [root, ...root.querySelectorAll('*')];
  const computed = element => { const css = getComputedStyle(element);
    return JSON.stringify([css.color, css.paddingLeft, css.marginLeft, css.borderTopWidth, css.backgroundColor]); };
  const before = root.outerHTML, styles = nodes.map(computed);
  const target = document.querySelector('button'); let clicks = 0, mutations = 0;
  const click = () => clicks++;
  target.addEventListener('click', click);
  const observer = new MutationObserver(records => { mutations += records.length; });
  observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  const receivers = []; let disconnections = 0, reconnections = 0;
  try {
    for (const [index, session] of sessions.entries()) {
      const http = hsonLiveMap.echo.transport.http({ endpoint });
      let notify, onCancel = () => {};
      const transport = { operations: http.operations,
        attachment: { observe(listener) { notify = listener; return http.attachment.observe(listener); } },
        synchronization: { async open(...args) {
          const subscription = await http.synchronization.open(...args);
          return { cancel() { try { onCancel(); } finally { subscription.cancel(); } } };
        } },
      };
      let echo;
      try {
        echo = await hsonLiveMap.echo.create({ now: session.cut, credential: session.credential, transport });
        const cap = echo_receiving_document_handoff_internal(echo), evidence = cap.prepare('page');
        const selected = echo_map_internal(echo).doc.must('page');
        const canonical = capture_continuation_document_root(selected);
        for (let attempt = 0; attempt < 2; attempt++) {
          cap.assert(evidence, 'page');
          const adoption = adopt_exact_existing_document(canonical, root, evidence.portableCss, { quads: evidence.quads });
          try {
            evidence.assertCurrent();
            assert(adoption.portableSubjects.length === evidence.subjects.length, 'Complete portable carrier matching');
            for (const matched of adoption.portableSubjects) {
              const subject = evidence.subjects.find(s => s.name === matched.name);
              assert(subject?.quid === matched.quid, 'Original label maps to receiving subject');
              assert(matched.element.getAttribute('hson:quad') === matched.name, 'Original marker retained');
              assert(nodes.includes(matched.element), 'Original Element retained by reference');
            }
          } finally { adoption.abort(); }
          assert(nodes.every(e => get_node_for_el(e) === undefined), 'Aborted preflight releases native mappings');
          assert(root.outerHTML === before, 'Preflight and abort leave markup, CSS, attributes intact');
          assert(nodes.every((e, i) => [root, ...root.querySelectorAll('*')][i] === e), 'Same node inventory');
          assert(nodes.every((e, i) => computed(e) === styles[i]), 'First-paint CSS unchanged');
        }
        receivers.push(evidence.subjects.map(s => s.quid));
        assert(evidence.receivingCss.join('\n\n') === selected.css.snapshot(), 'Receiving CSS already installed in Echo');
        const carriers = [...document.querySelectorAll('style[data-hson-managed-document-css]')];
        assert(JSON.stringify(carriers.map(style => style.textContent)) === JSON.stringify(evidence.portableCss), 'Browser retains exact portable carrier contents and order');
        assert(carriers.every(style => style.getAttribute('data-hson-managed-document-css') === 'managed' && style.parentElement === document.head), 'Portable carriers retain expected ownership and mount');
        assert(carriers.every((style, index) => index + 1 === carriers.length || style.nextSibling === carriers[index + 1]), 'Portable carrier order is retained');
        const expired = () => {
          rejectsExpired(() => {
            cap.assert(evidence, 'page');
            // A stale assertion must never authorize even temporary exact adoption.
            const adoption = adopt_exact_existing_document(canonical, root, evidence.portableCss, { quads: evidence.quads });
            adoption.abort();
          });
          rejectsExpired(() => cap.prepare('page'));
          rejectsExpired(evidence.assertCurrent);
        };
        const cancellationFailure = Error('Cancellation failed'); let cancellations = 0;
        onCancel = () => {
          cancellations++;
          assert(echo.session.status === 'detached', 'Cancellation observes detached session');
          expired();
          if (index === 1) throw cancellationFailure;
        };
        let failure;
        try { notify({ kind: 'observation-interrupted' }); } catch (error) { failure = error; }
        assert(failure === (index === 1 ? cancellationFailure : undefined), 'Only injected cancellation failure escapes');
        assert(cancellations === 1, 'Live synchronization was cancelled');
        disconnections++; expired();
        notify({ kind: 'observation-interrupted' }); notify({ kind: 'observation-interrupted' });
        assert(cancellations === 1, 'Repeated loss does not repeat cancellation'); expired();
        onCancel = () => {};
        notify({ kind: 'available' });
        for (let retry = 0; retry < 400 && (echo.session.status !== 'attached' || echo.sync.status !== 'caught_up'); retry++) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        assert(echo.session.status === 'attached' && echo.sync.status === 'caught_up', 'Legitimate reconnect completes');
        reconnections++; expired();
        assert(root.outerHTML === before && nodes.every((e, i) => [root, ...root.querySelectorAll('*')][i] === e), 'Loss and reconnect preserve original DOM');
        assert(nodes.every((e, i) => computed(e) === styles[i] && get_node_for_el(e) === undefined), 'Expired preflight leaves styles and native mappings unchanged');
      } finally { onCancel = () => {}; echo?.dispose(); http.dispose(); }
    }
    assert(receivers[0].every(id => !receivers[1].includes(id)), 'Independent receiving identities');
    target.dispatchEvent(new Event('click')); assert(clicks === 1, 'Existing listener retained');
    await Promise.resolve();
    assert(mutations === 0 && observer.takeRecords().length === 0, 'No DOM writes during preflight');
    assert(!nodes.some(e => e.hasAttribute('hson:quid')), 'No receiving authority installed in DOM');
    return { echoes: receivers.length, subjects: receivers[0].length, preflights: 4, disconnections, reconnections, mutations, retained: nodes.length };
  } finally { observer.disconnect(); target.removeEventListener('click', click); }
};
