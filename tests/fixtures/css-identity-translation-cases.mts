import assert from "node:assert/strict";
import { generate, ident, parse, walk } from "css-tree/dist/csstree.esm";
import { hsonLiveMap } from "../../src/index.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { make_livemap_from_authored_libraries_internal as authored } from "../../src/api/livemap/livemap.libraries.ts";
import { document_quad_disposition } from "../../src/api/livemap/livemap.document.quad.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { set_livemap_quid_candidate_source_for_tests } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { selector_for_quid } from "../../src/api/livetree/managers/css-render.ts";
import { document_css_subject_identities, document_css_mentions_subject_identity, omit_part_css_subjects, translate_document_css_identities as translate, type CssIdentityCorrespondence } from "../../src/internal/css/css-identity-translation.ts";
import { structured_css_fixture } from "../helpers/structured-css-fixture.mts";
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet, render_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";

const quid = "abcde1234", second = "9abcdefgh", receiving = "xyz987654";
const runtime = selector_for_quid(quid), quad = '[hson\\:quad="_abcde1234"]';
const association = { name: `_${quid}`, quid, disposition: "disposable" as const };
const correspondence = (associations: CssIdentityCorrespondence["associations"] = [association]): CssIdentityCorrespondence => ({ associations, assertCurrent() {} });
const sheet = (source: string) => structured_css_fixture(source, []);
const css = (value: ReturnType<typeof sheet>) => render_portable_document_stylesheet(decode_portable_document_stylesheet(value));
function neutral_selectors(source: string): string {
  const ast = parse(source, { context: "selectorList", onParseError(error) { throw error; } });
  walk(ast, { visit: "AttributeSelector", enter(node) {
    const name = ident.decode(node.name.name);
    if (name === "hson:quid" || name === "hson:quad") {
      node.name.name = "subject"; node.value = { type: "String", value: "subject" };
    }
  } });
  return generate(ast);
}
function identities(source: string): string[] {
  const values: string[] = [];
  walk(parse(source, { context: "selectorList" }), { visit: "AttributeSelector", enter(node) {
    if (ident.decode(node.name.name) === "hson:quad" || ident.decode(node.name.name) === "hson:quid") {
      values.push(node.value?.type === "String" ? node.value.value : node.value ? ident.decode(node.value.name) : "");
    }
  } });
  return values;
}

export function css_identity_translation_cases(check: (name: string, run: () => void) => void): void {
  check("omitted identity attributes retain false matching atoms through selector serialization and portable round trips", () => {
    const absent = new Set(['gone']);
    for (const attribute of [String.raw`[hson\:quad="gone"]`, String.raw`[hson\3a quad=gone]`, String.raw`[hson\:quad="\67 one"]`]) {
      for (const selector of [attribute, `.target:not(${attribute})`, `:is(${attribute},p)`, `:where(:not(${attribute}))`,
        `:has(>${attribute})`, `${attribute},.target:not(${attribute})`, `:not(${attribute}${attribute})`,
        `:nth-child(n of ${attribute},p)`, `:nth-last-child(2n of ${attribute},p)`, `:host(${attribute})`, `::slotted(${attribute})`]) {
        const source = `${selector}{color:red}`, input = sheet(source), before = JSON.stringify(input);
        const result = omit_part_css_subjects(input, absent);
        assert.deepEqual(result, sheet(source.replaceAll(attribute, ':nth-child(0)')));
        assert.equal(JSON.stringify(input), before);
        assert.deepEqual(document_css_subject_identities(result, 'inbound'), []);
        assert.deepEqual(sheet(css(result)), result);
        assert.deepEqual(encode_portable_document_stylesheet(decode_portable_document_stylesheet(result)), result);
      }
    }
    const gone = String.raw`[hson\:quad="gone"]`, kept = String.raw`[hson\:quad="kept"]`;
    const scoped = sheet(`@scope (${gone}) to (${kept}){${gone}{color:red}}`);
    assert.deepEqual(omit_part_css_subjects(scoped, absent), sheet(`@scope (:nth-child(0)) to (${kept}){:nth-child(0){color:red}}`));
    // selector() is a feature test, not a subject demand; leave its syntax intact.
    const feature = sheet(`@supports selector(${gone}){${gone}{color:red}}`);
    assert.deepEqual(omit_part_css_subjects(feature, absent), sheet(`@supports selector(${gone}){:nth-child(0){color:red}}`));
    assert.equal(omit_part_css_subjects(scoped, new Set()), scoped);
    for (const attribute of [String.raw`[hson\:quad]`, String.raw`[hson\:quad~="gone"]`, String.raw`[hson\:quad="gone" i]`, String.raw`[x|hson\:quad="gone"]`]) {
      assert.throws(() => omit_part_css_subjects(sheet(`${attribute}{color:red}`), absent));
    }
  });
  check("CSS correspondence projects disposable names and restores fresh issued subjects without side effects", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main <button/> <aside/>/>' } });
    const aggregate = owner(map), library = aggregate.libraries()[0]!;
    aggregate.acquireLocalDocumentIdentity(library, validate_document_path([0, 0, 0]), quid);
    const assertCurrent = aggregate.captureFence();
    const quads = aggregate.projectDocumentCorrespondence(library, [quid])!;
    const associations = quads.map(entry => ({ name: entry.name,
      quid: aggregate.documentOverlay(library).quidAtPath(entry.path)!, disposition: document_quad_disposition(entry) }));
    const before = map.capture(), overlay = aggregate.documentOverlay(library), ledger = aggregate.identityEpoch().issued();
    const input = sheet(`${runtime}{color:red}`), portable = translate(input, "outbound", { associations, assertCurrent });
    assert.equal(portable.rules[0]!.selector, quad);
    const snapshot = { ...before, libraries: before.libraries.map(entry => ({ ...entry, quads })) };
    const received = hsonLiveMap.fromLibraries({ page: { document: '<main <button/> <aside/>/>' } }), receiver = owner(received);
    set_livemap_quid_candidate_source_for_tests(receiver.identityEpoch().owner, () => receiving);
    let restoration;
    try { restoration = receiver.restorePortableLibrariesWithCorrespondence(snapshot); }
    finally { set_livemap_quid_candidate_source_for_tests(receiver.identityEpoch().owner, undefined); }
    const local = translate(portable, "inbound", restoration);
    assert.equal(local.rules[0]!.selector, selector_for_quid(receiving));
    assert.equal(receiver.identityEpoch().issued().has(receiving), true);
    assert.equal(receiver.identityEpoch().issued().has(quid), false);
    assert.equal(receiver.documentQuad(restoration.associations[0]!.library, quads[0]!.name, undefined), undefined);
    assert.equal(aggregate.documentOverlay(library), overlay); assert.equal(aggregate.identityEpoch().issued(), ledger);
    assert.deepEqual(map.capture(), before); assert.equal(map.rev, 0);
  });
  check("CSS authored correspondence preserves legitimate underscore names and explicit disposition", () => {
    const map = authored({ page: { document: '<main @:_xxxxxxxxx/>' } }), aggregate = owner(map), library = aggregate.libraries()[0]!;
    const subject = aggregate.documentQuad(library, "_xxxxxxxxx", undefined)!;
    const quads = aggregate.projectDocumentCorrespondence(library, [subject.quid])!;
    assert.equal(document_quad_disposition(quads[0]!), "authored");
    const portable = translate(sheet(`${selector_for_quid(subject.quid)}{color:red}`), "outbound",
      { associations: [{ ...subject, disposition: "authored" }], assertCurrent: aggregate.captureFence() });
    assert.equal(portable.rules[0]!.selector, '[hson\\:quad="_xxxxxxxxx"]');
    const snapshot = { ...map.capture(), libraries: map.capture().libraries.map(entry => ({ ...entry, quads })) };
    const receivingMap = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } }), receiver = owner(receivingMap);
    set_livemap_quid_candidate_source_for_tests(receiver.identityEpoch().owner, () => "xxxxxxxxx");
    let restored;
    try { restored = receiver.restorePortableLibrariesWithCorrespondence(snapshot); }
    finally { set_livemap_quid_candidate_source_for_tests(receiver.identityEpoch().owner, undefined); }
    assert.equal(restored.associations[0]!.disposition, "authored");
    assert.equal(translate(portable, "inbound", restored).rules[0]!.selector, selector_for_quid("xxxxxxxxx"));
    assert.ok(receiver.documentQuad(restored.associations[0]!.library, "_xxxxxxxxx", undefined));
    const named = correspondence([{ name: "confirm$", quid, disposition: "authored" }]);
    assert.equal(translate(sheet(`${runtime}{color:red}`), "outbound", named).rules[0]!.selector, '[hson\\:quad="confirm$"]');
  });
  check("CSS selector lists combinators and structured pseudos preserve their specificity structure", () => {
    const other = selector_for_quid(second);
    const mapping = correspondence([association, { name: "other", quid: second, disposition: "authored" }]);
    for (const selector of [
      `${runtime},${other}`, `main ${runtime}>${other}+${runtime}~.tail`,
      `${runtime}:hover::before`, `:is(${runtime},#fixed):where(${other}):not(${runtime}):has(>${other})`,
      `:nth-child(2n + 1 of ${runtime},:is(${other},.x))`, `:nth-last-child(odd of ${runtime})`,
      `:host(${runtime})::slotted(${other})`,
    ]) {
      const input = sheet(`${selector}{color:red}`), result = translate(input, "outbound", mapping);
      assert.equal(neutral_selectors(result.rules[0]!.selector), neutral_selectors(input.rules[0]!.selector));
      assert.equal(identities(result.rules[0]!.selector).includes(quid), false);
      assert.ok(identities(result.rules[0]!.selector).every(value => value === `_${quid}` || value === "other"));
      assert.deepEqual(result.rules[0]!.declarations, input.rules[0]!.declarations);
      assert.equal(result.rules[0]!.ruleKey, input.rules[0]!.ruleKey);
      assert.deepEqual(translate(input, "outbound", mapping), result);
    }
  });
  check("CSS identity identifiers and values use CSSTree escape decoding and generation", () => {
    for (const selector of [
      String.raw`[hson\3a quid="a\62 cde1234"]`, String.raw`[\68 son\:quid=abcde1234]`,
      String.raw`[hson\:quid=a\62 cde1234]`, `[hson\\:quid='${quid}']`,
    ]) assert.equal(translate(sheet(`${selector}{color:red}`), "outbound", correspondence()).rules[0]!.selector, quad);
    const incoming = correspondence([{ ...association, quid: receiving }]);
    for (const selector of [String.raw`[hson\3a quad="_a\62 cde1234"]`, String.raw`[hson\:quad=_abcde1234]`]) {
      assert.equal(translate(sheet(`${selector}{color:red}`), "inbound", incoming).rules[0]!.selector, selector_for_quid(receiving));
    }
    const digit = "012345678";
    assert.equal(translate(sheet(String.raw`[hson\:quid=\30 12345678]{color:red}`), "outbound",
      correspondence([{ name: `_${digit}`, quid: digit, disposition: "disposable" }])).rules[0]!.selector, '[hson\\:quad="_012345678"]');
  });
  check("CSS escaped literal pipes stay ordinary while actual identity namespaces fail closed", () => {
    const ordinary = [String.raw`[foo\|hson\:quid="ordinary"]`, String.raw`[foo\7c hson\:quad="ordinary"]`,
      String.raw`[ns|foo\|hson\:quid="ordinary"]`, String.raw`[ns|foo\7c hson\:quad="ordinary"]`];
    for (const direction of ["outbound", "inbound"] as const) {
      const mapping = direction === "outbound" ? correspondence() : correspondence([{ ...association, quid: receiving }]);
      const source = direction === "outbound" ? runtime : quad;
      const expectedIdentity = direction === "outbound" ? `_${quid}` : receiving;
      for (const selector of ordinary) {
        const input = sheet(`${selector},:is(${selector}):not(.disabled):has(>${selector}){color:red}.after{color:blue}`);
        assert.deepEqual(translate(input, direction, correspondence([])), input);
        const mixed = sheet(`:is(${selector},${source})>${selector}::before{color:red}.after{color:blue}`);
        const before = structuredClone(mixed), result = translate(mixed, direction, mapping);
        assert.deepEqual(mixed, before);
        assert.equal(neutral_selectors(result.rules[0]!.selector), neutral_selectors(mixed.rules[0]!.selector));
        assert.deepEqual(identities(result.rules[0]!.selector), [expectedIdentity]);
        assert.deepEqual(result.order, mixed.order); assert.deepEqual(result.rules[1], mixed.rules[1]);
        assert.deepEqual(result.rules[0]!.declarations, mixed.rules[0]!.declarations);
      }
      const attribute = direction === "outbound" ? String.raw`hson\3a quid` : String.raw`hson\3a quad`;
      const value = direction === "outbound" ? quid : `_${quid}`;
      for (const prefix of ["ns|", "*|", "|", String.raw`foo\|ns|`, String.raw`foo\7c ns|`]) {
        const input = sheet(`:is([${prefix}${attribute}="${value}"],.x){color:red}`), before = structuredClone(input);
        assert.throws(() => translate(input, direction, mapping), /Unsupported/);
        assert.deepEqual(input, before);
      }
      const genuine = sheet(`:is([${attribute}="${value}"],.x){color:red}`);
      assert.deepEqual(identities(translate(genuine, direction, mapping).rules[0]!.selector), [expectedIdentity]);
      for (const selector of [`[${attribute}^="${value}"]`, `[${attribute}="${value}" i]`, `[HSON\\:quid="${quid}"]`, `[HSON\\:quad="_${quid}"]`]) {
        assert.throws(() => translate(sheet(`${selector}{color:red}`), direction, mapping), /Unsupported/);
      }
    }
  });
  check("CSS identity translation leaves quoted lookalikes ordinary attributes and declaration registries untouched", () => {
    const input = sheet(String.raw`@property --token{syntax:"*";inherits:false;initial-value:"[hson\:quid=abcde1234]"}
      @keyframes abcde1234{from{content:"[hson\:quid=abcde1234]";opacity:0}to{opacity:1}}
      [title='[hson\:quid="abcde1234"]'][data-id="abcde1234"][hson\:quidish="abcde1234"]{
        content:"[hson\:quid=abcde1234]";--selector:[hson\:quid="abcde1234"];background:url("abcde1234");animation:abcde1234 1s}
      [hson\:quid="abcde1234"]{color:red}`);
    const result = translate(input, "outbound", correspondence());
    assert.deepEqual(result.properties, input.properties); assert.deepEqual(result.keyframes, input.keyframes);
    assert.deepEqual(result.rules[0], input.rules[0]); assert.deepEqual(result.rules[1]!.declarations, input.rules[1]!.declarations);
    assert.deepEqual(result.order, input.order);
  });
  check("CSS selector-bearing group headers and all mirrored scope coordinates translate coherently", () => {
    const input = sheet(`@layer before{}@layer{@media screen and (min-width:1px){
      @supports selector(:is(${runtime},.x)) and (content:"[hson\\:quid=abcde1234]"){
        @container card (width>1px){@scope (${runtime}) to (:has(>${runtime})){
          ${runtime}{color:red!important}.x{color:blue!important}
        }}
      }}}@layer{${runtime}{color:green!important}}@starting-style{${runtime}{opacity:0}}
      @container style(--token: "[hson\\:quid=abcde1234]"){${runtime}{opacity:1}}`);
    const result = translate(input, "outbound", correspondence());
    assert.deepEqual(result.rules.map(rule => rule.ruleKey), input.rules.map(rule => rule.ruleKey));
    assert.deepEqual(result.rules.map(rule => rule.declarations), input.rules.map(rule => rule.declarations));
    assert.equal(result.order.length, input.order.length);
    assert.equal(result.rules[0]!.scopes[2], `@supports selector(:is(${quad},.x)) and (content:"[hson:quid=abcde1234]")`);
    assert.equal(result.rules[0]!.scopes[4], `@scope (${quad}) to (:has(>${quad}))`);
    assert.deepEqual(encode_portable_document_stylesheet(decode_portable_document_stylesheet(result)), result);
    const back = translate(result, "inbound", correspondence([{ ...association, quid: receiving }]));
    assert.ok(css(back).includes(`selector(:is(${selector_for_quid(receiving)},.x))`));
    assert.equal(back.rules[0]!.scopes[0], "@layer");
    assert.equal(back.rules.at(-1)!.scopes[0], input.rules.at(-1)!.scopes[0]);
    assert.deepEqual(translate(input, "outbound", correspondence()), result);
  });
  check("CSS opaque group selectors reject and translated compound rule-key collisions never merge occurrences", () => {
    for (const header of [`@scope (:future(${runtime}))`, `@supports selector(:future(${runtime}))`]) {
      const input = sheet(`${header}{.x{color:red}}`), saved = structuredClone(input);
      assert.throws(() => translate(input, "outbound", correspondence()), /Opaque/);
      assert.deepEqual(input, saved);
    }
    const initial = sheet(`@scope (${runtime}){.a{color:red}}@scope ([hson\\3a quid="${quid}"]){.b{color:blue}}`);
    const candidate = { ...initial,
      rules: initial.rules.map(rule => ({ ...rule, ruleKey: "same" })),
      order: initial.order.map(entry => entry.kind === "group" ? { ...entry,
        entries: entry.entries.map(child => child.kind === "rule" ? { ...child, ruleKey: "same" } : child) } : entry),
    };
    decode_portable_document_stylesheet(candidate);
    const saved = structuredClone(candidate);
    assert.throws(() => translate(candidate, "outbound", correspondence()), /Duplicate stylesheet rule/);
    assert.deepEqual(candidate, saved);
    const opaqueKeys = sheet(`${runtime}{color:red}`);
    const rule = opaqueKeys.rules[0]!;
    const keyed = { ...opaqueKeys, rules: [{ ...rule, ruleKey: `sel:${runtime}` }],
      order: [{ kind: "rule" as const, ruleKey: `sel:${runtime}`, scopes: rule.scopes }] };
    const result = translate(keyed, "outbound", correspondence());
    assert.equal(result.rules[0]!.ruleKey, `sel:${runtime}`);
    assert.equal(result.rules[0]!.selector, quad);
    assert.deepEqual(result.order, keyed.order);
  });
  check("CSS missing conflicting malformed correspondence and unresolved references reject atomically", () => {
    const input = sheet(`${runtime}{color:red}`), before = structuredClone(input);
    for (const entries of [[], [association, association], [association, { ...association, quid: second }],
      [association, { ...association, name: "other" }], [{ ...association, name: "_9abcdefgh" }],
      [{ ...association, name: "bad name" }], [{ ...association, quid: "invalid" }]]) {
      const supplied = correspondence(entries), saved = structuredClone(entries);
      assert.throws(() => translate(input, "outbound", supplied));
      assert.deepEqual(input, before); assert.deepEqual(entries, saved);
    }
    assert.throws(() => translate(sheet(`${quad}{color:red}`), "inbound", correspondence()));
    assert.throws(() => translate(sheet('[hson\\:quad="missing"]{color:red}'), "inbound", correspondence([{ ...association, quid: receiving }])));
    let reads = 0;
    const accessor = Object.defineProperty({ ...association }, "disposition", { enumerable: true, get() { reads++; return "authored"; } });
    assert.throws(() => translate(input, "outbound", correspondence([accessor]))); assert.equal(reads, 0);
    const missingDisposition = JSON.parse(JSON.stringify(association)); delete missingDisposition.disposition;
    assert.throws(() => translate(input, "outbound", correspondence([missingDisposition])));
    missingDisposition.disposition = "unknown";
    assert.throws(() => translate(input, "outbound", correspondence([missingDisposition])));
  });
  check("CSS identity operators flags casing namespaces mixed forms and opaque pseudos fail closed", () => {
    for (const attribute of ["hson\\:quid", "hson\\:quad"]) {
      for (const operator of ["~=", "|=", "^=", "$=", "*="]) assert.throws(() => translate(sheet(`[${attribute}${operator}"${quid}"]{color:red}`), "outbound", correspondence()));
      for (const flag of ["i", "s", "I", "future"]) assert.throws(() => translate(sheet(`[${attribute}="${quid}" ${flag}]{color:red}`), "outbound", correspondence()));
      assert.throws(() => translate(sheet(`[${attribute}]{color:red}`), "outbound", correspondence()));
    }
    for (const selector of [`[HSON\\:quid="${quid}"]`, `[*|hson\\:quid="${quid}"]`, quad, `${runtime}:future(${runtime})`]) {
      const admitted = sheet(`${selector}{color:red}`);
      assert.throws(() => translate(admitted, "outbound", correspondence()), /Unsupported|Opaque/);
    }
    assert.throws(() => translate(sheet(`${runtime}{color:red}`), "inbound", correspondence([{ ...association, quid: receiving }])), /mixed/);
    // These constructs are excluded by existing managed CSS grammar before translation.
    for (const source of ['@import "file.css";', '.x{.nested{color:red}}', '@layer first,second;', '@font-face{font-family:x;src:url(x)}']) assert.throws(() => sheet(source));
  });
  check("CSS identity lookalikes stay ordinary even beside exact references and opaque future syntax", () => {
    const harmless = ['::part(hson\\:quid)', '.hson\\:quid', ':future(foo)', ':future(hson\\:quad)', ':future("[hson:quid=literal]")',
      '[data-name=hson\\:quid]', '[hson\\:quid|ordinary="value"]', '[hson\\:quid\\|ordinary="value"]'];
    for (const selector of harmless) {
      const input = sheet(`${selector}{color:red}`);
      assert.equal(document_css_mentions_subject_identity(input), false);
      assert.deepEqual(document_css_subject_identities(input, "outbound"), []);
      assert.deepEqual(translate(input, "outbound", correspondence([])), input);
      const mixed = sheet(`${runtime}${selector}{color:red}:future(foo){color:blue}`);
      assert.deepEqual(document_css_subject_identities(mixed, "outbound"), [quid]);
      const output = translate(mixed, "outbound", correspondence());
      assert.deepEqual(document_css_subject_identities(output, "inbound"), [`_${quid}`]);
      assert.deepEqual(translate(output, "inbound", correspondence([{ ...association, quid: receiving }])),
        sheet(`${selector_for_quid(receiving)}${selector}{color:red}:future(foo){color:blue}`));
    }
    const grouped = sheet(`@supports selector(::part(hson\\:quid)){@scope (:future(foo)){${runtime}::part(hson\\:quad){color:red}}}`);
    assert.deepEqual(document_css_subject_identities(grouped, "outbound"), [quid]);
    assert.deepEqual(document_css_subject_identities(translate(grouped, "outbound", correspondence(), true), "inbound"), [`_${quid}`]);
    for (const selector of [`:future(${runtime})`, `:future([ns|hson\\:quid="${quid}"])`, `${runtime}:future([hson\\:quid^="${quid}"])`]) {
      const input = sheet(`${selector}{color:red}`);
      assert.throws(() => document_css_subject_identities(input, "outbound"), /Opaque CSS selector/);
      assert.throws(() => translate(input, "outbound", correspondence()), /Opaque CSS selector/);
    }
  });
  check("CSS identity-free data is independent deterministic and retains empty anonymous layer occurrences", () => {
    const input = sheet('@layer before{}@layer{.a:is(.x,.y){color:red}}@layer{.b{color:blue}}'), before = structuredClone(input);
    const output = translate(input, "outbound", correspondence([]));
    assert.deepEqual(output, input); assert.equal(css(output), css(input));
    assert.notEqual(output, input); assert.notEqual(output.rules[0], input.rules[0]);
    const group = output.order[1]!; if (group.kind !== "group") throw Error("group");
    Reflect.set(group.entries, "0", { kind: "group", header: "@layer", entries: [] });
    Reflect.set(output.rules[0]!, "selector", ".changed");
    assert.deepEqual(input, before);
  });
  check("CSS checked receiving correspondence invalidates after identity acquisition and topology restoration", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main <button/> <aside/>/>' } }), aggregate = owner(map);
    const candidate = { ...map.capture(), libraries: map.capture().libraries.map(entry => ({ ...entry,
      quads: [{ name: `_${quid}`, path: validate_document_path([0, 0, 0]), disposition: "disposable" as const }] })) };
    const restoration = aggregate.restorePortableLibrariesWithCorrespondence(candidate);
    const input = sheet(`${quad}{color:red}`), saved = structuredClone(input);
    translate(input, "inbound", restoration);
    aggregate.acquireLocalDocumentIdentity(restoration.associations[0]!.library, validate_document_path([0, 0, 1]), second);
    assert.throws(() => translate(input, "inbound", restoration), /changed during capture/);
    assert.deepEqual(input, saved);
    const current = aggregate.restorePortableLibrariesWithCorrespondence(candidate);
    aggregate.restorePortableLibraries(hsonLiveMap.create().capture());
    assert.throws(() => translate(input, "inbound", current), /changed during capture/);
    let checks = 0, result: unknown;
    assert.throws(() => { result = translate(input, "inbound", { associations: restoration.associations,
      assertCurrent() { if (++checks === 2) throw Error("stale during translation"); } }); }, /stale during/);
    assert.equal(result, undefined); assert.deepEqual(input, saved);
  });
}
