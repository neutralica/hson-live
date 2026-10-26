import { hsonLiveMap, continue_hosted_document } from '../../src/index.ts';
import { echo_map_internal } from '../../src/internal/governor-maps.ts';
import { internal_livemap_aggregate_authority } from '../../src/api/livemap/livemap.internal.ts';

export async function hostedCssQueueRevocation({ session, endpoint, url }) {
  const assert = (value, message) => { if (!value) throw Error(message); };
  const frame = document.createElement('iframe');
  const loaded = new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = reject; });
  frame.src = url; document.body.append(frame); await loaded;
  const transport = hsonLiveMap.echo.transport.http({ endpoint });
  let dispatches = 0, preparations = 0;
  const observed = { ...transport, operations: { submit(request, options) {
    if (request.type === 'action') dispatches++;
    return transport.operations.submit(request, options);
  } } };
  let c;
  try {
    const root = frame.contentDocument.documentElement;
    c = await continue_hosted_document({ now: session.cut, credential: session.credential, transport: observed, root });
    const css = c.tree.async.css.global, retained = css.sel('.revoked-browser');
    const writes = Promise.allSettled(Array.from({ length: 4 }, () => css.edit(handle => {
      preparations++; handle.sel('.revoked-browser').setMany({ color: 'red', _hover: { color: 'blue' } });
    })));
    c.dispose();
    const native = root.outerHTML, revision = c.map.rev, snapshot = c.map.css.snapshot();
    const authority = internal_livemap_aggregate_authority(echo_map_internal(c.echo)), ledger = authority.identityEpoch().issued();
    assert((await writes).every(result => result.status === 'rejected'), 'Every revoked queued browser write rejects');
    assert(preparations === 0 && dispatches === 0, 'Revocation fences preparation and Echo dispatch');
    let rejected = false; try { await retained.setMany({ color: 'purple' }); } catch { rejected = true; }
    assert(rejected && dispatches === 0, 'Retained browser handle cannot resume authoring');
    assert(c.map.rev === revision && c.map.css.snapshot() === snapshot, 'Revoked work publishes no CSS or revision');
    assert(authority.identityEpoch().issued() === ledger, 'Revoked work installs no identity issuance');
    assert(root.outerHTML === native, 'Revoked work leaves native realization unchanged after disposal');
    return { rejected: 4, preparations, dispatches, revision };
  } finally { c?.dispose(); c?.echo.dispose(); transport.dispose(); frame.remove(); }
}
