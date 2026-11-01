import assert from "node:assert/strict";
import { hsonLiveMap } from "../../src/index.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { capture_document_scoped_library as capture, decode_document_scoped_library,
  normalize_document_scoped_library_subjects as normalize, document_scoped_libraries_semantically_equal as equal,
  type PortableDocumentScopedLibrary } from "../../src/api/livemap/livemap.document.scoped-portable.ts";
import { encode_document_scoped_effects, portable_document_scoped_effect, prepare_document_scoped_css_operation } from "../../src/api/livemap/livemap.document.scoped-effects.ts";
import { DOCUMENT_SCOPED_QUAD_LIMITS, scoped_disposable_subject_label } from "../../src/api/livemap/livemap.document.scoped-quad-codec.ts";
import { is_persisted_quid } from "../../src/core/hson-node-quid.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import type { PreparedDocumentScopedLibrary } from "../../src/api/livemap/livemap.document.scoped-library.ts";
import type { LiveMapDocumentPart } from "../../src/types/livemap.types.ts";

function fixture(count: number, authored = true) {
  const parts = Object.fromEntries(Array.from({ length: 4 }, (_, i): [string, LiveMapDocumentPart] => [`p${i}`, {
    kind: "document", document: '<section hson:part @:root '
      + (i < 3 ? `<hson-part at="p${i + 1}"/>` : '') + '/>', stylesheet: ':scope{color:red}',
  }]));
  const document = '<main ' + (authored ? '@:_00000000j ' : '')
    + Array.from({ length: Math.floor(count / 4) }, () => '<hson-part lib="parts" at="p0"/>').join(' ')
    + (count % 4 ? ` <hson-part lib="parts" at="p${4 - count % 4}"/>` : '') + '/>';
  const map = hsonLiveMap.fromLibraries({ parts: { parts }, page: { document: '<main/>' } });
  const a = authority(map), owner = a.libraries()[1]!, parsed = parse_authored_document_library(document);
  const before = a.prepareScopedDocument(owner, { root: parsed.root, quads: parsed.declarations });
  return { map, a, owner, before };
}
function receiver(input: PortableDocumentScopedLibrary) {
  const map = hsonLiveMap.fromLibraries({ page: { document: '<aside/>' } });
  const a = authority(map), owner = a.libraries()[0]!;
  return { map, a, owner, before: a.prepareScopedDocumentRestoration(owner, input) };
}
function unchanged(f: ReturnType<typeof receiver>, run: () => void) {
  const graph = f.a.root(f.owner), css = f.a.stylesheet(f.owner), scopes = f.a.documentScopes(f.owner);
  const overlay = f.a.documentOverlay(f.owner), checkpoint = f.a.captureSemanticCheckpoint();
  const revision = f.map.rev, ledger = f.a.identityEpoch().issued(), epoch = f.a.identityEpoch().current();
  let commits = 0; const off = f.map.commits.observe(() => commits++);
  try { run(); } finally { off(); }
  assert.equal(f.a.root(f.owner), graph); assert.equal(f.a.stylesheet(f.owner), css);
  assert.equal(f.a.documentScopes(f.owner), scopes); assert.equal(f.a.documentOverlay(f.owner), overlay);
  assert.deepEqual(f.a.captureSemanticCheckpoint(), checkpoint); assert.equal(f.map.rev, revision);
  assert.equal(f.a.identityEpoch().issued(), ledger); assert.equal(f.a.identityEpoch().current(), epoch);
  assert.equal(commits, 0);
}
function cssEffect(before: PreparedDocumentScopedLibrary, ordinal = 0) {
  // One carrier demands the whole population, exercising portable effect encoding too.
  const selector = before.scopes.occurrences.map(s => `[hson\\:quid="${s.rootQuid}"]`).join(',');
  return prepare_document_scoped_css_operation(before, { domain: "css", kind: "rule", ruleKey: "dense", scopes: [],
    rule: { ruleKey: "dense", selector, scopes: [], declarations: [["opacity", ".5"]] } }, ordinal);
}
const main = { kind: "path" as const, path: path([0, 0, 1, 0, 0, 0]) };
function validLabels(value: PortableDocumentScopedLibrary, count: number) {
  assert.equal(value.scopes.subjects.length, count);
  assert.equal(new Set(value.scopes.subjects.map(s => s.name)).size, count);
  for (const s of value.scopes.subjects) {
    assert.equal(s.disposition, "disposable"); assert.equal(s.name[0], "_"); assert.ok(is_persisted_quid(s.name.slice(1)));
  }
  decode_document_scoped_library(value);
}

export function scoped_label_cases(check: (name: string, run: () => void) => void) {
  check("scoped ordinal encoding rejects unsupported runtime inputs before encoding", () => {
    const coercible = { valueOf() { assert.fail("ordinal input must not be coerced"); } };
    for (const value of [-1, -32, -65536, 65536, Number.MAX_SAFE_INTEGER, -0.5, 0.5, 31.5,
      NaN, Infinity, -Infinity, undefined, null, false, true, "0", "31", "", 0n, Symbol("ordinal"), [], {}, coercible]) {
      assert.throws(() => Reflect.apply(scoped_disposable_subject_label, undefined, [value]), {
        name: "TypeError", message: "Invalid scoped QUAD record: subject ordinal must be an integer from 0 through 65535.",
      });
    }
  });
  check("scoped ordinal encoding is canonical and injective throughout the allowed subject population", () => {
    const labels = new Set<string>();
    for (let index = 0; index < DOCUMENT_SCOPED_QUAD_LIMITS.subjects; index++) {
      const label = scoped_disposable_subject_label(index);
      assert.ok(is_persisted_quid(label.slice(1))); labels.add(label);
      if (index < 18) assert.equal(label, `_${index.toString(36).padStart(9, "0")}`);
    }
    assert.equal(labels.size, DOCUMENT_SCOPED_QUAD_LIMITS.subjects);
    for (const [index, expected] of [[0, '_000000000'], [1, '_000000001'], [18, '_00000000j'], [31, '_00000000z'], [32, '_000000010'],
      [1023, '_0000000zz'], [1024, '_000000100'], [32768, '_000001000'], [65534, '_000001zzy'], [65535, '_000001zzz']] as const) {
      assert.equal(scoped_disposable_subject_label(index), expected);
    }
  });
  for (const count of [17, 18, 19, 20, 31, 32, 33, 36, 37, 128]) {
    check(`${count} nested repeated scoped subjects compose, normalize, capture and replay CSS`, () => {
      const f = fixture(count), before = f.before, original = capture(before), normalized = normalize(original);
      validLabels(original, count); validLabels(normalized, count);
      assert.equal(before.scopes.occurrences.length, count);
      assert.equal(new Set(before.scopes.occurrences.map(s => s.rootQuid)).size, count);
      assert.equal(new Set(before.scopes.occurrences.map(s => s.lifetime)).size, count);
      assert.equal(before.scopes.occurrences.filter(s => s.parent === null).length, Math.ceil(count / 4));
      assert.deepEqual(normalized.scopes.document, original.scopes.document);
      assert.deepEqual(normalized.scopes.occurrences, original.scopes.occurrences);
      assert.equal(normalized.scopes.document[0]!.name, '_00000000j');
      if (count >= 19) assert.equal(normalized.scopes.subjects[18]!.name, '_00000000j', "authored and disposable namespaces are independent");
      assert.deepEqual(normalize(normalized), normalized);
      const r = receiver(normalized);
      assert.deepEqual(normalize(capture(r.before)), normalized);
      for (const scope of r.before.scopes.occurrences) {
        assert.ok(!before.issued.has(scope.rootQuid));
        assert.ok(!before.scopes.occurrences.some(old => old.lifetime === scope.lifetime));
      }
      for (const subject of normalized.scopes.subjects) assert.equal(r.before.issued.has(subject.name.slice(1)), false);
      assert.throws(() => r.a.captureScopedDocument(before), /another Library/);
      const next = cssEffect(before), effects = next.effects!.map(portable_document_scoped_effect);
      const style = effects[0]!.styles[0]!;
      validLabels({ root: normalized.root, scopes: { ...normalized.scopes, subjects: style.subjects }, css: style.css }, count);
      assert.deepEqual(next.scopes, before.scopes); assert.equal(next.issued, before.issued);
      unchanged(r, () => {
        const replayed = r.a.prepareScopedDocumentEffectReplay(r.before, encode_document_scoped_effects(effects));
        assert.ok(equal(capture(next), capture(replayed)));
        assert.deepEqual(replayed.scopes, r.before.scopes); assert.equal(replayed.issued, r.before.issued);
      });
    });
  }
  check("dense graph replay retires only removed occurrence CSS and retains issued identities", () => {
    const f = fixture(128), r = receiver(capture(f.before));
    const next = f.a.prepareScopedDocumentOperations(f.before, [{ domain: "graph", op: "remove-content", target: main, index: 0 }]);
    const replayed = r.a.prepareScopedDocumentEffectReplay(r.before, f.a.captureScopedDocumentEffects(next));
    assert.ok(equal(capture(next), capture(replayed)));
    assert.equal(next.scopes.occurrences.length, 124); validLabels(normalize(capture(next)), 124);
    const owners = new Set(encode_portable_document_stylesheet(next.stylesheet).order.map(entry => entry.owner));
    assert.equal(owners.size, 124);
    for (const scope of f.before.scopes.occurrences.slice(0, 4)) {
      assert.equal(next.overlay.pathForQuid(scope.rootQuid), undefined);
      assert.ok(next.issued.has(scope.rootQuid)); assert.ok(!owners.has(`[hson\\:quid="${scope.rootQuid}"]`));
    }
    for (const scope of f.before.scopes.occurrences.slice(4)) {
      assert.ok(next.scopes.occurrences.some(s => s.lifetime === scope.lifetime && s.rootQuid === scope.rootQuid));
      assert.ok(owners.has(`[hson\\:quid="${scope.rootQuid}"]`));
    }
  });
  check("existing dense-to-small replay digest bytes remain stable", () => {
    const f = fixture(20, false);
    const next = f.a.prepareScopedDocumentOperations(f.before, [{ domain: "graph", op: "remove-content", target: main, index: 4 }]);
    const effect = next.effects![0]!;
    // Captured from the unchanged implementation before the repair.
    assert.equal(effect.before, '8368ffb953f6b9b9a552b7750a118051290086f4dbd86a54bffc89587ed437aa');
    assert.equal(effect.after, '25de8515ce50dff96261bbc6637411f4a14501baa2ff0ae39a67a4cec1ee4c28');
  });
  for (const invalid of ['_00000000i', '_00000000l', '_00000000o', '_00000000u', '_00000000I', '_0000000', '_0000000000', 'duplicate']) {
    check(`dense restoration and later effect reject ${invalid} atomically before issuance`, () => {
      const f = fixture(20), initial = normalize(capture(f.before)), r = receiver(initial);
      const next = f.a.prepareScopedDocumentOperations(f.before, [{ domain: "graph", op: "insert-content", target: main, index: 0,
        content: { $_tag: "hson-part", $_attrs: { lib: "parts", at: "p0" }, $_content: [] } }]);
      const css = cssEffect(next, 1);
      const effects = structuredClone([...next.effects!, ...css.effects!].map(portable_document_scoped_effect));
      const subjects = effects[1]!.styles[0]!.subjects;
      const bad = structuredClone(initial);
      // Replace records, keeping the production portable types readonly.
      const replaceLabel = (entries: typeof subjects) => entries.map((s, i) => i !== 1 ? s
        : { ...s, name: invalid === 'duplicate' ? entries[0]!.name : invalid });
      const malformedEffects = effects.map((effect, i) => i !== 1 ? effect : { ...effect,
        styles: effect.styles.map(style => ({ ...style, subjects: replaceLabel(style.subjects) })) });
      const malformed = { ...bad, scopes: { ...bad.scopes, subjects: replaceLabel(bad.scopes.subjects) } };
      let allocations = 0;
      allocator(r.a.identityEpoch().owner, () => { allocations++; return 'z00000000'; });
      try { unchanged(r, () => {
        assert.throws(() => r.a.prepareScopedDocumentRestoration(r.owner, malformed), /disposable transport label or duplicate label/);
        assert.throws(() => r.a.prepareScopedDocumentEffectReplay(r.before, encode_document_scoped_effects(malformedEffects)), /disposable transport label or duplicate label/);
      }); } finally { allocator(r.a.identityEpoch().owner, undefined); }
      assert.equal(allocations, 0);
    });
  }
}
