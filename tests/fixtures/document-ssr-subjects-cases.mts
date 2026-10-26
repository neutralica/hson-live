import { replace_structured_fixture, structured_css_fixture as fixture_sheet } from "../helpers/structured-css-fixture.mts";
import assert from "node:assert/strict";
import { hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { make_livemap_from_authored_libraries_internal as authored,
  capture_document_ssr_internal as capture, render_document_ssr_internal as render,
  cut_document_ssr_internal as cut } from "../../src/api/livemap/livemap.libraries.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { lookup_document_quad_internal as lookup } from "../../src/api/livemap/livemap.document.quad.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { set_livemap_quid_candidate_source_for_tests as allocation } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { decode_hosted_root } from "../../src/api/livemap/livemap.hosted.ts";
import { decode_portable_document_stylesheet, render_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { realize_document } from "../../src/internal/document-cut.ts";
import { DocumentSsrError } from "../../src/internal/document-cut.error.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import type { LiveMap, LiveMapCutOptions, LiveMapDynamicLibrary } from "../../src/types/livemap.types.ts";
import type { InternalLiveMapAggregateAuthority } from "../../src/api/livemap/livemap.internal.ts";
import type { LiveMapLibraryIdentity } from "../../src/api/livemap/livemap.library.ts";
import { canonical_hson_graph_equal } from "../../src/core/canonical-hson-equal.ts";
import { document_subject_ownership_cases } from "./document-subject-ownership-cases.mts";

type DocumentSsrSubjectFixture = {
  map: LiveMap;
  page: Extract<LiveMapDynamicLibrary, { mode: "document" }>;
  aggregate: InternalLiveMapAggregateAuthority;
  library: LiveMapLibraryIdentity;
  demanded: string[];
};

function rejects_realization_at(run: () => unknown, message: RegExp) {
  assert.throws(run, error => {
    assert.ok(error instanceof DocumentSsrError);
    assert.equal(error.phase, "realize");
    assert.ok(error.cause instanceof Error);
    assert.match(error.cause.message, message);
    return true;
  });
}

export function ssr_subject_fixture(): DocumentSsrSubjectFixture {
  const map = authored({ page: { document: '<html @:_987654321 <head <style "p{color:rgb(99,99,99)}"/>/> <body <section @:first id="first" <p @:firstChild id="first-child"/> <p id="anonymous-one"/>/> <section @:second id="second" <p @:secondChild id="second-child"/> <p id="anonymous-two"/>/> <p id="unrelated"/> <p class="ordinary" id="ordinary"/>/>/>' } });
  const page = map.doc.must("page"), aggregate = owner(map), library = aggregate.libraries()[0]!;
  if (page.mode !== "document") throw Error("document");
  const demanded = ["012345678", "123456789"];
  aggregate.acquireLocalDocumentIdentity(library, path([0, 0, 1, 0, 0, 0, 1]), demanded[0]!);
  aggregate.acquireLocalDocumentIdentity(library, path([0, 0, 1, 0, 1, 0, 1]), demanded[1]!);
  const selector = (name: string) => `[hson\\:quid="${lookup(page, name)!.quid}"]`;
  replace_structured_fixture(page, `@layer before{}@layer{${selector("firstChild")}{padding-left:7px}${selector("secondChild")}{padding-left:9px}}
    ${selector("_987654321")}{background-color:rgb(1,2,3)}
    ${selector("first")},${selector("second")}{border-top:3px solid rgb(4,5,6)}
    :is(${selector("firstChild")}){color:rgb(11,22,33)}
    ${selector("second")} > ${selector("secondChild")}{color:rgb(44,55,66)}
    [hson\\:quid="012345678"]{color:rgb(70,80,90)}[hson\\:quid="123456789"]{color:rgb(100,110,120)}
    .ordinary{color:red}.ordinary{color:rgb(130,140,150)}`);
  return { map, page, aggregate, library, demanded };
}

/** Historical flat final-document state. No installed scopes are removed to
 * manufacture this fixture; current composition is exercised separately. */
export function flat_final_subject_fixture(): DocumentSsrSubjectFixture {
  const map = authored({
    layout: { document: '<html <head/> <body <hson-part lib="components" at="button"/> <hson-part lib="components" at="button"/>/>/>' },
    components: { parts: { button: { kind: "document", document: '<button @:source/>' } } },
    final: { document: '<html <head/> <body <button/> <button/>/>/>' },
  });
  const page = map.doc.must("final"), aggregate = owner(map), library = aggregate.libraries().at(-1)!;
  if (page.mode !== "document") throw Error("document");
  assert.ok(canonical_hson_graph_equal(page.root(), map.doc.must("layout").root()),
    "Historical flat state has the same realized graph as Part composition.");
  assert.equal(aggregate.documentScopes(library), undefined);
  assert.equal(aggregate.documentOverlay(library).size, 0);
  const demanded = ["345678901", "456789012"];
  aggregate.acquireLocalDocumentIdentity(library, path([0,0,1,0,0]), demanded[0]!);
  aggregate.acquireLocalDocumentIdentity(library, path([0,0,1,0,1]), demanded[1]!);
  replace_structured_fixture(page, '[hson\\:quid="345678901"]{color:red}[hson\\:quid="456789012"]{color:blue}');
  return { map, page, aggregate, library, demanded };
}

export function document_ssr_subject_cases(check: (name: string, run: () => void) => void) {
  document_subject_ownership_cases(check);
  check("flat authored QUAD subjects retain ordinary capture and SSR without occurrence scopes", () => {
    const map = authored({ page: { document: '<html @:page <head/> <body <p @:firstChild "Flat"/>/>/>' } });
    const page = map.doc.must("page"), aggregate = owner(map), library = aggregate.libraries()[0]!;
    if (page.mode !== "document") throw Error("document");
    replace_structured_fixture(page, `[hson\\:quid="${lookup(page,"firstChild")!.quid}"]{color:red}`);
    assert.equal(aggregate.documentScopes(library), undefined);
    const snapshot = map.capture(), result = map.cut({ html: "page" });
    assert.deepEqual(result.libs, snapshot);
    assert.equal(result.html, page.render());
    const receiving = install_libraries_snapshot(snapshot).map;
    const received = receiving.doc.must("page");
    if (received.mode !== "document") throw Error("document");
    assert.equal(owner(receiving).documentScopes(owner(receiving).libraries()[0]!), undefined);
    assert.ok(lookup(received, "firstChild"));
    assert.equal(received.render(), result.html);
  });
  check("one fenced candidate shares graph CSS correspondence and exact paths", () => {
    const { map, page, aggregate, library, demanded } = ssr_subject_fixture();
    const before = map.capture(), overlay = aggregate.documentOverlay(library), ledger = aggregate.identityEpoch().issued();
    const candidate = capture(page, demanded), result = cut(map, { html: "page" }, demanded);
    assert.equal(candidate.revision, map.rev);
    assert.deepEqual(candidate.correspondence.map(({ name, path, disposition }) => ({ name, path, disposition })), [
      { name: "_012345678", path: [0,0,1,0,0,0,1], disposition: "disposable" },
      { name: "_123456789", path: [0,0,1,0,1,0,1], disposition: "disposable" },
      { name: "_987654321", path: [0], disposition: "authored" },
      { name: "first", path: [0,0,1,0,0], disposition: "authored" },
      { name: "firstChild", path: [0,0,1,0,0,0,0], disposition: "authored" },
      { name: "second", path: [0,0,1,0,1], disposition: "authored" },
      { name: "secondChild", path: [0,0,1,0,1,0,0], disposition: "authored" },
    ]);
    assert.deepEqual(result.libs.libraries[0]!.quads, candidate.quads);
    assert.deepEqual(result.libs.libraries[0]!.css, candidate.css);
    assert.deepEqual(decode_hosted_root(result.libs.libraries[0]!.root), candidate.root);
    assert.equal(result.html, render(page, demanded));
    for (const { name } of candidate.correspondence) assert.ok(result.html.includes(`hson:quad="${name}"`));
    assert.match(result.html, /hson:quad="_012345678" id="anonymous-one"/);
    assert.match(result.html, /hson:quad="_123456789" id="anonymous-two"/);
    assert.match(result.html, /<html hson:quad="_987654321">/);
    assert.equal((result.html.match(/ hson:quad=/g) ?? []).length, 7);
    assert.match(result.html, /<p id="unrelated"><\/p>/);
    assert.doesNotMatch(result.html, /hson:quid|hson\\:quid/);
    for (const { quid, disposition } of candidate.correspondence) {
      if (disposition === "authored") assert.equal(result.html.includes(quid), false);
    }
    assert.doesNotMatch(JSON.stringify(candidate.root), /"quid"|hson:quad/);
    assert.equal(aggregate.documentOverlay(library), overlay); assert.equal(aggregate.identityEpoch().issued(), ledger);
    assert.deepEqual(map.capture(), before);
    assert.equal(page.render(), result.html, "Ordinary CSS demand uses the same portable realization.");
  });
  check("public cut ignores callback indices and surplus arguments while private demand stays functional", () => {
    const { map, demanded } = ssr_subject_fixture();
    const options: { html: "page" } = { html: "page" }, ordinary = map.cut(options);
    // Invoke the native Array.map callback directly despite the public generic overload.
    const callbacks: unknown[] = Array.prototype.map.call([options, options], map.cut);
    assert.equal(callbacks.length, 2);
    for (const result of callbacks) assert.deepEqual(result, ordinary);
    assert.equal((ordinary.html.match(/ hson:quad=/g) ?? []).length, 7);
    // An explicitly typed JS-call adapter, without adding a public overload.
    const withExtras: (options: LiveMapCutOptions, ...extras: unknown[]) => unknown =
      (options, ...extras) => Reflect.apply(map.cut, undefined, [options, ...extras]);
    for (const extras of [[demanded], [0], [1], [null, "extra", {}], [[], Symbol("extra")]]) {
      assert.deepEqual(withExtras(options, ...extras), ordinary);
      assert.deepEqual(withExtras({}, ...extras), map.cut());
    }
    const states: unknown[] = Array.prototype.map.call([{}, {}], map.cut);
    for (const state of states) {
      assert.deepEqual(state, map.cut()); assert.ok(state !== null && typeof state === "object");
      assert.deepEqual(Object.keys(state), ["libs"]);
    }
    const internal = cut(map, options, demanded);
    assert.equal((internal.html.match(/ hson:quad=/g) ?? []).length, 7);
    assert.ok(internal.html.includes('[hson\\:quad="_012345678"]'));
    assert.ok(internal.html.includes('[hson\\:quad="_123456789"]'));
    assert.equal(ordinary.html, map.cut(options).html, "Private opt-in leaves public behavior unchanged.");
  });
  check("observational repeats allocate no identities and mutate no source", () => {
    const { map, page, aggregate, library, demanded } = ssr_subject_fixture();
    const before = map.capture(), root = aggregate.root(library), overlay = aggregate.documentOverlay(library), ledger = aggregate.identityEpoch().issued();
    let allocations = 0;
    allocation(aggregate.identityEpoch().owner, () => { allocations++; throw Error("Unexpected render allocation"); });
    try {
      const first = cut(map, { html: "page" }, demanded);
      assert.equal(render(page, demanded), first.html);
      assert.deepEqual(cut(map, { html: "page" }, demanded), first);
      assert.deepEqual(render(page, [...demanded, demanded[0]!]), first.html);
    } finally { allocation(aggregate.identityEpoch().owner, undefined); }
    assert.equal(allocations, 0); assert.equal(aggregate.root(library), root);
    assert.equal(aggregate.documentOverlay(library), overlay); assert.equal(aggregate.identityEpoch().issued(), ledger);
    assert.deepEqual(map.capture(), before);
  });
  check("detached cut siblings survive graph and CSS mutation after capture", () => {
    const { map, page, demanded } = ssr_subject_fixture();
    const expected = cut(map,{html:"page"},demanded), encode = TextEncoder.prototype.encode;
    let mutated = false;
    TextEncoder.prototype.encode = function(input) {
      if (!mutated && input?.startsWith('{"format":"hson-livemap-libraries-snapshot"')) {
        mutated = true;
        TextEncoder.prototype.encode = encode;
        page.at([0]).asElement()!.attrs.set("data-after-capture","yes");
        replace_structured_fixture(page, "p{color:red}");
      }
      return encode.call(this,input);
    };
    try {
      const result = cut(map,{html:"page"},demanded);
      assert.equal(mutated,true); assert.deepEqual(result,expected);
      assert.doesNotMatch(result.html,/data-after-capture/);
      assert.equal(map.rev,expected.libs.revision+2);
    } finally { TextEncoder.prototype.encode = encode; }
  });
  check("identity-free CSS keeps selectors layer occurrences and ordering", () => {
    const map = hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body <p class="ordinary"/>/>/>'}}), page = map.doc.must("page");
    replace_structured_fixture(page, '@layer before{}@layer{.ordinary:is(.x,.y){color:red}}@layer{.ordinary{color:blue}}.ordinary{color:red}.ordinary{color:green}');
    const before = page.css.snapshot(), candidate = capture(page, []);
    assert.equal(render_portable_document_stylesheet(decode_portable_document_stylesheet(candidate.css)), before);
    assert.equal(render(page, []), page.render()); assert.deepEqual(candidate.correspondence, []);
    replace_structured_fixture(page, ':future("literal"){color:red}[title=\'[hson\\:quid="012345678"]\']{color:blue}');
    assert.equal(render(page, []), page.render(), "Identity-free future selectors keep their established serialization.");
  });
  check("independent Library instances keep distinct addressed roots and descendants", () => {
    const map = authored({one:{document:'<html @:one <head/> <body <p @:oneChild/>/>/>'},two:{document:'<html @:two <head/> <body <p @:twoChild/>/>/>'}});
    for (const [library, rootName, childName] of [["one","one","oneChild"],["two","two","twoChild"]]) {
      const page = map.doc.must(library!); if (page.mode !== "document") throw Error("document");
      replace_structured_fixture(page, `[hson\\:quid="${lookup(page,rootName!)!.quid}"]{color:red}[hson\\:quid="${lookup(page,childName!)!.quid}"]{color:blue}`);
      const html = render(page, []);
      assert.match(html, new RegExp(`<html hson:quad="${rootName}">`));
      assert.ok(html.includes(`[hson\\:quad="${childName}"]`));
      assert.equal((html.match(/ hson:quad=/g) ?? []).length, 2);
    }
    const one = map.doc.must("one"), two = map.doc.must("two");
    assert.throws(() => capture(one,[lookup(two,"twoChild")!.quid]), /active subject/);
    assert.doesNotMatch(render(one,[]), /quad="two|quad="twoChild/);
  });
  check("authored versus disposable name collisions reject without publication", () => {
    const map = authored({page:{document:'<html @:_012345678 <head/> <body <p/>/>/>'}}), page = map.doc.must("page"), aggregate = owner(map), library = aggregate.libraries()[0]!;
    aggregate.acquireLocalDocumentIdentity(library,path([0,0,1,0,0]),"012345678");
    const before = map.capture(), ledger = aggregate.identityEpoch().issued(), overlay = aggregate.documentOverlay(library);
    let output: unknown;
    assert.throws(() => { output = render(page,["012345678"]); }, /portable QUAD/);
    assert.equal(output,undefined); assert.deepEqual(map.capture(),before);
    assert.equal(aggregate.identityEpoch().issued(),ledger); assert.equal(aggregate.documentOverlay(library),overlay);
  });
  check("unsupported unresolved mixed and foreign references reject at their exact guards", () => {
    const { map, page, aggregate, library, demanded } = ssr_subject_fixture();
    for (const { selector, name, message } of [
      {selector:'[hson\\:quid^="012345678"]',name:"SyntaxError",message:/^Unsupported or mixed CSS identity attribute selector\.$/},
      {selector:'[hson\\:quid="012345678" i]',name:"SyntaxError",message:/^Unsupported or mixed CSS identity attribute selector\.$/},
      {selector:'[hson\\:quid="999999999"]',name:"TypeError",message:/^Unresolved CSS identity selector reference\.$/},
      {selector:'[hson\\:quad="first"]',name:"SyntaxError",message:/^Unsupported or mixed CSS identity attribute selector\.$/},
    ]) {
      const before = map.capture(), ledger = aggregate.identityEpoch().issued(), overlay = aggregate.documentOverlay(library);
      assert.throws(() => replace_structured_fixture(page, `${selector}{color:red}`), selector.includes("999999999") ? /owner-issued QUID/ : {name,message});
      assert.deepEqual(map.capture(),before); assert.equal(aggregate.identityEpoch().issued(),ledger); assert.equal(aggregate.documentOverlay(library),overlay);
    }
    assert.throws(() => capture(page,["999999999"]), /^Error: Correspondence requires an owner-issued QUID\.$/);
  });
  check("omitted live anonymous demand rejects unresolved correspondence in otherwise admissible CSS", () => {
    const map = hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body <p/>/>/>'}}), page = map.doc.must("page"), aggregate = owner(map);
    aggregate.acquireLocalDocumentIdentity(aggregate.libraries()[0]!, path([0,0,1,0,0]), "012345678");
    replace_structured_fixture(page, '[hson\\:quid="012345678"]{color:red}');
    assert.match(render(page,["012345678"]), /hson:quad="_012345678"/);
    const before = map.capture(), ledger = aggregate.identityEpoch().issued();
    for (const attempt of [() => render(page,[]), () => cut(map,{html:"page"},[])]) {
      assert.throws(attempt, {name:"TypeError",message:/^Unresolved CSS identity selector reference\.$/});
    }
    assert.deepEqual(map.capture(),before); assert.equal(aggregate.identityEpoch().issued(),ledger);
  });
  check("opaque identity selector rejects at the translator opaque-syntax guard", () => {
    const { map, page, demanded } = ssr_subject_fixture();
    assert.throws(() => replace_structured_fixture(page, ':future([hson\\:quid="012345678"]){color:red}'),
      {name:"SyntaxError",message:/^Opaque CSS selector or group prelude cannot be identity-translated\.$/});
  });
  check("lowercase portable carrier rejects at exact Library node admission", () => {
    assert.throws(() => hsonLiveMap.fromLibraries({page:{document:{$_tag:"_hson_root",$_content:[
      {$_tag:"main",$_attrs:{"hson:quad":"authored"},$_content:[]},
    ]}}}), {code:"HSON_CANONICAL_INVARIANT_VIOLATION",message:/invalid or reserved attribute name/});
  });
  check("admissible uppercase carrier collides after browser attribute lowering in the subject planner", () => {
    const map = authored({page:{document:'<html @:root HSON:QUAD="authored" <head/> <body/>/>'}}), page = map.doc.must("page");
    const candidate = capture(page,[]);
    assert.doesNotThrow(() => hsonLiveMap.fromLibraries({page:{document:candidate.root}}));
    for (const css of ["", "p{color:red}"]) {
      replace_structured_fixture(page, css);
      rejects_realization_at(() => render(page,[]), /^Authored markup uses the reserved portable document subject carrier\.$/);
    }
  });
  check("managed marker collision reaches managed CSS planning", () => {
    const map = hsonLiveMap.fromLibraries({page:{document:'<html data-hson-managed-document-css="authored" <head/> <body/>/>'}}), page = map.doc.must("page");
    replace_structured_fixture(page, 'p{color:red}');
    rejects_realization_at(() => render(page,[]), /^Authored markup uses the reserved managed document CSS marker\.$/);
  });
  check("unsafe style sentinel rejects CSS admission and rawtext SSR realization", () => {
    const map = hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body/>/>'}}), page = map.doc.must("page");
    const before = map.capture(), candidate = capture(page,[]), unsafe = 'p{content:"</style>"}';
    page.css.stylesheet(unsafe);
    assert.equal(page.css.snapshot(),unsafe);
    rejects_realization_at(() => page.render(), /style RAWTEXT contains a parser-significant closing sentinel/);
    rejects_realization_at(() => realize_document(candidate.root,[unsafe],{}), /style RAWTEXT contains a parser-significant closing sentinel/);
  });
  check("managed CSS requires an html shell and incomplete full documents reject earlier in browser planning", () => {
    const fragment = hsonLiveMap.fromLibraries({page:{document:'<main/>'}}).doc.must("page");
    assert.doesNotThrow(() => render(fragment,[]));
    fragment.css.stylesheet('main{color:red}');
    rejects_realization_at(() => render(fragment,[]), /^Nonempty document CSS requires an explicit html\/head document root\.$/);
    const missing = hsonLiveMap.fromLibraries({page:{document:'<html <body/>/>'}}).doc.must("page");
    // Full html planning requires head then body even before managed CSS is added.
    for (const css of ["", "p{color:red}"]) {
      missing.css.stylesheet(css);
      rejects_realization_at(() => render(missing,[]), /a full document requires exactly ordered canonical <head> and <body> children/);
    }
  });
  check("reentrant identity graph and CSS changes invalidate capture with no SSR output", () => {
    for (const kind of ["identity", "graph", "css"]) {
      const { map, page, aggregate, library, demanded } = ssr_subject_fixture();
      const get = Object.getOwnPropertyDescriptor;
      let mutated = false;
      const requested = new Proxy(demanded,{getOwnPropertyDescriptor(target,key) {
        if (key === "0" && !mutated) {
          mutated = true;
          if (kind === "identity") aggregate.acquireLocalDocumentIdentity(library,path([0,0,1,0,2]),"234567890");
          else if (kind === "css") replace_structured_fixture(page, "p{color:red}");
          else page.at([0]).asElement()!.attrs.set("data-reentrant","yes");
        }
        return get(target,key);
      }});
      let result: unknown;
      assert.throws(() => { result = capture(page,requested); }, /changed during capture/);
      assert.equal(result,undefined); assert.equal(mutated,true);
      assert.equal(aggregate.identityEpoch().issued().has("234567890"),kind === "identity",
        "Only the explicitly reentrant acquisition may publish identity.");
    }
  });
  check("incomplete identity transactions reject capture render and both cut modes", () => {
    const { map, page, aggregate, library, demanded } = ssr_subject_fixture();
    const before = map.capture(), revision = map.rev, ledgerSize = aggregate.identityEpoch().issued().size;
    const attempts = [() => capture(page,demanded), () => render(page,demanded),
      () => cut(map,{html:"page"},demanded), () => map.cut({html:"page"})];
    let rejected = 0;
    const rejectCaptures = () => { for (const attempt of attempts) {
      assert.throws(attempt, /^Error: Capture cannot observe an incomplete identity transaction\.$/); rejected++;
    } };
    aggregate.acquireLocalDocumentIdentity(library,path([0,0,1,0,2]),"234567890",{
      preflight() { rejectCaptures(); return {apply() {},rollback() {},release() {}}; },
      realize() { rejectCaptures(); }, rollbackRealization() {},
    });
    assert.equal(rejected,8); assert.equal(map.rev,revision); assert.deepEqual(map.capture(),before);
    assert.equal(aggregate.identityEpoch().issued().size,ledgerSize+1);
    assert.equal(aggregate.documentOverlay(library).quidAtPath(path([0,0,1,0,2])),"234567890");
    assert.equal((render(page,demanded).match(/ hson:quad=/g) ?? []).length,7);
  });
  check("reentrant authority mutation invalidates the outer cut without undoing the accepted authority", () => {
    const map = hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body <p/>/>/>'}}), aggregate = owner(map);
    aggregate.acquireLocalDocumentIdentity(aggregate.libraries()[0]!,path([0,0,1,0,0]),"012345678");
    const before = map.capture(), changed = {...aggregate.hostedPosition().authority,incarnationId:"ssr-reentrant"};
    const options: LiveMapCutOptions = {get html() { aggregate.setInitialHostedAuthority(changed); return "page"; }};
    let result: unknown;
    assert.throws(() => { result = cut(map,options,["012345678"]); }, /^Error: LiveMap identity or authority changed during capture\.$/);
    assert.equal(result,undefined); assert.deepEqual(aggregate.hostedPosition().authority,changed);
    assert.equal(map.rev,0); assert.deepEqual(map.capture(),before);
    assert.match(cut(map,{html:"page"},["012345678"]).html,/hson:quad="_012345678"/);
  });
  check("historical flat final page projects receiving subjects without source component Libraries", () => {
    const { map, aggregate, library, demanded } = flat_final_subject_fixture();
    const layout = aggregate.libraries()[0]!, scopes = aggregate.documentScopes(layout);
    assert.equal(scopes?.occurrences.length,2,"Initial layout retains both actual Part occurrences.");
    const sourceQuids = scopes!.occurrences.map(scope => scope.rootQuid);
    assert.equal(aggregate.documentScopes(library),undefined,"The historical final Library has the flat document contract.");
    assert.throws(() => map.capture(), /Scoped document capture/);
    assert.throws(() => aggregate.captureDocumentSsr(layout,[]), /Scoped document SSR/);
    // Observe every source Library without requesting unsupported portable state
    // for the scoped layout. Inspection also checks runtime identities and scopes,
    // which the former whole-map portable snapshot could not represent.
    const observe = () => {
      const graph = aggregate.inspect();
      return { graph, registry: aggregate.hostedRegistry(), position: aggregate.hostedPosition(),
        epoch: aggregate.identityEpoch().current(), issued: aggregate.identityEpoch().issued(),
        documents: graph.libraries.flatMap(entry => entry.mode !== "document" ? [] : [{
          identity: entry.identity, overlay: aggregate.documentOverlay(entry.identity),
          scopes: aggregate.documentScopes(entry.identity), stylesheet: aggregate.stylesheet(entry.identity),
          quads: aggregate.projectDocumentCorrespondence(entry.identity,[]),
        }]),
      };
    };
    const before = observe(), result = cut(map,{html:"final",documents:["final"],data:[]},demanded);
    assert.deepEqual(result.libs.libraries.map(library=>library.name),["final"]);
    assert.equal((result.html.match(/ hson:quad=/g) ?? []).length,2);
    for (const quid of demanded) {
      assert.ok(result.html.includes(`hson:quad="_${quid}"`));
      assert.ok(result.html.includes(`[hson\\:quad="_${quid}"]`));
    }
    for (const quid of sourceQuids) assert.equal(result.html.includes(quid),false);
    assert.deepEqual(observe(),before);
    assert.equal(aggregate.documentScopes(layout),scopes,"SSR preserves the exact source occurrence lifetimes.");
    const receiving = install_libraries_snapshot(result.libs).map;
    assert.throws(() => receiving.data.must("components")); assert.throws(() => receiving.doc.must("layout"));
    for (const quid of sourceQuids) assert.equal(owner(receiving).identityEpoch().issued().has(quid),false);
    assert.equal(receiving.capture().libraries.length,1);
    // Portable state admission is tested here; projected-marker graft/CSS rebinding is outside this cut.
  });
  check("portable carrier never grants incoming QUID authority and graft remains a later cut", () => {
    const { map, demanded } = ssr_subject_fixture(), result = cut(map,{html:"page"},demanded);
    assert.throws(() => hsonTransform.fromTrustedHtml(result.html), /metadata|quad/i);
  });
}
