import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../../src/index.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { make_portable_aggregate_snapshot } from "../../src/api/livemap/livemap.hosted.ts";
import { compose_client_portable_aggregate_internal as compose } from "../../src/api/echo/echo.projection.ts";
import { admit_locus_local_initializers, install_client_local_initializers_internal as install,
  make_locus_application_catalog } from "../../src/api/locus/locus.local-initializer.ts";
import { sha256_sync } from "../../src/core/sha256-sync.ts";
import { parse_document_stylesheet } from "../../src/internal/css/parse-document-stylesheet.ts";
import { local_initializers } from "../helpers/client-projection.mts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import type { LocusLocalInitializer } from "../../src/types/locus.projection.types.ts";
import type { LiveMap } from "../../src/types/livemap.types.ts";

function with_css(seed: LocusLocalInitializer, source: string): LocusLocalInitializer {
  const { fingerprint: _fingerprint, ...base } = { ...seed, css: parse_document_stylesheet(source, []) };
  const { schema: _schema, ...contract } = base;
  return { ...base, fingerprint: sha256_sync(JSON.stringify({ format: "hson-local-initializer", ...contract })) };
}

/** The first three matching encodes admit/canonicalize the seed. The fourth
 * bounds its later root decoding, after contract preparation; the sixth bounds
 * topology serialization after the aggregate candidate has captured its base.
 */
function during_root_encode(seed: LocusLocalInitializer, occurrence: number, reenter: () => void, run: () => void) {
  const encode = TextEncoder.prototype.encode;
  let matches = 0, entered = false;
  TextEncoder.prototype.encode = function(this: TextEncoder, input?: string) {
    if (input === seed.root.payload && ++matches === occurrence) { entered = true; reenter(); }
    return encode.call(this, input);
  };
  try { run(); } finally { TextEncoder.prototype.encode = encode; }
  assert.equal(entered, true, "the original root-processing reentrancy seam must execute");
}

function assert_installed_seeds(client: LiveMap, seeds: readonly LocusLocalInitializer[]) {
  const before = client.capture();
  for (const seed of seeds) {
    assert.deepEqual(before.libraries.find(entry => entry.name === seed.name)?.css, seed.css);
  }
  assert.doesNotThrow(() => install(client, seeds), "each accepted seed must remain idempotently reinstallable");
  assert.deepEqual(client.capture(), before);
}

function observe_seeds(client: LiveMap, seeds: readonly LocusLocalInitializer[]) {
  const revisions: number[] = [], positions: number[] = [], errors: unknown[] = [];
  const stop = client.commits.observe(() => {
    revisions.push(client.rev);
    try {
      const names = new Set(owner(client).hostedRegistry().libraries.map(entry => entry.name));
      assert_installed_seeds(client, seeds.filter(seed => names.has(seed.name)));
    } catch (cause) { errors.push(cause); }
  });
  const stopPosition = owner(client).observeAuthorityPosition(rev => positions.push(rev));
  return { revisions, positions, errors, stop() { stop(); stopPosition(); } };
}

export function local_initializer_css_cases(check: (name: string, run: () => void) => void) {
  check("invalid local initializer subject CSS rejects before any publication and permits a different valid retry", () => {
    const snapshot = make_portable_aggregate_snapshot(owner(hsonLiveMap.create()).captureHosted());
    for (const [selector, reason] of [
      ['[hson\\:quid="123456789"]', /Unsupported or mixed CSS identity attribute selector/],
      ['[hson\\:quad="_123456789"]', /Portable CSS requires a corresponding ordinary Library subject/],
    ] as const) {
      const client = compose(snapshot, local_initializers({ ui: { data: { value: 0 } }, existing: { document: "<main/>" } }));
      const aggregate = owner(client), existing = client.lib("existing");
      if (existing.mode !== "document") throw Error("document");
      const library = aggregate.libraries()[1];
      assert.equal(aggregate.hostedRegistry().libraries[1]?.name, "existing");
      assert.ok(library);
      aggregate.acquireLocalDocumentIdentity(library, validate_document_path([0]), "987654321");
      existing.css.stylesheet('[hson\\:quid="987654321"]{color:green}');
      const before = client.capture(), registry = aggregate.hostedRegistry(), ids = aggregate.libraries();
      const ledger = aggregate.identityEpoch().issued(), position = aggregate.hostedPosition();
      let commits = 0, positions = 0;
      const stop = client.commits.observe(() => commits++), stopPosition = aggregate.observeAuthorityPosition(() => positions++);
      try {
        const valid = local_initializers({ panel: { document: "<aside/>" } })[0]!;
        const invalid = with_css(valid, `${selector}{color:red}`);
        assert.throws(() => admit_locus_local_initializers([invalid]), reason);
        assert.throws(() => compose(snapshot, [invalid]), reason);
        assert.throws(() => make_locus_application_catalog(hsonLiveMap.create(), [{ name: "panel", ownership: "local",
          initializer: { document: "<aside/>" }, css: invalid.css }]), reason);
        const sibling = local_initializers({ alpha: { document: "<main/>" } })[0]!;
        assert.throws(() => install(client, [sibling, invalid]), reason);
        assert.equal(commits, 0); assert.equal(positions, 0);
        assert.deepEqual(client.capture(), before); assert.equal(client.rev, before.revision);
        assert.equal(aggregate.hostedRegistry(), registry); assert.deepEqual(aggregate.libraries(), ids);
        assert.equal(aggregate.identityEpoch().issued(), ledger); assert.deepEqual(aggregate.hostedPosition(), position);
        assert.throws(() => client.lib("panel")); assert.throws(() => client.lib("alpha"));
        // A rejected document seed must not retain even a mode contract.
        const retry = local_initializers({ panel: { data: { accepted: true } } });
        install(client, retry); assert.equal(client.lib("panel").mode, "data-object");
        assert.equal(commits, 1); assert.equal(positions, 1); assert.equal(client.rev, before.revision + 1);
        install(client, retry); assert.equal(commits, 1);
      } finally { stop(); stopPosition(); }
    }
  });
  check("identity-free local CSS and seed contract are complete at the first observer and initial composition", () => {
    const snapshot = make_portable_aggregate_snapshot(owner(hsonLiveMap.create()).captureHosted());
    const seed = with_css(local_initializers({ panel: { document: "<aside/>" } })[0]!,
      '::part(hson\\:quid){color:red}.hson\\:quid{color:red}:future(foo){color:blue}');
    const client = compose(snapshot, local_initializers({ ui: { data: {} } })), aggregate = owner(client);
    const ledger = aggregate.identityEpoch().issued(), before = client.rev;
    const observed: string[] = [], errors: unknown[] = [];
    const stop = client.commits.observe(() => {
      try {
        const panel = client.lib("panel"); if (panel.mode !== "document") throw Error("document");
        observed.push(panel.css.snapshot()); install(client, [seed]);
      } catch (cause) { errors.push(cause); }
    });
    try { install(client, [seed]); } finally { stop(); }
    assert.deepEqual(errors, []); assert.equal(observed.length, 1); assert.match(observed[0]!, /::part\(hson/);
    assert.equal(client.rev, before + 1); assert.equal(aggregate.identityEpoch().issued().size, ledger.size);
    const fresh = compose(snapshot, [seed]); assert.equal(fresh.rev, 0);
    const panel = fresh.lib("panel"); if (panel.mode !== "document") throw Error("document");
    assert.equal(panel.css.snapshot(), observed[0]);
    panel.document.attrs.set({ kind: "path", path: [0] }, "title", "retained");
    install(fresh, [seed]); assert.equal(panel.document.attrs.get({ kind: "path", path: [0] }, "title"), "retained");
    assert.equal(panel.css.snapshot(), observed[0]);
  });
  check("outer root decoding retains one or several independently accepted inner seed contracts and CSS at every observer", () => {
    const snapshot = make_portable_aggregate_snapshot(owner(hsonLiveMap.create()).captureHosted());
    for (const count of [1, 2]) {
      const client = compose(snapshot, local_initializers({ ui: { data: {} } }));
      const outer = with_css(local_initializers({ outer: { document: '<aside "outer-root"/>' } })[0]!, 'aside{color:red}');
      const inners = [with_css(local_initializers({ inner: { document: '<article "inner-root"/>' } })[0]!, 'article{color:blue}'),
        with_css(local_initializers({ another: { document: '<main "another-root"/>' } })[0]!, 'main{color:green}')].slice(0, count);
      const seeds = [...inners, outer], observed = observe_seeds(client, seeds);
      try {
        during_root_encode(outer, 4, () => {
          assert.equal(client.rev, 0); assert.throws(() => client.lib("outer"), /Unknown LiveMap Library/);
          for (const inner of inners) install(client, [inner]);
          assert.equal(client.rev, count); assert_installed_seeds(client, inners);
        }, () => install(client, [outer]));
        assert_installed_seeds(client, seeds);
        assert.deepEqual(observed.errors, []);
        const expected = Array.from({ length: count + 1 }, (_, index) => index + 1);
        assert.deepEqual(observed.revisions, expected); assert.deepEqual(observed.positions, expected);
        assert.equal(client.rev, count + 1);
        assert.equal(owner(client).identityEpoch().issued().size, 0);
        assert.deepEqual(client.capture().libraries.map(entry => entry.name), ["ui", ...inners.map(seed => seed.name), "outer"]);
      } finally { observed.stop(); }
    }
  });
  check("reentrant name collision rejects the outer seed without adopting or overwriting the accepted inner incarnation", () => {
    const snapshot = make_portable_aggregate_snapshot(owner(hsonLiveMap.create()).captureHosted());
    const client = compose(snapshot, local_initializers({ ui: { data: {} } })), aggregate = owner(client);
    const outer = with_css(local_initializers({ outer: { document: '<aside "outer-collision"/>' } })[0]!, 'aside{color:red}');
    const collision = with_css(local_initializers({ outer: { document: '<article/>',
      schema: Hson.schema`<type "document" tag "article" content "empty">` } })[0]!, 'article{color:blue}');
    const inner = with_css(local_initializers({ inner: { document: '<main/>' } })[0]!, 'main{color:green}');
    const accepted = [inner, collision], observed = observe_seeds(client, accepted);
    let afterInner = client.capture(), registry = aggregate.hostedRegistry(), ledger = aggregate.identityEpoch().issued();
    let identities = aggregate.libraries();
    try {
      during_root_encode(outer, 4, () => {
        for (const seed of accepted) install(client, [seed]);
        afterInner = client.capture(); registry = aggregate.hostedRegistry(); ledger = aggregate.identityEpoch().issued();
        identities = aggregate.libraries();
      }, () => assert.throws(() => install(client, [outer]), /^Error: LiveMap Library name "outer" is duplicated\.$/));
      assert.deepEqual(client.capture(), afterInner); assert.equal(aggregate.hostedRegistry(), registry);
      assert.equal(aggregate.identityEpoch().issued(), ledger); assert.deepEqual(aggregate.libraries(), identities);
      assert_installed_seeds(client, accepted);
      assert.throws(() => install(client, [outer]), /^Error: Existing local Library "outer" is incompatible with its authorized initializer\.$/);
      assert.deepEqual(observed.errors, []); assert.deepEqual(observed.revisions, [1, 2]); assert.deepEqual(observed.positions, [1, 2]);
      assert.equal(client.rev, 2); assert.deepEqual(client.capture(), afterInner);
    } finally { observed.stop(); }
  });
  check("reentrant authority revision change rejects the outer candidate while preserving inner state and leaving no outer contract", () => {
    const snapshot = make_portable_aggregate_snapshot(owner(hsonLiveMap.create()).captureHosted());
    const client = compose(snapshot, local_initializers({ ui: { data: {} } })), aggregate = owner(client);
    const outer = with_css(local_initializers({ outer: { document: '<aside "late-outer"/>' } })[0]!, 'aside{color:red}');
    const inner = with_css(local_initializers({ inner: { document: '<main/>' } })[0]!, 'main{color:blue}');
    const observed = observe_seeds(client, [inner]);
    let afterInner = client.capture(), registry = aggregate.hostedRegistry(), ledger = aggregate.identityEpoch().issued();
    let identities = aggregate.libraries();
    try {
      during_root_encode(outer, 6, () => {
        install(client, [inner]); afterInner = client.capture(); registry = aggregate.hostedRegistry();
        ledger = aggregate.identityEpoch().issued(); identities = aggregate.libraries();
      }, () => assert.throws(() => install(client, [outer]), (error: unknown) => error instanceof Error
        && "code" in error && error.code === "LIVEMAP_TRANSITION_INVALID"
        && error.message === "Prepared LiveMap authority transition revisions are invalid."));
      assert.deepEqual(client.capture(), afterInner); assert.equal(aggregate.hostedRegistry(), registry);
      assert.equal(aggregate.identityEpoch().issued(), ledger); assert.deepEqual(aggregate.libraries(), identities);
      assert.throws(() => client.lib("outer"), /Unknown LiveMap Library/);
      assert_installed_seeds(client, [inner]);
      assert.deepEqual(observed.errors, []); assert.deepEqual(observed.revisions, [1]); assert.deepEqual(observed.positions, [1]);
      // A different mode can claim the still-absent name: no rejected document
      // seed contract leaked out of the failed outer candidate.
      const retry = local_initializers({ outer: { data: { accepted: true } } });
      install(client, retry); assert.equal(client.lib("outer").mode, "data-object");
      assert_installed_seeds(client, [inner, ...retry]);
      assert.deepEqual(observed.errors, []); assert.deepEqual(observed.revisions, [1, 2]); assert.deepEqual(observed.positions, [1, 2]);
      assert.equal(client.rev, 2);
    } finally { observed.stop(); }
  });
}
