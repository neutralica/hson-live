import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { read_livemap_part_internal as readPart, compose_livemap_document_internal as compose,
  prepare_hosted_livemap_library_add_internal as hostedAdd } from "../../src/api/livemap/livemap.libraries.ts";
import { part_collection_definition_internal as collection } from "../../src/api/livemap/livemap.parts.ts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { lookup_document_quad_internal as lookup, parse_authored_document_library } from "../../src/api/livemap/livemap.document.quad.ts";
import { expand_document_composition, document_composition_options, type DocumentCompositionOptions } from "../../src/api/livemap/livemap.document.composition.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { ROOT_TAG, ELEM_TAG, STR_TAG, VAL_TAG } from "../../src/core/constants.ts";
import { is_Node } from "../../src/core/node-guards.ts";
import { mint_hson_node_quid } from "../../src/core/hson-node-quid.ts";
import { overwrite_hson_node } from "../../src/api/livemap/livemap.editor.ts";
import { parse_hson_exact_runtime } from "../../src/internal/exact-runtime-hson-codec.ts";
import { livemap_document_identity_effects_for, type LiveMapDocumentIdentityEffect } from "../../src/api/livemap/livemap.document.identity.ts";
import type { HsonNode } from "../../src/core/types.ts";
import type { LiveMap, LiveMapDocumentLibrary, LiveMapGraphOp, LiveMapReplacementLineage } from "../../src/types/livemap.types.ts";
import { styled_composition_cases } from "./livemap-styled-composition-cases.mts";
import { document_css_state_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { document_css_subject_identities } from "../../src/internal/css/css-identity-translation.ts";
import { encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";

export const part = (document: string, css?: string) => ({ kind: "document", document, ...(css === undefined ? {} : { css }) });
export const doc = (map: LiveMap, name = "page"): LiveMapDocumentLibrary => {
  const selected = map.lib(name); if (selected.mode !== "document") throw Error("document"); return selected;
};
export const element = (source: string): HsonNode => {
  const first = hsonTransform.fromHson(source).toNode().$_content[0]; if (!is_Node(first)) throw Error("element"); return first;
};
const lineage_entry = (source: readonly number[], destination: readonly number[]): LiveMapReplacementLineage[number] => ({
  source: validate_document_path(source), destination: validate_document_path(destination),
});
export function atomic(map: LiveMap, run: () => unknown, reason?: RegExp) {
  const before = map.capture(), aggregate = owner(map), ledger = aggregate.identityEpoch().issued();
  const registry = aggregate.hostedRegistry(), epoch = aggregate.identityEpoch(), position = aggregate.hostedPosition();
  const ids = aggregate.libraries(), roots = ids.map(id => aggregate.root(id));
  const overlays = ids.map((id,index) => registry.libraries[index]?.mode === "document" ? aggregate.documentOverlay(id) : aggregate.projectedOverlay(id));
  let events = 0, positions = 0;
  const off = map.commits.observe(() => events++), stop = aggregate.observeAuthorityPosition(() => positions++);
  try { if (reason) assert.throws(run, reason); else assert.throws(run); } finally { off(); stop(); }
  assert.deepEqual(map.capture(), before); assert.equal(aggregate.identityEpoch().issued(), ledger);
  assert.equal(aggregate.hostedRegistry(), registry); assert.equal(aggregate.identityEpoch(), epoch); assert.deepEqual(aggregate.hostedPosition(), position);
  ids.forEach((id,index) => {
    assert.equal(aggregate.root(id), roots[index]);
    assert.equal(registry.libraries[index]?.mode === "document" ? aggregate.documentOverlay(id) : aggregate.projectedOverlay(id), overlays[index]);
  });
  assert.equal(events, 0); assert.equal(positions, 0);
}
function leaves(root: HsonNode): readonly unknown[] {
  return root.$_tag === STR_TAG || root.$_tag === VAL_TAG ? root.$_content : root.$_content.flatMap(child => is_Node(child) ? leaves(child) : [child]);
}
export function document_composition_cases(check: (name: string, run: () => void) => void) {
  check("retained-root CSS demand publishes with existing receiving identity and retires without retiring its QUAD", () => {
    for (const staged of [false,true]) {
      const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<button id="live"/>','button{color:rgb(10,20,30);padding-left:13px}')}),
        page:{document:'<html <head/> <body <button @:keep id="live"/> <button @:spare id="outside"/>/>/>'}}),p=doc(map),aggregate=owner(map);
      const subject=lookup(p,"keep")!,spare=lookup(p,"spare")!,handle=p.q("keep")!,id=aggregate.libraries()[1]!;
      const root=p.root(),overlay=aggregate.documentOverlay(id),ledger=aggregate.identityEpoch().issued();
      const demand=()=>document_css_subject_identities(encode_portable_document_stylesheet(document_css_state_internal(p)),"outbound");
      const observations:Readonly<{rev:number;demand:readonly string[];quid:string;active:boolean;css:string}>[]=[];
      const off=p.commits.observe(()=>observations.push({rev:map.rev,demand:demand(),quid:lookup(p,"keep")!.quid,active:handle.active,css:p.css.snapshot()}));
      const replace=(source:string)=>{
        const replacement=element(source),target={kind:"path" as const,path:validate_document_path(subject.path.slice(0,-1))},index=subject.path.at(-1)!;
        const lineage=[lineage_entry([],[])];
        return staged?map.batch(draft=>draft.lib("page").graph({domain:"graph",op:"replace-content",target,index,replacement,lineage}))
          :p.document.content.replace(target,index,replacement,lineage);
      };
      try {
        assert.equal(replace('<button id="live"/>').changed,false);assert.equal(map.rev,0);assert.equal(observations.length,0);
        assert.equal(aggregate.documentOverlay(id),overlay);assert.equal(aggregate.identityEpoch().issued(),ledger);
        const accepted=replace('<hson-part lib="parts" at="x"/>');assert.equal(accepted.changed,true);assert.equal(accepted.rev,1);
        assert.deepEqual(p.root(),root);assert.equal(observations.length,1);
        assert.deepEqual(observations[0],{rev:1,demand:[subject.quid],quid:subject.quid,active:true,css:p.css.snapshot()});
        assert.equal(lookup(p,"spare")!.quid,spare.quid);assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()),enumerate_livemap_issued_quids(ledger));
        assert.equal(replace('<button id="live"/>').changed,false);assert.equal(map.rev,1);assert.equal(observations.length,1);
        p.css.stylesheet(`[hson\\:quid="${subject.quid}"]{color:rgb(40,50,60)}`);
        assert.deepEqual(demand(),[subject.quid]);assert.equal(observations.length,2);assert.equal(observations[1]!.rev,2);
        p.css.clearAll();assert.equal(p.css.snapshot(),"");assert.deepEqual(demand(),[]);assert.equal(map.rev,3);assert.equal(observations.length,3);
        assert.deepEqual(observations[2],{rev:3,demand:[],quid:subject.quid,active:true,css:""});
        assert.equal(handle.active,true);assert.equal(handle.attrs.get("id"),"live");assert.equal(aggregate.documentOverlay(id).quidAtPath(subject.path),subject.quid);
        assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()),enumerate_livemap_issued_quids(ledger));assert.deepEqual(p.root(),root);
      } finally {off();}
    }
  });
  for (const batch of [false,true]) check(`${batch ? "batch graph" : "direct"} graph-equivalent Part replacement admits complete effects and preserves true no-ops`, () => {
    for (const marked of [false,true]) {
      const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<button/>','button{color:rgb(10,20,30);padding-left:13px}'),plain:part('<button/>'),empty:part('<button/>','')}),
        page:{document:marked?'<button @:keep/>':'<button/>'}}), p=doc(map),aggregate=owner(map),id=aggregate.libraries()[1]!;
      const handle=p.q("keep"),priorQuid=lookup(p,"keep")?.quid,graph=p.root(),initialLedger=aggregate.identityEpoch().issued();
      let commits=0,positions=0,effects:readonly LiveMapDocumentIdentityEffect[]=[];
      const off=map.commits.observe(()=>commits++),stop=aggregate.observeAuthorityPosition(()=>positions++);
      const observe=aggregate.observe(commit=>{const documentCommit=aggregate.documentCommitFor(id,commit);effects=documentCommit===undefined?[]:livemap_document_identity_effects_for(documentCommit)??[];});
      const replace=(member:string,lineage:LiveMapReplacementLineage=marked?[lineage_entry([],[])]:[])=>{
        const replacement=element(`<hson-part lib="parts" at="${member}"/>`);
        return batch?map.batch(draft=>draft.lib("page").graph({domain:"graph",op:"replace-content",target:{kind:"path",path:validate_document_path([])},index:0,replacement,lineage}))
          :p.document.content.replace({kind:"path",path:[]},0,replacement,lineage);
      };
      try {
        for(const member of ["plain","empty"]) {
          const before=map.capture(),overlay=aggregate.documentOverlay(id);
          const result=replace(member);assert.equal(result.changed,false);assert.equal(result.prevRev,0);assert.equal(result.rev,0);
          assert.deepEqual(map.capture(),before);assert.equal(aggregate.documentOverlay(id),overlay);assert.equal(aggregate.identityEpoch().issued(),initialLedger);
        }
        assert.equal(commits,0);assert.equal(positions,0);
        const result=replace("x");assert.equal(result.changed,true);assert.equal(result.prevRev,0);assert.equal(result.rev,1);
        assert.equal(map.rev,1);assert.equal(commits,1);assert.equal(positions,1);assert.deepEqual(p.root(),graph);
        const overlay=aggregate.documentOverlay(id),quid=overlay.quidAtPath(validate_document_path([0]));assert.ok(quid);assert.equal(overlay.size,1);
        assert.equal(aggregate.identityEpoch().issued().size,1);assert.ok(aggregate.identityEpoch().issued().has(quid));
        assert.equal(effects.filter(effect=>effect.kind==="introduced" && effect.quid!==priorQuid).length,marked?0:1);
        assert.ok(effects.every(effect=>effect.quid===quid));
        assert.equal(effects.some(effect=>effect.kind==="retired" && effect.quid!==priorQuid),false);
        if(marked){assert.equal(quid,priorQuid);assert.equal(handle!.active,true);assert.equal(lookup(p,"keep")!.quid,priorQuid);handle!.attrs.get("title");}
        else assert.equal(p.q("keep"),undefined);
        assert.match(p.css.snapshot(),/button:where\(:scope,:scope \*\)\{color:rgb\(10,20,30\);padding-left:13px;/);
        const before=map.capture(),ledger=aggregate.identityEpoch().issued();
        const noop=replace("empty",[lineage_entry([],[])]);assert.equal(noop.changed,false);assert.equal(noop.rev,1);
        assert.deepEqual(map.capture(),before);assert.equal(aggregate.identityEpoch().issued(),ledger);assert.equal(commits,1);assert.equal(positions,1);
      } finally {off();stop();observe();}
      const css=p.css.snapshot(),quid=aggregate.documentOverlay(id).quidAtPath(validate_document_path([0]))!;
      p.document.content.insert({kind:"path",path:[]},1,element('<i/>'));
      p.document.content.move({kind:"path",path:[]},0,1);assert.equal(p.css.snapshot(),css);
      assert.deepEqual(aggregate.documentOverlay(id).pathForQuid(quid),[1]);
      let current:LiveMap=map;const seen=new Set<string>([quid]);
      for(let cycle=0;cycle<2;cycle++) {
        current=install_libraries_snapshot(current.cut({data:[],documents:["page"]}).libs).map;
        const receiver=owner(current),receiverId=receiver.libraries()[0]!,rootQuid=receiver.documentOverlay(receiverId).quidAtPath(validate_document_path([1]));
        assert.ok(rootQuid);assert.equal(seen.has(rootQuid),false);seen.add(rootQuid);
        assert.match(doc(current).css.snapshot(),new RegExp(rootQuid));assert.match(doc(current).css.snapshot(),/padding-left:13px/);
        assert.equal(doc(current).q("keep")!==undefined,marked);assert.throws(()=>current.lib("parts"),/Unknown LiveMap Library/);
      }
      const receiver=owner(current),receiverId=receiver.libraries()[0]!,retiring=doc(current).q("keep"),rootQuid=receiver.documentOverlay(receiverId).quidAtPath(validate_document_path([1]))!;
      doc(current).document.content.remove({kind:"path",path:[]},1);
      assert.equal(doc(current).css.snapshot(),"");assert.equal(receiver.documentOverlay(receiverId).size,0);assert.ok(receiver.identityEpoch().issued().has(rootQuid));
      if(retiring)assert.equal(retiring.active,false);if(handle)assert.equal(handle.active,true);
    }
  });
  for (const batch of [false,true]) check(`${batch ? "batch graph" : "direct"} graph-equivalent Part effects fail atomically and retain reentrant inner work`, () => {
    const fixture=(extraCss='')=>hsonLiveMap.fromLibraries({parts:collection({x:part('<button/>',`button{color:red}${extraCss}`)}),state:{data:{n:0}},page:{document:'<button/>'}});
    const replace=(map:LiveMap)=>{
      const replacement=element('<hson-part lib="parts" at="x"/>');
      return batch?map.batch(draft=>{const selected=draft.lib("page");if(selected.mode!=="document")throw Error("document");return selected.graph({domain:"graph",op:"replace-content",target:{kind:"path",path:validate_document_path([])},index:0,replacement});})
        :doc(map).document.content.replace({kind:"path",path:[]},0,replacement);
    };
    const exhausted=fixture();allocator(owner(exhausted).identityEpoch().owner,()=>"invalid");
    try{atomic(exhausted,()=>replace(exhausted),/No available destination QUID for Part CSS subject/);}finally{allocator(owner(exhausted).identityEpoch().owner,undefined);}
    const conflict=fixture('@keyframes clash{from{opacity:0}}');doc(conflict).css.stylesheet('@keyframes clash{from{opacity:1}}');let calls=0;
    allocator(owner(conflict).identityEpoch().owner,()=>{calls++;return "123456789";});
    try{atomic(conflict,()=>replace(conflict),/Duplicate @keyframes/);}finally{allocator(owner(conflict).identityEpoch().owner,undefined);}assert.equal(calls,0);
    const managed=fixture(),manager={};owner(managed).claimManagement(manager);
    try{atomic(managed,()=>replace(managed),batch?/batch is unavailable while this map is managed/:/exclusive Locus authority/);}finally{owner(managed).releaseManagement(manager);}
    const reentrant=fixture(),beforeGraph=doc(reentrant).root();let entered=false,after:ReturnType<LiveMap["capture"]>|undefined,commits=0;
    const off=reentrant.commits.observe(()=>commits++);
    allocator(owner(reentrant).identityEpoch().owner,()=>{if(!entered){entered=true;reentrant.lib("state").at(["n"]).set(1);after=reentrant.capture();}return "123456789";});
    try{assert.throws(()=>replace(reentrant),/changed during capture/);}finally{allocator(owner(reentrant).identityEpoch().owner,undefined);off();}
    assert.equal(entered,true);assert.deepEqual(reentrant.capture(),after);assert.deepEqual(doc(reentrant).root(),beforeGraph);assert.equal(doc(reentrant).css.snapshot(),"");
    assert.equal(reentrant.rev,1);assert.equal(commits,1);assert.equal(owner(reentrant).identityEpoch().issued().size,0);
  });
  check("graph-equivalent Part replacement reuses receiving identity and preserves independent ancestor CSS and ownership-only effects", () => {
    for(const batch of [false,true]) for(const css of ['button{color:red}','@layer order{}']) {
      const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<button/>',css)}),page:{document:'<main @:ancestor <button @:keep/>/>'}}),p=doc(map),ancestor=p.q("ancestor")!,keep=p.q("keep")!;
      const rootQuid=lookup(p,"ancestor")!.quid,quid=lookup(p,"keep")!.quid,aggregate=owner(map);
      p.css.sel(`[hson\\:quid="${rootQuid}"]`).setProp('border-top','5px solid red');const revision=map.rev,ledgerSize=aggregate.identityEpoch().issued().size;let count=0;
      const off=map.commits.observe(()=>count++),replacement=element('<hson-part lib="parts" at="x"/>'),lineage=[lineage_entry([],[])];
      allocator(aggregate.identityEpoch().owner,()=>{throw Error("surviving subject must not allocate");});
      try{const result=batch?map.batch(draft=>draft.lib("page").graph({domain:"graph",op:"replace-content",target:{kind:"path",path:validate_document_path([0,0])},index:0,replacement,lineage}))
        :p.document.content.replace({kind:"path",path:[0,0]},0,replacement,lineage);assert.equal(result.changed,true);}
      finally{off();allocator(aggregate.identityEpoch().owner,undefined);}
      assert.equal(count,1);assert.equal(map.rev,revision+1);assert.equal(aggregate.identityEpoch().issued().size,ledgerSize);
      assert.equal(lookup(p,"keep")!.quid,quid);assert.equal(keep.active,true);assert.equal(ancestor.active,true);assert.match(p.css.snapshot(),/border-top:5px solid red/);
      keep.delete();assert.doesNotMatch(p.css.snapshot(),/color:red|@layer order/);assert.match(p.css.snapshot(),/border-top:5px solid red/);
      atomic(map,()=>p.document.content.remove({kind:"path",path:[]},0),/Correspondence requires an active subject/);
    }
  });
  check("Part collections are inert; authored documents eagerly realize nested exact coordinates", () => {
    const key = 'n/a "& 雪', lib = 'p/art 雪';
    const map = hsonLiveMap.fromLibraries({
      [lib]: collection({ [key]: part('<nav @:local <hson-part at="leaf" value="%{value}"/>/>'), leaf: part('<button @:local "%{value}"/>'),
        missing: part('<p <hson-part lib="absent" at="x"/>/>') }),
      page: { document: `<main @:page <hson-part @:first lib=${JSON.stringify(lib)} at=${JSON.stringify(key)} value="one"/> <hson-part lib=${JSON.stringify(lib)} at=${JSON.stringify(key)} value="two"/>/>` },
    });
    const page = doc(map), first = page.q("first")!;
    assert.deepEqual(leaves(page.root()), ["one", "two"]); assert.equal(first.path().at(-1), 0);
    assert.doesNotMatch(JSON.stringify(page.root()), /hson-part/);
    assert.equal(page.q("local"), undefined); assert.ok(page.q("page")); assert.equal("source" in page, false);
    assert.equal("template" in map, false); assert.equal("compose" in map, false);
    const before = page.root(), ledger = owner(map).identityEpoch().issued();
    const parts = map.lib(lib);
    parts.at(["leaf", "document"]).set('<i "edited definition"/>');
    assert.deepEqual(page.root(), before); assert.equal(owner(map).identityEpoch().issued().size, ledger.size);
    const restored = install_libraries_snapshot(map.cut({ documents: ["page"], data: [] }).libs).map;
    assert.deepEqual(leaves(doc(restored).root()), ["one", "two"]); assert.throws(() => restored.lib(lib));
    assert.equal(doc(restored).q("local"), undefined);
  });
  check("native template remains an ordinary native template, separate from construction connectors", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main <template <p "Kept"/>/>/>' } });
    assert.match(doc(map).render(), /<template><p>Kept<\/p><\/template>/);
    assert.doesNotMatch(JSON.stringify(doc(map).root()), /hson-part/);
  });
  check("missing and unavailable Parts fail immediately and do not publish a delayed consumer", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<p/>') }) });
    for (const connector of ['<hson-part lib="missing" at="x"/>', '<hson-part lib="parts" at="missing"/>', '<hson-part at="x"/>', '<hson-part lib="parts"/>']) {
      atomic(map, () => map.addLibraries({ bad: { document: connector } })); assert.throws(() => map.lib("bad"));
    }
    map.addLibraries({ missing: collection({ x: part('<i/>') }) }); assert.throws(() => map.lib("bad"));
    // One topology candidate resolves definitions regardless of entry order.
    map.addLibraries({ page: { document: '<hson-part lib="later" at="x"/>' }, later: collection({ x: part('<aside/>') }) });
    const realized = doc(map).root().$_content[0]; assert.ok(is_Node(realized)); assert.equal(realized.$_tag, "aside");
  });
  check("parameters preserve whole scalar types, nested forwarding, partial strings and exact escaping", () => {
    for (const value of ['"<& 雪💚', "", 7, true, false, null]) {
      const connector: HsonNode = { $_tag: "hson-part", $_attrs: { lib: "parts", at: "outer", value }, $_content: [] };
      const map = hsonLiveMap.fromLibraries({ parts: collection({
        outer: part('<section title="%{value}" data-note="prefix:%{value}:end" <hson-part at="leaf" value="%{value}"/>/>'),
        leaf: part('<button title="%{value}" "%{value}"/>'),
      }), page: { document: { $_tag: ROOT_TAG, $_content: [connector] } } });
      const root = doc(map).root(), outer = root.$_content[0]; if (!is_Node(outer)) throw Error("outer");
      assert.equal(outer.$_attrs?.title, value); assert.equal(outer.$_attrs?.["data-note"], `prefix:${value}:end`);
      assert.deepEqual(leaves(root), [String(value)]);
      const html = doc(map).render(); assert.doesNotMatch(html, /<雪|<script|hson-part/);
      if (typeof value === "string" && value) { assert.match(html, /&lt;/); assert.match(html, /&amp;/); assert.match(html, /&quot;/); }
    }
  });
  check("parameters reject missing, unknown, malformed, structural and invalid placement inputs atomically", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<p title="%{required}" "%{required}"/>'),
      malformed: part('<p "%{bad.name}"/>'), script: part('<script "%{code}"/>'), handler: part('<p onclick="%{code}"/>') }) });
    for (const source of ['<hson-part lib="parts" at="x"/>', '<hson-part lib="parts" at="x" required="ok" extra="x"/>',
      '<hson-part lib="parts" at="malformed"/>',
      '<hson-part lib="parts" at="x" required="ok" "content"/>', '<hson-part lib="parts" at="script" code="bad"/>', '<hson-part lib="parts" at="handler" code="bad"/>']) atomic(map, () => map.addLibraries({ bad: { document: source } }));
    assert.throws(() => collection({ style: part('<p style="color:%{color}"/>') }));
    const opaque: HsonNode = { $_tag: "hson-part", $_attrs: { lib: "parts", at: "x", style: { color: "red" } }, $_content: [] };
    atomic(map, () => map.addLibraries({ bad: { document: { $_tag: ROOT_TAG, $_content: [opaque] } } }), /parameter/);
  });
  check("ordinary runtime insertion and replacement realize before the first publication", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<section <button "%{value}"/>/>') }), page: { document: '<main <i/>/>' } });
    let seen = 0; const off = map.commits.observe(() => { seen++; assert.doesNotMatch(JSON.stringify(doc(map).root()), /hson-part/); });
    try {
      doc(map).document.content.insert({ kind: "path", path: [0, 0] }, 1, element('<hson-part lib="parts" at="x" value="inserted"/>'));
      assert.deepEqual(leaves(doc(map).root()), ["inserted"]);
      doc(map).document.content.replace({ kind: "path", path: [0, 0] }, 1, element('<hson-part lib="parts" at="x" value="replaced"/>'));
      assert.deepEqual(leaves(doc(map).root()), ["replaced"]);
    } finally { off(); }
    assert.equal(seen, 2);
    atomic(map, () => doc(map).document.content.insert({ kind: "path", path: [0, 0] }, 0, element('<hson-part lib="parts" at="absent"/>')));
  });
  for (const batch of [false, true]) check(`${batch ? "batch graph" : "direct"} replacement translates explicit lineage through Parts and preserves the complete receiving state`, () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<b <em/>/>', 'b{color:blue}@keyframes fresh{from{opacity:0}}'),
      old: part('<u/>', 'u{--retired:yes}@keyframes retired{from{opacity:0}}') }),
      page: { document: '<main @:keep <i @:child/> <hson-part @:retire lib="parts" at="old"/>/>' } });
    const page = doc(map), aggregate = owner(map), keep = page.q("keep")!, child = page.q("child")!, retired = page.q("retire")!;
    const rootQuid = lookup(page, "keep")!.quid, childQuid = lookup(page, "child")!.quid, retiredQuid = lookup(page, "retire")!.quid;
    page.css.sel(`[hson\\:quid="${rootQuid}"]`).setProp("border-top", "5px solid red");
    const beforeRevision = map.rev, issued = aggregate.identityEpoch().issued().size;
    const lineage: LiveMapReplacementLineage = [lineage_entry([], []), lineage_entry([0, 0], [0, 1])];
    let commits = 0, positions = 0, accepted: LiveMapGraphOp | undefined;
    const off = map.commits.observe(commit => {
      commits++;
      const op = commit.operations.find(entry => "op" in entry.operation && entry.operation.op === "replace-content")?.operation;
      if (op !== undefined && "op" in op && op.op === "replace-content") accepted = op;
      assert.equal(keep.active, true); assert.equal(child.active, true); assert.equal(retired.active, false);
      assert.equal(lookup(page, "keep")!.quid, rootQuid); assert.equal(lookup(page, "child")!.quid, childQuid);
      assert.match(page.css.snapshot(), /border-top:5px solid red/); assert.match(page.css.snapshot(), /color:blue/);
      assert.doesNotMatch(page.css.snapshot(), /retired/); assert.match(page.css.snapshot(), /@keyframes fresh/);
      assert.doesNotMatch(JSON.stringify(page.root()), /hson-part/);
      assert.equal(aggregate.documentOverlay(aggregate.libraries()[1]!).size, 3);
    }), stop = aggregate.observeAuthorityPosition(() => positions++);
    const replace = (input: LiveMapReplacementLineage) => {
      const replacement = element('<main <hson-part lib="parts" at="x"/> <i title="surviving"/>/>');
      if (batch) map.batch(draft => draft.lib("page").graph({ domain: "graph", op: "replace-content", target: { kind: "path", path: validate_document_path([]) }, index: 0, replacement, lineage: input }));
      else page.document.content.replace({ kind: "path", path: [] }, 0, replacement, input);
    };
    try { replace(lineage); } finally { off(); stop(); }
    assert.equal(commits, 1); assert.equal(positions, 1); assert.equal(map.rev, beforeRevision + 1);
    assert.ok(accepted?.op === "replace-content"); assert.deepEqual(accepted.lineage, lineage);
    assert.equal(aggregate.identityEpoch().issued().size, issued + 1);
    assert.ok(aggregate.identityEpoch().issued().has(rootQuid)); assert.ok(aggregate.identityEpoch().issued().has(childQuid));
    assert.ok(aggregate.identityEpoch().issued().has(retiredQuid)); assert.equal(page.document.byQuid(retiredQuid), undefined);
    assert.deepEqual(lookup(page, "keep")!.path, [0]); assert.deepEqual(lookup(page, "child")!.path, [0, 0, 1]);
    assert.equal(child.attrs.get("title"), "surviving");
    assert.equal(page.q("retire"), undefined); assert.equal(page.q("x"), undefined);
    // Missing source, carrier destination, invented Part descendant, and non-bijective mappings all roll back.
    for (const invalid of [
      [lineage_entry([9], [])], [lineage_entry([], [0])],
      [lineage_entry([], [0, 0, 0, 0])],
      [lineage_entry([], []), lineage_entry([0, 1], [])],
    ]) atomic(map, () => replace(invalid));
    // Retire the new Part alone: surviving independent ancestor CSS remains valid.
    const beforeRemove = page.css.snapshot();
    page.document.content.remove({ kind: "path", path: [0, 0] }, 0);
    assert.notEqual(page.css.snapshot(), beforeRemove); assert.doesNotMatch(page.css.snapshot(), /color:blue/);
    assert.doesNotMatch(page.css.snapshot(), /@keyframes fresh/);
    assert.match(page.css.snapshot(), /border-top:5px solid red/); assert.equal(keep.active, true); assert.equal(child.active, true);
    atomic(map, () => keep.delete()); // Independent authored CSS still fails closed.
  });
  check("connector replacement correspondence is explicit and cannot name generated Part descendants", () => {
    for (const batch of [false,true]) for (const preserve of [false,true]) {
      const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<section <b/>/>','section{color:red}') }),page:{document:'<main @:keep/>'}});
      const p=doc(map),keep=p.q("keep")!,prior=lookup(p,"keep")!.quid;
      const replacement=element('<hson-part lib="parts" at="x"/>'),lineage:LiveMapReplacementLineage=preserve?[lineage_entry([],[])]:[];
      if(batch) map.batch(draft=>draft.lib("page").graph({domain:"graph",op:"replace-content",target:{kind:"path",path:validate_document_path([])},index:0,replacement,lineage}));
      else p.document.content.replace({kind:"path",path:[]},0,replacement,lineage);
      assert.equal(keep.active,preserve);assert.equal(p.q("keep")!==undefined,preserve);
      const overlay=owner(map).documentOverlay(owner(map).libraries()[1]!);
      assert.equal(overlay.size,1);assert.equal(overlay.quidAtPath(validate_document_path([0]))===prior,preserve);
      assert.equal(overlay.quidAtPath(validate_document_path([0,0,0])),undefined);
    }
  });
  check("reentrant connector input capture rejects the outer edit and preserves accepted inner data work", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<p/>') }), state: { data: { n: 0 } }, page: { document: '<main <i/>/>' } });
    const before = doc(map).root(); let entered = false;
    const connector = new Proxy(element('<hson-part lib="parts" at="x"/>'), { ownKeys(target) {
      if (!entered) { entered = true; map.lib("state").at(["n"]).set(1); }
      return Reflect.ownKeys(target);
    } });
    assert.throws(() => doc(map).document.content.insert({ kind: "path", path: [0, 0] }, 1, connector), /changed/);
    assert.equal(entered, true); assert.equal(map.lib("state").at(["n"]).snap(), 1);
    assert.deepEqual(doc(map).root(), before); assert.equal(map.rev, 1);
  });
  check("batch construction reads coherent final Part definitions in either operation order", () => {
    for (const consumerFirst of [true, false]) {
      const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<p "old"/>') }), page: { document: '<main <i/>/>' } });
      map.batch(draft => {
        const consumer = () => draft.lib("page").content.insert({ kind: "path", path: validate_document_path([0, 0]) }, 1, element('<hson-part lib="parts" at="x"/>'));
        const definition = () => draft.lib("parts").at(["x", "document"]).set('<p "new"/>');
        if (consumerFirst) { consumer(); definition(); } else { definition(); consumer(); }
      });
      assert.deepEqual(leaves(doc(map).root()), ["new"]);
    }
  });
  check("cycles, malformed Part roots, schemas and bounded traversal fail atomically", () => {
    const map = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<p <hson-part at="y"/>/>'), y: part('<i <hson-part at="x"/>/>') }) });
    atomic(map, () => map.addLibraries({ bad: { document: '<hson-part lib="parts" at="x"/>' } }), /cycle/);
    assert.throws(() => collection({ bad: part('<p/> <q/>') }), /one ordinary/);
    const shell = parse_authored_document_library('<main <hson-part lib="parts" at="x"/>/>');
    assert.throws(() => expand_document_composition("shell", () => ({ root: shell.root }), document_composition_options({ maxDepth: 2 }),
      () => ({ root: parse_authored_document_library('<section <b/>/>').root })), /depth/);
    for (const limits of [{ maxNodes: 1 }, { maxCharacters: 1 }]) assert.throws(() => expand_document_composition("shell", () => ({ root: shell.root }), document_composition_options(limits),
      () => ({ root: parse_authored_document_library('<p/>').root })), /limit/);
    assert.throws(() => document_composition_options({ configuration: { as: "old" } }), /Unknown/);
    assert.equal(document_composition_options({ configuration: { q: "new" } }).configuration?.q, "new");
  });
  check("private structural q promotion remains explicit and the former control fails at every depth", () => {
    const parts = hsonLiveMap.fromLibraries({ parts: collection({ x: part('<section @:body as="authored" <b @:label "Text"/>/>') }) });
    const shell = parse_authored_document_library('<main @:shell <hson-part @:slot lib="parts" at="x"/>/>');
    const result = expand_document_composition("shell", () => ({ root: shell.root, quads: shell.declarations }),
      document_composition_options({ configuration: { at: { slot: { at: { label: { q: "caption" } } } } } }), (lib, at) => readPart(parts, lib, at));
    assert.deepEqual(result.quads?.map(entry => entry.name), ["caption", "shell", "slot"]);
    assert.match(JSON.stringify(result.root), /"as":"authored"/);
    for (const configuration of [{ as: "old" }, { at: { slot: { as: "old" } } }, { at: { slot: { at: { label: { as: "old" } } } } }])
      assert.throws(() => document_composition_options({ configuration }), /Unknown/);
  });
  check("canonical restore is source-free and rejects residual construction instructions", () => {
    const map = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
    const snapshot = structuredClone(map.capture());
    const forged = { ...snapshot, libraries: snapshot.libraries.map(entry => ({ ...entry, root: { ...entry.root, payload: entry.root.payload.replace('main', 'hson-part') } })) };
    assert.throws(() => install_libraries_snapshot(forged));
    assert.equal("source" in snapshot.libraries[0]!, false);
    assert.equal(ELEM_TAG, "_hson_elem");
  });
  styled_composition_cases(check);
  retained_composition_cases(check);
}

// The automatic-admission cut superseded inert-shell fixtures. Keep their
// distinct structural/configuration proofs at the existing private traversal,
// and their authority/Schema proofs at ordinary admission, without a source store.
function retained_composition_cases(check: (name: string, run: () => void) => void) {
  const source = (text: string) => {
    const parsed = text === "" ? { root: { $_tag: ROOT_TAG, $_content: [] }, declarations: [] } : parse_authored_document_library(text);
    return { root: parsed.root, quads: parsed.declarations };
  };
  const definitions = {
    panel: '<section @:panel title="Panel" <h2 @:heading "Default"/> <div @:body <hson-part @:action at="primary"/>/>/>',
    primary: '<button @:button title="Primary" "Go"/>', secondary: '<a @:button title="Secondary" "Alternate"/>',
  };
  const shell = '<main @:page <hson-part @:first lib="parts" at="panel"/> <hson-part @:second lib="parts" at="panel"/> <footer @:tail/>/>';
  const traverse = (text = shell, configuration?: DocumentCompositionOptions["configuration"]) => expand_document_composition("shell", () => source(text),
    document_composition_options(configuration === undefined ? undefined : { configuration }), (lib, at) => {
      const selected = lib === "other" && at === "secondary" ? '<aside @:button title="Other" "Other"/>' : lib === "parts" ? Reflect.get(definitions, at) : undefined;
      if (typeof selected !== "string") throw Error("Unknown Part"); return source(selected);
    });
  check("retained structural coverage: forest coordinates exact cross-collection context and one read per pair", () => {
    const selected = source('<button/>'); let reads = 0;
    const result = expand_document_composition("shell", () => source('"before" <i @:before/> <main @:page <hson-part @:one lib="a/b" at=""/> <hson-part @:two lib="a/b" at=""/> <footer @:tail/>/> <b @:after/> "after"'), document_composition_options(undefined),
      (lib, at) => { assert.equal(lib, "a/b"); assert.equal(at, ""); reads++; return selected; });
    assert.equal(reads, 1);
    assert.deepEqual(result.quads, [{name:"after",path:[3]}, {name:"before",path:[1]}, {name:"one",path:[2,0,0]}, {name:"page",path:[2]}, {name:"tail",path:[2,0,2]}, {name:"two",path:[2,0,1]}]);
    assert.deepEqual(leaves(result.root), ["before", "after"]);
    for (const text of ['', '"" <i/> "text" <b/>', '"left" "right"', '<template <p/>/>']) assert.deepEqual(traverse(text).root, structuredClone(source(text).root));
  });
  check("retained structural coverage: reusable JS HsonData Transform and governed configurations are equivalent", () => {
    const first = { attrs: {title:"First"}, at: { heading: {q:"caption",text:"One"}, body:{at:{action:{use:{at:"secondary"},text:""}}} } };
    const configuration = {at:{first,second:{at:{action:{use:{lib:"other",at:"secondary"},text:"Cross"}}}}};
    const map = hsonLiveMap.fromLibraries({config:{data:configuration}});
    const expected = traverse(shell, configuration), before = JSON.stringify(configuration);
    for (const input of [Hson.data.from(configuration), Hson.data.from(hsonTransform.fromJson(configuration).toJson().value()),
      Hson.data.from(map.lib("config").snap()), JSON.parse(before)]) assert.deepEqual(traverse(shell, input), expected);
    assert.equal(JSON.stringify(configuration), before); assert.deepEqual(leaves(expected.root), ["One", "", "Default", "Cross"]);
    assert.deepEqual(expected.quads?.find(entry => entry.name === "caption")?.path, [0,0,0,0,0]);
    const shared = {at:{heading:{text:"Shared"}}};
    assert.deepEqual(leaves(traverse(shell,{at:{first:shared,second:shared}}).root), ["Shared","Go","Shared","Go"]);
    const hostile = traverse('<main <p @:constructor "First"/> <p @:__proto__ "Second"/>/>', JSON.parse('{"at":{"constructor":{"text":"One"},"__proto__":{"text":"Two"}}}'));
    assert.deepEqual(leaves(hostile.root), ["One","Two"]);
    assert.equal(is_Node(expected.root.$_content[0]) && is_Node(expected.root.$_content[0].$_content[0]) && is_Node(expected.root.$_content[0].$_content[0].$_content[0])
      ? expected.root.$_content[0].$_content[0].$_content[0].$_attrs?.title : undefined,"First");
    assert.equal(traverse(shell,{q:"page",at:{first:{q:"first"}}}).quads?.length,4);
  });
  check("retained structural coverage: exact configuration descriptors recursive scope cardinality and resource limits", () => {
    const cyclic: Record<string,unknown> = {}; cyclic.at = {first:cyclic};
    const accessor = {}; Object.defineProperty(accessor,"q",{enumerable:true,get(){throw Error("getter ran");}});
    const hidden = {}; Object.defineProperty(hidden,"text",{value:""});
    for (const configuration of [null, [], cyclic, accessor, hidden, {text:undefined}, {as:"legacy"},
      {at:{first:{use:{quad:"panel"}}}}, {at:{first:{use:{at:"panel",quad:"panel"}}}}, {at:{first:{use:{lib:"parts"}}}},
      {at:{first:{use:{at:"panel",lib:undefined}}}}, {at:{first:{attrs:{title:false}}}}, {at:{first:{q:false}}},
      {at:{first:{at:{"invalid name":{}}}}}, {at:{first:{at:{heading:{use:{at:"primary"}}}}}},
      {at:{heading:{}}}, {at:{first:{at:{tail:{}}}}}, {at:{first:{at:{body:{at:{heading:{}}}}}}},
      {at:{first:{at:{panel:{at:{panel:{}}}}}}}, {at:{first:{q:"renamed"}}}, {at:{first:{q:"page"}}},
      {q:"bad name"}, {q:""},
      {at:{first:{at:{heading:{q:"duplicate"}}},second:{at:{heading:{q:"duplicate"}}}}}]) {
      assert.throws(() => Reflect.apply(traverse,undefined,[shell,configuration]));
    }
    assert.equal(leaves(traverse(shell,Object.assign(Object.create(null),{at:{first:{at:{heading:{text:"Allowed"}}}}})).root)[0],"Allowed");
    for (const value of ['<p/>', 'garbage', Hson.data.from(null), Hson.data.from([]), Hson.data.from("text")]) assert.throws(() => Reflect.apply(traverse,undefined,[shell,value]));
    for (const key of ["maxDepth","maxNodes","maxCharacters"]) for (const value of [0,-1,1.5,NaN,Infinity,4_000_001]) assert.throws(() => document_composition_options({[key]:value}));
    const excessive: Record<string,unknown> = {}; let current = excessive;
    for (let i=0;i<130;i++) {const child={};current.at={target:child};current=child;}
    assert.throws(() => document_composition_options({configuration:excessive}), /depth/);
    assert.throws(() => document_composition_options({configuration:{text:"x".repeat(4_000_001)}}), /limit/);
    for (const text of ['', '"text"', '<i/> <b/>', '"before" <i/>']) assert.throws(() => traverse(text,{q:"received"}), /exactly one/);
    for(const q of ["constructor","__proto__","Pascal_Name"])assert.deepEqual(traverse('<p/>',{q}).quads,[{name:q,path:[0]}]);
  });
  check("retained structural coverage: root string customization empty text exact HTML SVG and identity stripping", () => {
    for (const configuration of [{}, {attrs:{title:"Changed"}}, {text:""}, {attrs:{title:""},text:"Read"}]) {
      const result = traverse('<p title="Default" "Text"/>',configuration);
      assert.equal(result.root.$_content[0] && is_Node(result.root.$_content[0]) ? result.root.$_content[0].$_attrs?.title : undefined, configuration.attrs?.title ?? "Default");
      assert.deepEqual(leaves(result.root), [configuration.text ?? "Text"]);
    }
    for (const text of ['<p/>','<p <b/>/>','<p "one" "two"/>']) assert.throws(() => traverse(text,{text:""}), /sole immediate/);
    for (const configuration of [{attrs:{missing:"x"}}, {attrs:{style:"color:red"}}]) assert.throws(() => traverse('<p title="Default" "Text"/>',configuration));
    const html = {root:doc(hsonLiveMap.fromLibraries({page:{document:hsonTransform.fromTrustedHtml('<p title="Default">Text</p>').toNode()}})).root()};
    const result = expand_document_composition("html",()=>html,document_composition_options({configuration:{attrs:{title:""},text:""}}),()=>{throw Error("unused");});
    assert.deepEqual(result.root,traverse('<p title="Default" "Text"/>',{attrs:{title:""},text:""}).root);
    const svg = traverse('<svg viewBox="0 0 1 1"/>',{attrs:{viewBox:"0 0 2 2"}});
    assert.match(JSON.stringify(svg.root),/0 0 2 2/);
    const exact = parse_hson_exact_runtime('<main @000009001 <p @000009002 "Text"/>/>',{allowTopLevelDocumentText:true});
    const stripped = expand_document_composition("exact",()=>({root:exact}),document_composition_options(undefined),()=>{throw Error("unused");});
    assert.doesNotMatch(JSON.stringify(stripped.root),/quid|00000900/);
  });
  check("retained admission coverage: direct indirect and cross-collection cycles exact controls and ungoverned sources", () => {
    for (const [a,b] of [['<section <hson-part at="a"/>/>','<aside/>'], ['<section <hson-part at="b"/>/>','<aside <hson-part at="a"/>/>'],
      ['<section <hson-part lib="other" at="b"/>/>','<aside <hson-part lib="parts" at="a"/>/>']]) {
      const map=hsonLiveMap.fromLibraries({parts:collection({a:part(a),b:part(b)}),other:collection({b:part(b)})});
      atomic(map,()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="a"/>'}}),/cycle/);
    }
    const map=hsonLiveMap.fromLibraries({parts:collection({one:part('<p/>')}),ordinary:{data:{one:part('<p/>')}},other:{document:'<p/>'}});
    for(const controls of ['lib="ordinary" at="one"','lib="other" at="one"','LIB="parts" AT="one"','lib="parts" at="One"','lib="parts" quad="one"','lib="" at="one"']) atomic(map,()=>map.addLibraries({bad:{document:`<hson-part ${controls}/>`}}));
    assert.throws(()=>map.addLibraries({bad:{document:'<hson-part lib="parts" lib="other" at="one"/>'}}));
    const privateCycle=source('<section <hson-part @:loop at="safe"/>/>');
    assert.throws(()=>expand_document_composition("shell",()=>source('<hson-part @:slot lib="parts" at="outer"/>'),
      document_composition_options({configuration:{at:{slot:{at:{loop:{use:{at:"outer"}}}}}}}),(_lib,at)=>at==="outer"?privateCycle:source('<p/>')),/cycle/);
  });
  check("retained admission coverage: unselected collection corruption fails before publication and valid Schema remains governing", () => {
    const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<p/>')}),page:{document:'<main/>'}}),aggregate=owner(map);
    const raw=aggregate.root(aggregate.libraries()[0]!), original=map.lib("parts").root();
    const before=map.capture(),ledger=aggregate.identityEpoch().issued(),position=aggregate.hostedPosition();let published=0;
    const stop=map.commits.observe(()=>published++);
    overwrite_hson_node(raw,hsonTransform.fromJson({x:part('<p/>'),late:part('<p')}).toNode());
    try {assert.throws(()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}));}
    finally {overwrite_hson_node(raw,original);stop();}
    assert.deepEqual(map.capture(),before);assert.equal(aggregate.identityEpoch().issued(),ledger);assert.deepEqual(aggregate.hostedPosition(),position);assert.equal(published,0);
    const schema=Hson.schema`<type "document" tag "p" content "empty">`;
    map.addLibraries({valid:{document:'<hson-part lib="parts" at="x"/>',schema}});
    assert.equal(doc(map,"valid").schema.get(),schema);
    atomic(map,()=>doc(map,"valid").document.content.replace({kind:"path",path:[]},0,element('<i/>')));
    map.lib("parts").at(["x","document"]).set('<i/>');
    atomic(map,()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>',schema}}));
  });
  check("retained authority coverage: prepared discard stale reuse exclusive management and both incomplete identity phases", () => {
    const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<p/>')}),page:{document:'<main/>'}}),aggregate=owner(map),manager={};
    aggregate.claimManagement(manager);
    try {
      atomic(map,()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}),/exclusive/);
      const discarded=hostedAdd(map,manager,{discarded:{document:'<aside/>'}});aggregate.discard(discarded.transition);
      atomic(map,()=>aggregate.accept(discarded.transition,"isolate",discarded.afterInstall),/discarded/);
      const stale=hostedAdd(map,manager,{stale:{document:'<i/>'}}),accepted=hostedAdd(map,manager,{accepted:{document:'<footer/>'}});
      aggregate.accept(accepted.transition,"isolate",accepted.afterInstall);
      atomic(map,()=>aggregate.accept(accepted.transition,"isolate",accepted.afterInstall),/already accepted/);
      atomic(map,()=>aggregate.accept(stale.transition,"isolate",stale.afterInstall),/stale/);
    } finally {aggregate.releaseManagement(manager);}
    for(const phase of ["preflight","realize"]) {
      let entered=false;const attempt=()=>{entered=true;map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}});};
      atomic(map,()=>aggregate.acquireLocalDocumentIdentity(aggregate.libraries()[1]!,validate_document_path([0]),mint_hson_node_quid(),{
        preflight(){if(phase==="preflight")attempt();return{apply(){},rollback(){},release(){}};},realize(){if(phase==="realize")attempt();},rollbackRealization(){},
      }),/incomplete identity/);assert.equal(entered,true);
    }
    atomic(map,()=>map.batch(()=>{map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}});}),/batch|staged/i);
  });
  check("retained private traversal coverage: current shell landmarks survive moves and retired addresses reject", () => {
    const map=hsonLiveMap.fromLibraries({layout:{document:'<main <p @:heading "Before"/> <aside/>/>'}}),layout=doc(map,"layout");
    layout.document.content.move({kind:"path",path:[0,0]},0,1);
    const result=compose(map,"layout","page",{configuration:{at:{heading:{text:"Moved"}}}});
    assert.deepEqual(lookup(result,"heading")?.path,[0,0,1]);assert.deepEqual(leaves(result.root()),["Moved"]);
    assert.notEqual(lookup(result,"heading")!.quid,lookup(layout,"heading")!.quid);
    const derived=compose(map,"page","derived");assert.deepEqual(derived.root(),result.root());assert.notEqual(lookup(derived,"heading")!.quid,lookup(result,"heading")!.quid);
    layout.document.content.replace({kind:"path",path:[0,0]},1,element('<p/>'));
    atomic(map,()=>compose(map,"layout","bad",{configuration:{at:{heading:{}}}}),/Unknown composition QUAD/);
    layout.css.sel('main').setProp('color','red');atomic(map,()=>compose(map,"layout","bad"),/managed stylesheet/);
  });
  check("retained admission coverage: one complete addition independent inline storage and selected empty/ordering/global CSS", () => {
    for(const css of [undefined,'','@layer first{}@layer second{}','@property --tone{syntax:"*";inherits:false}','@keyframes once{from{opacity:0}}']) {
      const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<a style="color:blue" "Text"/>',css),unused:part('<p/>','p{--unvisited:yes}')})}),aggregate=owner(map);
      const before=map.capture(),root=aggregate.root(aggregate.libraries()[0]!);let commits=0;
      const off=map.commits.observe(()=>{commits++;assert.doesNotMatch(JSON.stringify(doc(map).root()),/hson-part/);});
      try{map.addLibraries({page:{document:'<main <hson-part lib="parts" at="x"/> <hson-part lib="parts" at="x"/>/>'}});}
      catch(error){
        // Global definitions intentionally conflict across occurrences.
        if(css?.startsWith('@property')||css?.startsWith('@keyframes')){assert.match(String(error),/Duplicate @/);assert.equal(commits,0);assert.deepEqual(map.capture(),before);continue;}
        throw error;
      }finally{off();}
      assert.equal(commits,1);assert.equal(map.rev,1);assert.equal(aggregate.root(aggregate.libraries()[0]!),root);
      assert.deepEqual(map.capture().libraries[0],before.libraries[0]);assert.doesNotMatch(doc(map).css.snapshot(),/unvisited/);
      const graph=aggregate.root(aggregate.libraries()[1]!);
      const main=graph.$_content[0];if(!is_Node(main)||!is_Node(main.$_content[0]))throw Error("main");
      const [a,b]=main.$_content[0].$_content;if(!is_Node(a)||!is_Node(b))throw Error("links");
      assert.notEqual(a,b);assert.notEqual(a.$_attrs,b.$_attrs);assert.notEqual(a.$_attrs?.style,b.$_attrs?.style);assert.notEqual(a.$_content,b.$_content);
      doc(map).document.attrs.set({kind:"path",path:[0,0,0]},'title','Edited');assert.equal(doc(map).document.attrs.get({kind:"path",path:[0,0,1]},'title'),undefined);
      if(!css)assert.match(doc(map).render(),/color.*blue/);
      else assert.match(doc(map).css.snapshot(),/@layer first/);
      assert.equal(aggregate.documentOverlay(aggregate.libraries()[1]!).size,css?2:0);
    }
    const structural=hsonLiveMap.fromLibraries({parts:collection({x:part('<section <style "p{color:red}"/>/>')}),page:{document:'<hson-part lib="parts" at="x"/>'}});
    assert.deepEqual(leaves(doc(structural).root()),['p{color:red}']);assert.equal(doc(structural).css.snapshot(),'');
  });
  check("retained authority coverage: configuration reflection and source reads fence every independently accepted inner change", () => {
    for(const phase of ["configuration","source"]) for(const change of ["data","identity","authority","topology"]) {
      const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<p/>')}),page:{document:'<main/>'}}),aggregate=owner(map);
      let entered=false,after:ReturnType<LiveMap["capture"]>|undefined;
      const inner=()=>{entered=true;
        if(change==="data")map.lib("parts").at(["x","document"]).set('<i/>');
        else if(change==="identity")aggregate.acquireLocalDocumentIdentity(aggregate.libraries()[1]!,validate_document_path([0]),mint_hson_node_quid());
        else if(change==="authority")aggregate.setInitialHostedAuthority({...aggregate.hostedPosition().authority});
        else map.addLibraries({inner:{document:'<aside/>'}});
        after=map.capture();
      };
      if(phase==="configuration") {
        const configuration=new Proxy({}, {ownKeys(target){if(!entered)inner();return Reflect.ownKeys(target);}});
        assert.throws(()=>compose(map,"page","bad",{configuration}),/changed during capture/);
      } else {
        const raw=aggregate.root(aggregate.libraries()[0]!),descriptor=Object.getOwnPropertyDescriptor(Reflect,"getOwnPropertyDescriptor")!,original=Reflect.getOwnPropertyDescriptor;
        Object.defineProperty(Reflect,"getOwnPropertyDescriptor",{...descriptor,value(input:object,key:PropertyKey){
          if(!entered&&input===raw&&key==="$_tag")inner();return original(input,key);
        }});
        try{assert.throws(()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}),/changed during capture/);}
        finally{Object.defineProperty(Reflect,"getOwnPropertyDescriptor",descriptor);}
      }
      assert.equal(entered,true);assert.deepEqual(map.capture(),after);assert.throws(()=>map.lib("bad"));
    }
  });
  check("retained authority coverage: detached private candidates keep coherent values and late management/staleness retains inner work", () => {
    const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<p/>')}),page:{document:'<main "Before"/>'}});
    const descriptor=Object.getOwnPropertyDescriptor(Object,"freeze")!,freeze=Object.freeze;let entered=false;
    Object.defineProperty(Object,"freeze",{...descriptor,value<T>(value:T):Readonly<T>{
      if(!entered&&typeof value==="object"&&value!==null&&Reflect.get(value,"name")==="derived"&&Object.hasOwn(value,"hsonSchema")){
        entered=true;map.lib("parts").at(["x","document"]).set('<i/>');
      }return freeze(value);
    }});
    try{assert.deepEqual(leaves(compose(map,"page","derived").root()),["Before"]);}
    finally{Object.defineProperty(Object,"freeze",descriptor);}
    assert.equal(entered,true);assert.equal(map.rev,2);
    for(const management of [true,false]) {
      const m=hsonLiveMap.fromLibraries({parts:collection({x:part('<p/>')})}),aggregate=owner(m),manager={};
      const descriptor=Object.getOwnPropertyDescriptor(Object.prototype,"toJSON");let entered=false;
      Object.defineProperty(Object.prototype,"toJSON",{configurable:true,value(this:unknown){
        if(!entered&&typeof this==="object"&&this!==null&&Reflect.get(this,"kind")==="library-add"){
          entered=true;if(management)aggregate.claimManagement(manager);else m.lib("parts").at(["x","document"]).set('<i/>');
        }return this;
      }});
      try{assert.throws(()=>m.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}),/exclusive|changed|stale|revisions/);}
      finally{if(descriptor===undefined)Reflect.deleteProperty(Object.prototype,"toJSON");else Object.defineProperty(Object.prototype,"toJSON",descriptor);if(management)aggregate.releaseManagement(manager);}
      assert.equal(entered,true);assert.throws(()=>m.lib("bad"));
      assert.equal(m.rev,management?0:1);if(!management)assert.equal(m.lib("parts").at(["x","document"]).snap(),'<i/>');
    }
  });
  check("retained authority coverage: a completed inner styled admission survives outer allocation rejection", () => {
    const map=hsonLiveMap.fromLibraries({parts:collection({x:part('<p/>','p{color:red}')})}),aggregate=owner(map);
    let entered=false,after:ReturnType<LiveMap["capture"]>|undefined;
    allocator(aggregate.identityEpoch().owner,()=>{
      if(!entered){entered=true;map.addLibraries({inner:{document:'<hson-part lib="parts" at="x"/>'}});after=map.capture();}
      return mint_hson_node_quid();
    });
    try{assert.throws(()=>map.addLibraries({bad:{document:'<hson-part lib="parts" at="x"/>'}}),/changed|stale/);}
    finally{allocator(aggregate.identityEpoch().owner,undefined);}
    assert.equal(entered,true);assert.deepEqual(map.capture(),after);assert.equal(map.rev,1);assert.equal(aggregate.identityEpoch().issued().size,1);
    assert.match(doc(map,"inner").css.snapshot(),/color:red/);assert.throws(()=>map.lib("bad"));
  });
}
