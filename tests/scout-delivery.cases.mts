import { create_test_event_emitter } from "./test-events.mjs";
import { bind_locus_http } from "../src/api/locus/locus.http.js";
import { create_echo_http_transport } from "../src/api/echo/echo.http.js";
import { locus_map_internal } from "../src/internal/governor-maps.js";
import { livemap_identity_epoch_accounting } from "../src/api/livemap/livemap.identity-epoch.js";
import assert from 'node:assert/strict';
import { hsonLiveMap } from '../src/api/livemap/index.js';
import { deliver_scout } from '../src/api/ssr/index.js';
import { decode_ignition, encode_ignition, MAX_IGNITION_BYTES } from '../src/api/scout/scout.ignition.js';

export async function scout_delivery_cases(): Promise<void> {
  const events = create_test_event_emitter("continuation.scout-delivery");
  events.case_begin("delivery-contract", "Capture, privacy, Parts and ignition contract");
  const timers = new Set<() => void>();
  const locus = hsonLiveMap.locus.create({
    page: { document: '<html <head/> <body <main <p "Original"/>/>/>/>', access: 'shared' },
    secrets: { data: { password: 'private-data-sentinel' }, access: 'private' },
    ui: { parts: { scout: { kind: 'document', document: '<hson-scout hson:part hidden "%{payload}"/>' },
      nested: { kind: 'document', document: '<hson-scout hson:part hidden <hson-part lib="ui" at="text" payload="%{payload}"/>/>' },
      text: { kind: 'document', document: '<span hson:part "%{payload}"/>' },
      css: { kind: 'document', document: '<hson-scout hson:part hidden "%{payload}"/>', stylesheet: '' },
      identity: { kind: 'document', document: '<hson-scout hson:part hidden @:identity "%{payload}"/>' },
      malformed: { kind: 'document', document: '<p hson:part "%{payload}"/>' },
    }, access: 'private' },
  }, { authorizeProjection: () => ({ libraries: ["page"] }), sessions: { schedule: (delay, callback) => { assert.equal(delay, 30_000); timers.add(callback); return () => { timers.delete(callback); }; } } });
  try {
    const session = await locus.session.create({ libraries: ['page'] });
    const now = session.now({ html: 'page' });
    const map = locus_map_internal(locus);
    const identities = [map.doc.page, map.parts.ui].map(owner => livemap_identity_epoch_accounting(owner));
    const before = JSON.stringify(locus.cut()), rev = locus.rev, capture = JSON.stringify(now);
    const response = deliver_scout(session, now, locus.parts.ui.scout, { endpoint: '/_hson', module: '/scout-auto.js' });
    const html = await response.text();
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(html, /<\/body><hson-scout hidden="(?:hidden)?">[A-Za-z0-9_-]+<\/hson-scout><script type="module" src="\/scout-auto.js" data-hson-scout-loader="1"><\/script><\/html>$/);
    const payload = html.match(/<hson-scout hidden="(?:hidden)?">([^<]+)/)![1];
    const decoded = decode_ignition(payload);
    assert.equal(decoded.document, 'page');
    assert.equal(decoded.credential, session.credential);
    assert.deepEqual(decoded.now.libs.libraries.map(entry => entry.name), ['page']);
    assert.doesNotMatch(JSON.stringify(decoded.now), /private-data-sentinel|hson:part/);
    assert.equal(JSON.stringify(now), capture);
    assert.equal(locus.rev, rev);
    assert.deepEqual([map.doc.page, map.parts.ui].map(owner => livemap_identity_epoch_accounting(owner)), identities);
    assert.equal(JSON.stringify(locus.cut()), before);
    assert.equal(timers.size, 1);
    for (const expire of [...timers]) expire();
    assert.equal(locus.session.debug().activeSessionCount, 0);
    timers.clear();
    for (const member of ['css', 'identity', 'malformed', 'nested']) {
      const invalid = await locus.session.create({ libraries: ['page'] });
      assert.throws(() => deliver_scout(invalid, invalid.now({ html: 'page' }), locus.parts.ui.at([member]), { endpoint: '/_hson', module: '/scout-auto.js' }));
      assert.equal(locus.session.debug().activeSessionCount, 0);
    }
    const fresh = await locus.session.create({ libraries: ['page'] });
    const original = fresh.now({ html: 'page' });
    assert.throws(() => deliver_scout(fresh, { ...original }, locus.parts.ui.scout, { endpoint: '/_hson', module: '/scout-auto.js' }));
    for (const endpoint of ['https://evil.test/x', '//evil.test/x', '/a/../b', '/a//b', '/%2fabc', '/x?q=1', '/x#y', '/x\\y', '/x\ny', '/user@host']) {
      assert.throws(() => encode_ignition(original, 'page', fresh.credential!, endpoint));
    }
    assert.throws(() => encode_ignition(original, 'secrets', fresh.credential!, '/_hson'));
    assert.throws(() => encode_ignition(original, 'page', 'short', '/_hson'));
    for (const payload of ['', 'A', 'AA=', '!!!', 'A'.repeat(MAX_IGNITION_BYTES + 1)]) assert.throws(() => decode_ignition(payload));
    const valid = encode_ignition(original, 'page', fresh.credential!, '/_hson');
    const raw = Buffer.from(valid, 'base64url').toString();
    for (const json of [raw.replace('"version":1', '"version":2'), raw.replace('"version":1', '"version":1,"version":1'), raw.replace('"version":1', '"extra":0,"version":1')]) {
      assert.throws(() => decode_ignition(Buffer.from(json).toString('base64url')));
    }
    const other = await locus.session.create({ libraries: ['page'] });
    assert.throws(() => deliver_scout(other, original, locus.parts.ui.scout, { endpoint: '/_hson', module: '/scout-auto.js' }));
    fresh.revoke(); other.revoke();
    const capturedSession = await locus.session.create({ libraries: ['page'] });
    const old = capturedSession.now({ html: 'page' });
    await locus.stage(w => w.doc.page.at([]).asElement().attrs.set('title', 'after-capture'));
    const delivered = await deliver_scout(capturedSession, old, locus.parts.ui.scout, {endpoint:'/_hson',module:'/scout-auto.js'}).text();
    const oldPayload = delivered.match(/<hson-scout hidden="(?:hidden)?">([^<]+)/)![1];
    assert.deepEqual(decode_ignition(oldPayload).now.libs, old.libs);
    assert.ok(delivered.startsWith(old.html.slice(0,-7)));
    capturedSession.revoke();
    const attached = await locus.session.create({ libraries: ['page'] });
    deliver_scout(attached, attached.now({ html: 'page' }), locus.parts.ui.scout, { endpoint: '/_hson', module: '/scout-auto.js' });
    assert.equal(timers.size, 1);
    const binding = bind_locus_http(locus, { endpoint: '/_hson' });
    const transport = create_echo_http_transport({ endpoint: 'http://localhost/_hson',
      fetch: (input, init) => binding.handle(new Request(input, init), {}) });
    try {
      const admission = await transport.operations.submit({ type: 'session-attach', id: 'scout-attachment', credential: attached.credential });
      assert.equal(admission.kind, 'response');
      assert.equal(timers.size, 0, 'First genuine attachment cancels the initial deadline');
    } finally { transport.dispose(); binding.dispose(); attached.revoke(); }
    const disposal = await locus.session.create({ libraries: ['page'] });
    deliver_scout(disposal, disposal.now({ html: 'page' }), locus.parts.ui.scout, { endpoint: '/_hson', module: '/scout-auto.js' });
    assert.equal(timers.size, 1);
    locus.dispose();
    assert.equal(timers.size, 0, 'Authority disposal cancels pending initial-attachment ownership');
    for (const [name, size] of [['large', 300_000], ['oversize', 2_000_000]] as const) {
      const large = hsonLiveMap.locus.create({ page: { document: `<html <head/> <body <p "${'x'.repeat(size)}"/>/>/>`, access: 'shared' },
        ui: { parts: { scout: { kind: 'document', document: '<hson-scout hson:part hidden "%{payload}"/>' } }, access: 'private' } },
        { authorizeProjection: () => ({ libraries: ['page'] }) });
      try {
        const session = await large.session.create({ libraries: ['page'] }), now = session.now({ html: 'page' });
        const deliver = () => deliver_scout(session, now, large.parts.ui.scout, { endpoint: '/_hson', module: '/scout-auto.js' });
        if (name === 'oversize') assert.throws(deliver);
        else { const html = await deliver().text(); const payload = html.match(/<hson-scout hidden="hidden">([^<]+)/)![1];
          assert.equal(decode_ignition(payload).now.libs.revision, now.libs.revision); assert.ok(html.includes('x'.repeat(size))); }
      } finally { large.dispose(); }
    }
    events.case_end("delivery-contract", "pass");
    events.case_begin("lease-regressions", "Stale callbacks, disposal and scheduler failure");
    await lease_regressions();
    events.case_end("lease-regressions", "pass");
    events.terminal("pass");
    console.log('Scout delivery: capture, privacy, detached Parts, strict ignition, limits and abandoned-session checks passed.');
  } finally { locus.dispose(); }
}


async function lease_regressions(): Promise<void> {
  for (const scenario of ["attached", "disposed", "revoked", "expired", "throwing"] as const) {
    let callback: (() => void) | undefined;
    let cancelled = 0;
    const authority = hsonLiveMap.locus.create({
      page: { document: '<html <head/> <body/>/>', access: 'shared' },
      ui: { parts: { scout: { kind: 'document', document: '<hson-scout hson:part hidden "%{payload}"/>' } }, access: 'private' },
    }, { authorizeProjection: () => ({ libraries: ['page'] }), sessions: { schedule(_delay, expire) {
      if (scenario === 'throwing') throw new Error('scheduler sentinel');
      callback = expire; return () => { cancelled++; expire(); };
    } } });
    let binding: ReturnType<typeof bind_locus_http> | undefined;
    let transport: ReturnType<typeof create_echo_http_transport> | undefined;
    try {
      const session = await authority.session.create({ libraries: ['page'] });
      const now = session.now({ html: 'page' });
      const deliver = () => deliver_scout(session, now, authority.parts.ui.scout, { endpoint: '/_hson', module: '/scout-auto.js' });
      if (scenario === 'throwing') {
        assert.throws(deliver, /scheduler sentinel/);
        assert.equal(authority.session.debug().activeSessionCount, 0);
        assert.throws(deliver);
        continue;
      }
      deliver();
      if (scenario === 'attached') {
        binding = bind_locus_http(authority, { endpoint: '/_hson' });
        for (const id of ['first', 'later']) {
          transport?.dispose();
        transport = create_echo_http_transport({ endpoint: 'http://localhost/_hson', fetch: (input, init) => binding!.handle(new Request(input, init), {}) });

          const result = await transport.operations.submit({ type: 'session-attach', id, credential: session.credential });
          assert.equal(result.kind, 'response');
          callback!();
          assert.equal(authority.session.debug().activeSessionCount, 1);
        }
        assert.throws(deliver, /only one/);
        assert.equal(authority.session.debug().activeSessionCount, 1);
      } else {
        if (scenario === 'disposed') authority.dispose();
        if (scenario === 'revoked') session.revoke();
        callback!(); callback!();
        assert.equal(authority.session.debug().activeSessionCount, 0);
      }
      assert.equal(cancelled, 1);
    } finally { transport?.dispose(); binding?.dispose(); authority.dispose(); }
  }
  for (const href of ['https://foreign.invalid/', '//foreign.invalid/', 'https://same-origin-unknown.test/']) {
    const authority = hsonLiveMap.locus.create({page:{document:`<html <head <base href="${href}"/>/> <body/>/>`,access:'shared'},ui:{parts:{scout:{kind:'document',document:'<hson-scout hson:part hidden "%{payload}"/>'}},access:'private'}},{authorizeProjection:()=>({libraries:['page']})});
    try { const session = await authority.session.create({libraries:['page']});
      assert.throws(()=>deliver_scout(session,session.now({html:'page'}),authority.parts.ui.scout,{endpoint:'/_hson',module:'/scout-auto.js'}), /relative base/);
      assert.equal(authority.session.debug().activeSessionCount,0);
    } finally { authority.dispose(); }
  }
}
