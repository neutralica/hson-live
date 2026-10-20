import { css_identity_translation_cases } from "./css-identity-translation-cases.mts";
import assert from "node:assert/strict";
import { hsonLiveMap, hsonLiveTree } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { canonical_portable_document_css_op, apply_portable_document_css_op } from "../../src/internal/css/portable-document-operations.ts";
import { parse_document_stylesheet, DocumentStylesheetError } from "../../src/internal/css/parse-document-stylesheet.ts";
import { decode_portable_document_stylesheet, encode_portable_document_stylesheet, render_portable_document_stylesheet, empty_portable_document_stylesheet, drop_portable_document_rule, set_portable_document_declaration, set_portable_document_keyframes } from "../../src/internal/css/portable-document-stylesheet.ts";

export function managed_stylesheet_cases(check: (name: string, run: () => void) => void): void {
  css_identity_translation_cases(check);
  check("significant escape boundaries remain CSS tokens", () => {
    const unicode = parse_document_stylesheet('\u00a0.x{color:red}', []);
    assert.equal(render_portable_document_stylesheet(decode_portable_document_stylesheet(unicode)), '\u00a0.x{color:red;}');
    const parsed = parse_document_stylesheet('#t\\ {font-family:foo\\ ;color:red}', []);
    assert.equal(parsed.rules[0]!.selector, '#t\\ ');
    assert.deepEqual(parsed.rules[0]!.declarations, [["font-family", 'foo\\ '], ["color", "red"]]);
    assert.equal(render_portable_document_stylesheet(decode_portable_document_stylesheet(parsed)), '#t\\ {font-family:foo\\ ;color:red;}');
    const escapedName = 'f\\ ';
    const escapedFrames = String.raw`@keyframes f\ {0%{opacity:.2}from{opacity:.8}}`;
    const map = hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body/>/>'}});
    map.doc.must("page").css.stylesheet(escapedFrames);
    assert.ok(map.doc.must("page").css.keyframes.has(escapedName));
    assert.equal(map.doc.must("page").css.keyframes.get(escapedName)?.name, escapedName);
    map.doc.must("page").css.keyframes.delete(escapedName);
    assert.equal(map.doc.must("page").css.snapshot(), "");
    const runtime = hsonLiveTree.fromNode({$_tag:"main",$_content:[]},{isolated:true});
    runtime.css.global.stylesheet(escapedFrames);
    assert.ok(runtime.css.global.keyframes.has(escapedName));
    assert.match(runtime.css.snapshot(), /opacity: .8/);
    runtime.css.global.keyframes.delete(escapedName);
    assert.equal(runtime.css.snapshot(), "");
    runtime.remove();
    const quoted = parse_document_stylesheet('.x{content:"a\\\";b";--Token:foo\\ ;color:red}', []);
    assert.deepEqual(quoted.rules[0]!.declarations, [["content", '"a\\\";b"'], ["--Token", 'foo\\ '], ["color", "red"]]);
    assert.equal(parse_document_stylesheet('#t\\20 x{color:red}', []).rules[0]!.selector, '#t\\20 x');
    const commented = parse_document_stylesheet('.x/**/.y{--x:a/**/b;content:"/*literal*/"}', []);
    assert.equal(commented.rules[0]!.selector, '.x.y');
    assert.equal(commented.rules[0]!.declarations[0]![1], 'a/**/b');
  });
  check("native identifiers and JS setter keys have distinct admission", () => {
    const parsed = parse_document_stylesheet('.x{CoLoR:red;c\\6f lorx:blue;marginTop:5px;--Tone:red;--tone:blue}', []);
    assert.deepEqual(parsed.rules[0]!.declarations, [["color", "red"], ["colorx", "blue"], ["margintop", "5px"], ["--Tone", "red"], ["--tone", "blue"]]);
    assert.deepEqual(parse_document_stylesheet('.x{c\\6f lor:red}', []).rules[0]!.declarations, [["color", "red"]]);
    let structured = set_portable_document_declaration(empty_portable_document_stylesheet(), "x", ".x", "marginTop", "5px");
    assert.deepEqual(encode_portable_document_stylesheet(structured).rules[0]!.declarations, [["margin-top", "5px"]]);
    structured = set_portable_document_keyframes(structured, { name: "s", steps: [["from", { marginTop: "5px" }], ["to", { marginTop: "0" }]] });
    assert.equal(structured.keyframes[0]!.steps[0]!.decls["margin-top"], "5px");
    assert.throws(() => parse_document_stylesheet('.x{CoLoR:red;color:blue}', []), DocumentStylesheetError);
  });
  check("equivalent keyframe positions preserve authored precedence", () => {
    for (const [first, second] of [["0%", "from"], ["from", "0%"], ["to", "100%"], ["100%", "to"], ["50%", "50.0%"]]) {
      const record = parse_document_stylesheet(`@keyframes f{${first}{opacity:.2}${second}{opacity:.8}}`, []);
      assert.deepEqual(record.keyframes[0]!.steps.map(s => s.at), [first, second]);
      assert.deepEqual(record.keyframes[0]!.steps.map(s => s.declarations), [[["opacity", ".2"]], [["opacity", ".8"]]]);
      assert.deepEqual(encode_portable_document_stylesheet(decode_portable_document_stylesheet(JSON.parse(JSON.stringify(record)))), record);
    }
    assert.throws(() => parse_document_stylesheet('@keyframes f{0%{opacity:.2}0%{opacity:.8}}', []), DocumentStylesheetError);
    assert.throws(() => parse_document_stylesheet('@keyframes f{0%,50%{opacity:.2}}', []), DocumentStylesheetError);
    const structured = set_portable_document_keyframes(empty_portable_document_stylesheet(), { name: "f", steps: [["from", { opacity: ".1" }], ["from", { opacity: ".8" }], ["0%", { color: "red" }]] });
    assert.deepEqual(structured.keyframes[0]!.steps.map(s => [s.at, s.decls]), [["from", { opacity: ".8" }], ["0%", { color: "red" }]]);
  });
  check("anonymous occurrences have structural membership, not header identity", () => {
    const one = parse_document_stylesheet('@layer{.x{color:red!important}.x{color:blue!important}}', []);
    const two = parse_document_stylesheet('@layer{.x{color:red!important}}@layer{.x{color:blue!important}}', []);
    assert.deepEqual(one.order, [{ kind: "group", header: "@layer", entries: [
      { kind: "rule", ruleKey: "stylesheet:1", scopes: ["@layer"] },
      { kind: "rule", ruleKey: "stylesheet:2", scopes: ["@layer"] },
    ] }]);
    assert.equal(two.order.length, 2);
    assert.notDeepEqual(one.order, two.order);
    const nested = parse_document_stylesheet('@media screen{@layer{@supports (display:grid){@layer{.x{color:red}.y{color:blue}}}}}', []);
    const root = nested.order[0]!;
    assert.equal(root.kind, "group");
    if (root.kind !== "group") throw Error("missing group");
    assert.equal(root.header, "@media screen");
    assert.equal(root.entries[0]!.kind, "group");
    assert.deepEqual(nested.rules[0]!.scopes, ["@media screen", "@layer", "@supports (display:grid)", "@layer"]);
    for (const record of [one, two, nested, parse_document_stylesheet('@layer before{}@layer after{.x{color:red}}', [])]) {
      assert.deepEqual(encode_portable_document_stylesheet(decode_portable_document_stylesheet(JSON.parse(JSON.stringify(record)))), record);
    }
    const bad = JSON.parse(JSON.stringify(one)); bad.order[0].entries[0].scopes = [];
    assert.throws(() => decode_portable_document_stylesheet(bad), /group membership/);
    const injected = JSON.parse(JSON.stringify(one)); injected.order[0].header = "@layer { .injected {color:red} } @layer";
    assert.throws(() => decode_portable_document_stylesheet(injected), /group header/);
    const cyclic = { kind: "group", header: "@layer", entries: [] as unknown[] }; cyclic.entries.push(cyclic);
    assert.throws(() => decode_portable_document_stylesheet({ rules: [], properties: [], keyframes: [], order: [cyclic] }), /Cyclic/);
  });
  check("rule edits and deletions preserve their occurrence; clear and replacement own its lifetime", () => {
    const record = parse_document_stylesheet('@layer{.x{color:red!important}.x{color:blue!important}}', []);
    let state = decode_portable_document_stylesheet(record);
    const changedRule = { ...record.rules[0]!, declarations: [["color", "green !important"]] as const };
    state = apply_portable_document_css_op(state, canonical_portable_document_css_op({ domain: "css", kind: "rule", ruleKey: "stylesheet:1", scopes: ["@layer"], rule: changedRule }));
    assert.deepEqual(state.order, record.order);
    assert.equal(state.rules[0]!.declarations.color, "green !important");
    for (const ruleKey of ["stylesheet:1", "stylesheet:2"]) state = apply_portable_document_css_op(state, canonical_portable_document_css_op({ domain: "css", kind: "rule", ruleKey, scopes: ["@layer"] }));
    assert.deepEqual(state.order, [{ kind: "group", header: "@layer", entries: [] }]);
    assert.equal(render_portable_document_stylesheet(state), '@layer {\n\n}');
    const restored = decode_portable_document_stylesheet(encode_portable_document_stylesheet(state));
    assert.deepEqual(restored.order, state.order);
    state = apply_portable_document_css_op(state, canonical_portable_document_css_op({ domain: "css", kind: "rule", ruleKey: "stylesheet:1", scopes: ["@layer"], rule: changedRule }));
    assert.equal(state.order.length, 2, "recreation appends an independently wrapped rule");
    state = apply_portable_document_css_op(state, canonical_portable_document_css_op({ domain: "css", kind: "clear-all" }));
    assert.deepEqual(encode_portable_document_stylesheet(state), { rules: [], properties: [], keyframes: [], order: [] });
  });
  check("LiveMap capture replay and runtime append retain correct grouping and atomic rejection", () => {
    const source = '@layer{.x{color:red!important}.x{color:blue!important}}';
    const map = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body/>/>' } });
    const page = map.doc.must("page"); const commits: Parameters<typeof map.replay>[0][] = [];
    map.commits.observe(commit => commits.push(commit));
    page.css.stylesheet(source);
    const original = map.capture(); const rev = map.rev;
    page.css.stylesheet(source); assert.equal(map.rev, rev); assert.equal(commits.length, 1);
    for (const invalid of ['.x{color:red;color:blue}', '@import "x";', '.x{color:red']) {
      assert.throws(() => page.css.stylesheet(invalid), DocumentStylesheetError);
      assert.equal(map.rev, rev); assert.deepEqual(map.capture(), original); assert.equal(commits.length, 1);
    }
    page.css.drop("stylesheet:1");
    assert.equal(page.css.list().length, 1);
    const restored = install_libraries_snapshot(map.capture()).map.doc.must("page");
    assert.equal(restored.mode, "document");
    if (restored.mode !== "document") throw Error("bad library");
    assert.equal(restored.css.snapshot(), page.css.snapshot());
    const replay = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body/>/>' } });
    for (const commit of commits) replay.replay(commit);
    assert.deepEqual(replay.capture().libraries[0]!.css, map.capture().libraries[0]!.css);
    const tree = hsonLiveTree.fromNode({ $_tag: "main", $_content: [] }, { isolated: true });
    tree.css.global.stylesheet(source);
    assert.equal(tree.css.snapshot(), render_portable_document_stylesheet(decode_portable_document_stylesheet(parse_document_stylesheet(source, []))));
    tree.css.global.drop("stylesheet:2");
    tree.css.global.stylesheet('@layer{.x{color:green!important}}');
    assert.equal((tree.css.snapshot().match(/color:green/g) ?? []).length, 1, "reused key is a new member, never a resurrected old occurrence");
    tree.css.global.clearAll();
    tree.css.global.stylesheet(source);
    tree.css.global.stylesheet(source);
    assert.equal((tree.css.snapshot().match(/@layer/g) ?? []).length, 2, "standalone calls append two distinct occurrences");
    tree.css.global.drop("stylesheet:1");
    assert.equal((tree.css.snapshot().match(/@layer/g) ?? []).length, 2);
    tree.css.global.clearAll(); assert.equal(tree.css.snapshot(), "");
    tree.remove();
  });

  check("group formatting preserves escaped-newline component values", () => {
    const source = '@layer{@media screen{.x{--x:"review\\\nword";font-family:var(--x)}}}';
    const record = parse_document_stylesheet(source, []);
    assert.equal(record.rules[0]!.declarations[0]![1], '"review\\\nword"');
    const rendered = render_portable_document_stylesheet(decode_portable_document_stylesheet(record));
    assert.ok(rendered.includes('"review\\\nword"'), "renderer must not insert content after escaped newline");
    const map = hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body/>/>'}});
    map.doc.must("page").css.stylesheet(source);
    const restored = install_libraries_snapshot(map.capture()).map;
    assert.deepEqual(restored.capture().libraries[0]!.css, record);
    assert.equal(restored.doc.must("page").css.snapshot(), rendered);
    const tree = hsonLiveTree.fromNode({$_tag:"main",$_content:[]},{isolated:true});
    tree.css.global.stylesheet(source); assert.equal(tree.css.snapshot(), rendered); tree.remove();
  });
  check("selector identities and public lookup preserve significant terminal characters", () => {
    const selectors = ['#t\\ ', '#t\\\u00a0', '#t\u00a0', '#t', '#t\\20 x'];
    const map = hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body/>/>'}});
    const commits: Parameters<typeof map.replay>[0][] = []; map.commits.observe(commit => commits.push(commit));
    const tree = hsonLiveTree.fromNode({$_tag:"main",$_content:[]},{isolated:true});
    for (const css of [map.doc.must("page").css, tree.css.global]) {
      for (const selector of selectors) css.sel(selector).set.color("red");
      assert.equal(css.list().length, selectors.length);
      for (const selector of selectors) { const key = `sel:${selector}`; assert.ok(css.has(key), key); assert.ok(css.get(key)?.includes(selector), key); }
      css.sel(selectors[0]!).set.color("green");
      assert.ok(css.get(`sel:${selectors[0]}`)?.includes("green"));
      assert.ok(css.get(`sel:${selectors[1]}`)?.includes("red"));
      css.drop(`sel:${selectors[0]}`); assert.equal(css.has(`sel:${selectors[0]}`), false);
      assert.equal(css.has(`sel:${selectors[1]}`), true);
      css.sel(selectors[0]!).set.color("blue");
      const text = css === tree.css.global ? tree.css.snapshot() : map.doc.must("page").css.snapshot();
      assert.ok(text.indexOf(`${selectors[1]}{`) < text.indexOf(`${selectors[0]}{`), "recreation appends");
    }
    const state=decode_portable_document_stylesheet(map.capture().libraries[0]!.css);
    const dropped=drop_portable_document_rule(state,`sel:${selectors[0]}`);
    assert.equal(dropped.rules.length,state.rules.length-1);
    assert.ok(dropped.rules.some(rule=>rule.ruleKey===`sel:${selectors[1]}`));
    const before=map.rev, count=commits.length;
    map.doc.must("page").css.sel('  #t  ').set.color("red");
    assert.equal(map.rev,before); assert.equal(commits.length,count);
    const replay=hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body/>/>'}});
    for(const commit of commits) replay.replay(commit);
    assert.deepEqual(replay.capture().libraries[0]!.css,map.capture().libraries[0]!.css);
    assert.deepEqual(install_libraries_snapshot(map.capture()).map.capture().libraries[0]!.css,map.capture().libraries[0]!.css);
    tree.remove();
  });
  check("portable stylesheet arrays reject malformed physical storage without executing code", () => {
    const entry = {kind:"group",header:"@layer",entries:[]};
    const malformed: unknown[][] = [Array(1), [,entry], [entry,,entry], [entry,]];
    malformed[3]!.length=2;
    let invoked=0;
    for(const get of [() => {invoked++; return entry;}, () => {invoked++; throw Error("executed accessor");}]) {
      const items: unknown[]=[];Object.defineProperty(items,"0",{get,enumerable:true});malformed.push(items);
    }
    const mapOverride: unknown[]=[];Object.defineProperty(mapOverride,"map",{value:()=>{invoked++;return []}});malformed.push(mapOverride);
    const iterator: unknown[]=[];Object.defineProperty(iterator,Symbol.iterator,{value:()=>{invoked++;throw Error("executed iterator")}});malformed.push(iterator);
    const decorated: unknown[]=[];Object.defineProperty(decorated,"extra",{value:1});malformed.push(decorated);
    const map=hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body/>/>'}});
    map.doc.must("page").css.stylesheet('.x{color:red}'); const before=map.capture(), root=map.doc.must("page").document, rev=map.rev;
    let commits=0;map.commits.observe(()=>commits++);
    for(const entries of malformed) {
      const record={rules:[],properties:[],keyframes:[],order:[{kind:"group",header:"@layer",entries}]};
      assert.throws(()=>decode_portable_document_stylesheet(record), /array|storage/i);
      const capture={...before,libraries:before.libraries.map(item => { const altered={...item}; Object.defineProperty(altered,"css",{value:record,enumerable:true});return altered; })};
      assert.throws(()=>map.restore(capture));
      assert.equal(map.doc.must("page").document,root);assert.equal(map.rev,rev);assert.equal(commits,0);assert.deepEqual(map.capture(),before);
      assert.throws(()=>install_libraries_snapshot(capture));
    }
    assert.equal(invoked,0,"indexed getters, iterators and methods must never execute");
    const empty={rules:[],properties:[],keyframes:[],order:[entry]};
    assert.deepEqual(encode_portable_document_stylesheet(decode_portable_document_stylesheet(empty)),empty);
    const shared: unknown[]=[];
    assert.equal(decode_portable_document_stylesheet({...empty,order:[{...entry,entries:shared},{...entry,entries:shared}]}).order.length,2);
    const cyclic: unknown[]=[];cyclic.push({...entry,entries:cyclic});
    assert.throws(()=>decode_portable_document_stylesheet({...empty,order:cyclic}),/Cyclic/);
    const valid=parse_document_stylesheet('@layer{@media screen{.x{color:red}}}',[]);
    const missing=structuredClone(valid);const top=missing.order[0]!;
    if(top.kind!=="group") throw Error("missing group");
    const nested=top.entries[0]!;if(nested.kind!=="group") throw Error("missing nested group");
    (nested.entries[0] as {ruleKey:string}).ruleKey="missing";
    assert.throws(()=>decode_portable_document_stylesheet(missing),/order disagrees/);
    for(const key of ["rules","properties","keyframes","order"] as const) assert.throws(()=>decode_portable_document_stylesheet({...empty,[key]:Array(1)}), /array|storage/i);
    const badScopes=structuredClone(valid);Object.defineProperty(badScopes.rules[0]!,"scopes",{value:Array(1)});
    assert.throws(()=>decode_portable_document_stylesheet(badScopes),/array|storage/i);
    const badPairs=structuredClone(valid);Object.defineProperty(badPairs.rules[0]!,"declarations",{value:[Array(2)]});
    assert.throws(()=>decode_portable_document_stylesheet(badPairs),/array|storage/i);
    const frames=parse_document_stylesheet('@keyframes a{from{opacity:.2}}',[]);
    Object.defineProperty(frames.keyframes[0]!,"steps",{value:Array(1)});
    assert.throws(()=>decode_portable_document_stylesheet(frames),/array|storage/i);
    map.doc.must("page").css.sel('.retry').set.color("green");assert.equal(map.rev,rev+1);assert.equal(commits,1);
  });

  check("CSS batch replay qualifies physical arrays before publication and preserves JSON closure", () => {
    const clear={domain:"css",kind:"clear-all"} as const;
    let invoked=0;
    const holesAtEnd:unknown[]=[clear];holesAtEnd.length=2;
    const bad:unknown[][]=[Array(1),[,clear],[clear,,clear],holesAtEnd];
    for(const get of [()=>{invoked++;return clear},()=>{invoked++;throw Error("executed indexed getter")}]) {
      const items:unknown[]=[];Object.defineProperty(items,"0",{get,enumerable:true});bad.push(items);
    }
    const method=[clear];Object.defineProperty(method,"map",{value(){invoked++;return [clear]}});bad.push(method);
    const iterator=[clear];Object.defineProperty(iterator,Symbol.iterator,{value(){invoked++;throw Error("executed iterator")}});bad.push(iterator);
    const decorated=[clear];Object.defineProperty(decorated,"extra",{value:1,enumerable:true});bad.push(decorated);
    const symbol=[clear];Object.defineProperty(symbol,Symbol("extra"),{value:1});bad.push(symbol);
    const hidden=[clear];Object.defineProperty(hidden,"0",{value:clear,enumerable:false});bad.push(hidden);
    const inherited:unknown[]=Array(1);Object.setPrototypeOf(inherited,Object.assign(Object.create(Array.prototype),{0:clear}));bad.push(inherited);
    const serialization=[clear];Object.defineProperty(serialization,"toJSON",{value(){invoked++;return [clear]}});bad.push(serialization);
    const make=()=>{const map=hsonLiveMap.fromLibraries({page:{document:'<html <head/> <body/>/>'}});map.doc.must("page").css.stylesheet('.x{color:orange}');return map};
    const map=make(), peer=make(), page=map.doc.must("page"), root=page.root(), owner=page.document, before=map.capture(), rev=map.rev;
    const commits:Parameters<typeof map.replay>[0][]=[];map.commits.observe(commit=>commits.push(commit));
    for(const operations of bad) {
      const batch={domain:"css",kind:"batch",operations};
      assert.throws(()=>canonical_portable_document_css_op(batch),TypeError);
      assert.throws(()=>map.replay({kind:"map",changed:true,prevRev:rev,rev:rev+1,operations:[{library:"page",operation:batch}]} as never),TypeError);
      assert.equal(map.rev,rev);assert.equal(page.css.snapshot(),'.x{color:orange;}');
      assert.deepEqual(map.capture(),before);assert.equal(commits.length,0);assert.deepEqual(page.root(),root);assert.equal(page.document,owner);
    }
    assert.equal(invoked,0,"source getters, methods, iterators and serialization hooks never execute");
    for(const operations of [[],[{domain:"css",kind:"batch",operations:[clear]}]]) {
      assert.throws(()=>canonical_portable_document_css_op({domain:"css",kind:"batch",operations}), /batch must contain|operation kind|operation fields/i);
    }
    const rule=(color:string)=>({domain:"css",kind:"rule",ruleKey:"final",scopes:[],rule:{ruleKey:"final",selector:".x",scopes:[],declarations:[["color",color]]}});
    const source={domain:"css",kind:"batch",operations:[rule("green"),clear,rule("blue")]};
    const admitted=canonical_portable_document_css_op(source);
    assert.deepEqual(JSON.parse(JSON.stringify(admitted)),source,"ordered canonical units survive JSON exactly");
    map.replay({kind:"map",changed:true,prevRev:rev,rev:rev+1,operations:[{library:"page",operation:admitted}]});
    assert.equal(map.rev,rev+1);assert.equal(commits.length,1);assert.equal(page.css.snapshot(),'.x{color:blue;}');
    assert.deepEqual(page.root(),root);assert.equal(page.document,owner);assert.deepEqual(commits[0]!.operations[0]!.operation,admitted);
    peer.replay(JSON.parse(JSON.stringify(commits[0])));
    assert.deepEqual(peer.capture(),map.capture());
    const after=map.capture(), count=commits.length;
    const current=decode_portable_document_stylesheet(after.libraries[0]!.css);
    assert.deepEqual(apply_portable_document_css_op(current,admitted),current,"unchanged final state stays a semantic no-op");
    assert.throws(()=>map.replay({kind:"map",changed:true,prevRev:map.rev,rev:map.rev+1,operations:[{library:"page",operation:admitted}]}),/semantic stylesheet change/);
    assert.equal(commits.length,count);assert.deepEqual(map.capture(),after);
  });

}
