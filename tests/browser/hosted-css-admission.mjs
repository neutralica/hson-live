import { hsonLiveMap, continue_hosted_document } from '../../src/index.ts';
import { echo_map_internal } from '../../src/internal/governor-maps.ts';
import { internal_livemap_aggregate_authority } from '../../src/api/livemap/livemap.internal.ts';
import { enumerate_livemap_issued_quids } from '../../src/api/livemap/livemap.identity-epoch.ts';
import { lookup_document_quad_internal } from '../../src/api/livemap/livemap.document.quad.ts';

export async function hostedCssAdmission({ session, endpoint, url, ownerQuid }) {
  const assert = (value, message) => { if (!value) throw Error(message); };
  const frame = document.createElement('iframe');
  const loaded = new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = reject; });
  frame.src = url; document.body.append(frame); await loaded;
  const transport = hsonLiveMap.echo.transport.http({ endpoint });
  let c;
  try {
    const root = frame.contentDocument.documentElement;
    c = await continue_hosted_document({ now: session.cut, credential: session.credential, transport, root });
    const receiver = echo_map_internal(c.echo), a = internal_livemap_aggregate_authority(receiver);
    const issued = enumerate_livemap_issued_quids(a.identityEpoch().issued());
    const local = lookup_document_quad_internal(receiver.doc.must('page'), 'subject0').quid;
    const operation = selector => ({ domain: 'css', kind: 'rule', ruleKey: 'unverified', scopes: [],
      rule: { ruleKey: 'unverified', selector, scopes: [], declarations: [['color', 'red']] } });
    for (const selector of [`[hson\\:quid="${local}"]`, `[hson\\:quid="${ownerQuid}"]`, '[hson\\:quad="_123456789"]']) {
      const native = root.outerHTML, before = JSON.stringify(receiver.capture()), revision = c.echo.sync.appliedRev;
      const result = await c.echo.action('document.css', { library: 'page', operation: operation(selector) });
      assert(result.type === 'error', 'Missing correspondence rejects at real HTTP boundary');
      assert(root.outerHTML === native && JSON.stringify(receiver.capture()) === before, 'Rejected CSS leaves graph, CSS and native realization unchanged');
      assert(c.echo.sync.appliedRev === revision, 'Rejected CSS advances no revision');
    }
    for (const count of [19, 65]) {
      const css = Object.fromEntries(Array.from({ length: count }, (_, index) => [`@:subject${index}`, { '--cardinality': String(count) }]));
      const revision = c.echo.sync.appliedRev;
      await c.tree.async.css.global.sel('.cardinality').setMany(css);
      assert(c.echo.sync.appliedRev === revision + 1, 'Each subject batch has one governed transition');
      for (let index = 0; index < count; index++) {
        const element = frame.contentDocument.querySelector(`#subject${index}`);
        assert(frame.contentWindow.getComputedStyle(element).getPropertyValue('--cardinality').trim() === String(count), 'Authoritative correspondence realizes on every browser subject');
      }
    }
    assert(JSON.stringify(enumerate_livemap_issued_quids(a.identityEpoch().issued())) === JSON.stringify(issued), 'Correspondence creates no receiving identity issuance');
    return { rejected: 3, subjects: [19, 65], transitions: 2 };
  } finally { c?.dispose(); c?.echo.dispose(); transport.dispose(); frame.remove(); }
}
