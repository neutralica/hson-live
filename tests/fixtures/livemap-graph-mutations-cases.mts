import assert from "node:assert/strict";
import { canonical_graph_equal } from "../../src/api/livemap/livemap.document.install.js";
import { Hson, hsonLiveMap, ANY_DATA } from "../../src/index.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { make_livemap_registry_authority } from "../../src/api/livemap/livemap.core.js";
import { make_livemap_transition_controller } from "../../src/api/livemap/livemap.authority.js";
import { make_livemap_staged_writer } from "../../src/api/livemap/livemap.staged.js";
import { create_locus_hosted_aggregate_internal } from "../../src/api/locus/locus.aggregate.js";
import type { PreparedLiveMapAuthorityTransition } from "../../src/api/livemap/livemap.authority.js";
import { projected_value_to_hson_node } from "../../src/core/projected-value-graph.js";
import { ordered_projected_array, ordered_projected_object } from "../../src/core/ordered-projected-value.js";
import { clone_live_root, resolve_wrapper_node, set_live_path_from_projected } from "../../src/api/livemap/livemap.editor.js";
import { compose_client_portable_aggregate_internal } from "../../src/api/echo/echo.projection.js";
import { create_echo_aggregate_replica_capability_internal } from "../../src/api/echo/echo.aggregate-replica.lifecycle.js";
import { make_portable_aggregate_snapshot, make_portable_aggregate_commit } from "../../src/api/livemap/livemap.hosted.js";
import { HSON_MAX_NESTING, ROOT_TAG, ARR_TAG } from "../../src/core/constants.js";
import type { JsonValue } from "../../src/core/types.js";
import type { LiveMapAggregateCommit } from "../../src/api/livemap/livemap.library.js";
import { livemap_equal_effect_replay_cases } from "./livemap-equal-effect-replay-cases.mts";

type Check = (name: string, run: () => void | Promise<void>) => Promise<void>;
export async function livemap_graph_mutation_cases(check: Check): Promise<void> {
  await livemap_equal_effect_replay_cases(check);
  await check("preparation edits one evolving private graph and keeps an independent stale witness", () => {
    const map = hsonLiveMap.fromLibraries({state:{data:{nested:{n:0,keep:true},rows:[0,1]}}});
    const engine = internal_livemap_aggregate_authority(map), id = engine.libraries()[0]!;
    const root = engine.root(id), before = structuredClone(root);
    const detached = clone_live_root(root);
    const originalItem = resolve_wrapper_node(root, ["rows", 0]);
    const copiedItem = resolve_wrapper_node(detached, ["rows", 0]);
    assert.ok(originalItem?.$_meta && copiedItem?.$_meta);
    assert.notEqual(originalItem.$_meta, copiedItem.$_meta);
    copiedItem.$_meta.index = "99";
    assert.equal(originalItem.$_meta.index, "0");
    const t = engine.prepare([
      {target:engine.target(id,["nested"]),kind:"set",value:ordered_projected_object([["n",2]])},
      {target:engine.target(id,["nested","n"]),kind:"set",value:3},
      {target:engine.target(id,["rows"]),kind:"move",from:0,to:1},
    ]);
    assert.equal(canonical_graph_equal(root,before),true); assert.equal(map.rev,0);
    const reserved = engine.reserve(t);
    assert.equal(canonical_graph_equal(root,before),true);
    assert.equal(engine.accept(t).commit.changed,true); reserved();
    assert.deepEqual(map.data.state.snap(),{nested:{n:3,keep:true},rows:[1,0]});
    const stale = engine.prepare([{target:engine.target(id,["nested","n"]),kind:"set",value:4}]);
    // Internal tampering changes the graph without changing revision: content fence still matters.
    set_live_path_from_projected(engine.root(id),["nested","n"],9);
    assert.throws(()=>engine.accept(stale),{code:"LIVEMAP_TRANSITION_STALE"});
    assert.equal(map.data.state.snap(["nested","n"]),9);
    assert.throws(()=>engine.accept(stale),{code:"LIVEMAP_TRANSITION_STALE"});
  });
  await check("equal explicit root intent survives a later changed operation; container moves retain direct shape", () => {
    for (const operation of ["replace", "set"] as const) {
      const {aggregate:engine,identities:[id]} = make_livemap_registry_authority([
        {root:projected_value_to_hson_node(ordered_projected_array([0,1])),family:"data",hsonSchema:ANY_DATA},
      ]);
      assert.ok(id);assert.equal(engine.root(id).$_tag,ARR_TAG);
      const t=engine.prepare([
        {target:engine.target(id,[]),kind:operation,value:ordered_projected_array([0,1])},
        {target:engine.target(id,[0]),kind:"set",value:2},
      ]);
      assert.equal(engine.root(id).$_tag,ARR_TAG);
      assert.deepEqual(engine.snap(id),[0,1]);
      engine.accept(t);
      assert.equal(engine.root(id).$_tag,operation==="replace"?ROOT_TAG:ARR_TAG);
      assert.deepEqual(engine.snap(id),[2,1]);
    }
    const {aggregate:engine,identities:[id]}=make_livemap_registry_authority([
      {root:projected_value_to_hson_node(ordered_projected_array([0,1])),family:"data",hsonSchema:ANY_DATA},
    ]);assert.ok(id);
    engine.accept(engine.prepare([{target:engine.target(id,[]),kind:"move",from:0,to:1}]));
    assert.equal(engine.root(id).$_tag,ARR_TAG);assert.deepEqual(engine.snap(id),[1,0]);
  });
  await check("equal assignment, replacement, move, rename and splice preserve semantic identity intent", () => {
    const map=hsonLiveMap.fromLibraries({state:{data:{rows:[{n:1},{n:1},{n:2}],names:{a:{n:1},b:{n:1}}}}});
    const state=map.data.state, engine=internal_livemap_aggregate_authority(map), id=engine.libraries()[0]!;
    engine.acquireLocalProjectedIdentity(id,["rows",0],"000008701");
    engine.acquireLocalProjectedIdentity(id,["rows",1],"000008702");
    engine.acquireLocalProjectedIdentity(id,["names","a"],"000008703");
    engine.acquireLocalProjectedIdentity(id,["names","b"],"000008704");
    assert.equal(state.at(["rows",0]).set({n:1}).changed,false);
    const move=state.at(["rows"]).asArray()!.array.move(0,1);
    assert.equal(move.operations[0]?.operation.kind,"move");
    assert.deepEqual(engine.projectedOverlay(id).pathForQuid("000008701"),["rows",1]);
    assert.deepEqual(engine.projectedOverlay(id).pathForQuid("000008702"),["rows",0]);
    state.at(["names"]).asObject()!.object.renameKey("a","b");
    assert.deepEqual(engine.projectedOverlay(id).pathForQuid("000008703"),["names","b"]);
    assert.equal(engine.projectedOverlay(id).pathForQuid("000008704"),undefined);
    state.at(["rows"]).asArray()!.array.splice(0,1,{n:1});
    assert.equal(engine.projectedOverlay(id).pathForQuid("000008702"),undefined);
    assert.deepEqual(engine.projectedOverlay(id).pathForQuid("000008701"),["rows",1]);
    const replaced=state.at(["rows",1]).replace({n:1});assert.equal(replaced.changed,true);
    assert.equal(engine.projectedOverlay(id).pathForQuid("000008701"),undefined);
    assert.equal(engine.identityEpoch().issued().has("000008701"),true);
    assert.throws(()=>engine.acquireLocalProjectedIdentity(id,["rows",1],"000008701"));
  });
  await check("accepted equal replacement and splice replay in a fresh runtime without source QUIDs", () => {
    for (const kind of ["replace", "splice"] as const) {
      const source=hsonLiveMap.fromLibraries({state:{data:{rows:[{n:1}]}}});
      const engine=internal_livemap_aggregate_authority(source), id=engine.libraries()[0]!;
      const client=compose_client_portable_aggregate_internal(make_portable_aggregate_snapshot(engine.captureHosted()), []);
      const replica=create_echo_aggregate_replica_capability_internal(client);
      engine.acquireLocalProjectedIdentity(id,["rows",0],"000008711");
      const t=engine.prepare([kind==="replace"
        ? {target:engine.target(id,["rows",0]),kind:"replace",value:ordered_projected_object([["n",1]])}
        : {target:engine.target(id,["rows"]),kind:"splice",start:0,deleteCount:1,items:[ordered_projected_object([["n",1]])]}]);
      const accepted=engine.accept(t).commit;
      assert.ok(accepted.hosted);const portable=make_portable_aggregate_commit(accepted.hosted);assert.ok(portable);
      replica.replayHosted(portable,0);
      assert.equal(client.rev,source.rev);assert.deepEqual(client.data.must("state").snap(),source.data.state.snap());
      const receiver=internal_livemap_aggregate_authority(client);
      assert.equal(receiver.identityEpoch().issued().size,0);
      replica.dispose();
    }
  });
  await check("shallow ordered constructive writes preserve numeric member order and exact numbers", () => {
    const map=hsonLiveMap.fromLibraries({state:{data:Hson.data.fromSource('{"10":0,"2":0,"nested":{"keep":true,"drop":true}}')}});
    map.batch(d=>{
      d.data.state.at([]).set(Hson.data.fromSource('{"2":-0,"1":5,"nested":{"keep":false}}'));
      d.data.state.at(["nested"]).set(Hson.data.fromSource('{"10":1,"2":2}'));
      d.data.state.at(["10"]).set(Number.MAX_VALUE);
      d.data.state.at(["1"]).set(Number.MIN_VALUE);
    });
    const state=map.data.state;
    assert.deepEqual(state.at([]).asObject()!.object.keys(),["10","2","nested","1"]);
    assert.deepEqual(state.at(["nested"]).asObject()!.object.keys(),["keep","10","2"]);
    assert.ok(Object.is(state.snap(["2"]),-0));assert.equal(state.snap(["10"]),Number.MAX_VALUE);
    assert.equal(state.snap(["1"]),Number.MIN_VALUE);
    const before=state.hson();
    for(const run of [()=>state.at(["absent"]).set(2),()=>state.at([]).delete(),()=>state.at(["1"]).set(Infinity)]) assert.throws(run);
    assert.equal(state.hson(),before);
  });
  await check("complete candidate depth and governing Schema reject atomically", () => {
    let deep: JsonValue=0;
    for(let i=0;i<HSON_MAX_NESTING-2;i++) deep={n:deep};
    const map=hsonLiveMap.fromLibraries({state:{data:{slot:0}},guard:{data:{n:0},schema:Hson.schema`<type "data" content <n <number <int true min 0>>>>`}});
    const before=map.data.state.hson();
    assert.throws(()=>map.batch(d=>{d.data.state.at(["slot"]).set({extra:deep});d.data.guard.at(["n"]).set(1)}));
    assert.equal(map.data.state.hson(),before);assert.equal(map.rev,0);
    assert.throws(()=>map.batch(d=>{d.data.state.at(["slot"]).set(8);d.data.guard.at(["n"]).set(-1)}));
    assert.equal(map.data.state.hson(),before);assert.equal(map.rev,0);
  });
  await check("terminal authority records release planning callbacks without losing terminal behavior", () => {
    for(const outcome of ["accept","noop","discard","stale","invalid","afterInstall"] as const) {
      let rev=0,released=0,notified=0;
      const controller=make_livemap_transition_controller(()=>rev);
      const changed=outcome!=="noop";
      const commit:LiveMapAggregateCommit={kind:"aggregate",changed,prevRev:0,rev:changed?1:0,operations:[]};
      const t=controller.prepareAuthority({commit,libraryModes:["data-object"],baseStillCurrent:()=>true,
        install:()=>{if(outcome==="invalid") throw new Error("installation failed");rev=1;},
        notify:()=>{notified++},release:()=>{released++}});
      if(outcome==="discard") controller.discardAuthority(t);
      else if(outcome==="stale") {rev=2;assert.throws(()=>controller.acceptAuthority(t),{code:"LIVEMAP_TRANSITION_STALE"});}
      else if(outcome==="invalid") assert.throws(()=>controller.acceptAuthority(t),{code:"LIVEMAP_TRANSITION_INVALID"});
      else if(outcome==="afterInstall") assert.throws(()=>controller.acceptAuthority(t,"isolate",()=>{throw new Error("after install")}));
      else controller.acceptAuthority(t);
      assert.equal(released,1);assert.equal(t.commit,commit);
      assert.equal(notified,outcome==="accept"?1:0);
      const terminalCode = outcome === "stale" ? "LIVEMAP_TRANSITION_STALE"
        : outcome === "discard" || outcome === "invalid" ? "LIVEMAP_TRANSITION_DISCARDED"
        : "LIVEMAP_TRANSITION_ALREADY_ACCEPTED";
      assert.throws(()=>controller.acceptAuthority(t),{code:terminalCode});
      assert.equal(released,1);
    }
  });
  await check("reserved acceptance retains candidates through disposal and releases failed durable decisions", async () => {
    for (const outcome of ["accept", "failed", "uncertain", "dispose"] as const) {
      const map = hsonLiveMap.fromLibraries({ state: { data: { n: 0 } } });
      const engine = internal_livemap_aggregate_authority(map);
      let token: PreparedLiveMapAuthorityTransition | undefined;
      let enter!: () => void, release!: () => void, reject!: (error: Error) => void;
      const entered = new Promise<void>(resolve => { enter = resolve; });
      const decision = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
      const failure = new Error("durable decision failed");
      const host = create_locus_hosted_aggregate_internal({
        map,
        gate: ({ transition }) => { token = transition; enter(); return decision; },
        uncertainGateFailure: error => outcome === "uncertain" && error === failure,
      });
      const result = host.stage(draft => draft.data.must("state").at(["n"]).set(1))
        .then(() => undefined, error => error);
      await entered;
      const prepared = token;
      assert.ok(prepared);
      assert.equal(map.rev, 0); assert.equal(map.data.state.snap(["n"]), 0);
      assert.doesNotThrow(() => engine.preparedSystemRoot(prepared));
      if (outcome === "dispose") host.dispose();
      assert.throws(() => map.data.state.at(["n"]).set(2), /managed|Locus/i);
      if (outcome === "failed" || outcome === "uncertain") reject(failure); else release();
      assert.equal(await result, outcome === "failed" || outcome === "uncertain" ? failure : undefined);
      assert.throws(() => engine.preparedSystemRoot(prepared));
      assert.equal(prepared.commit.operations.length, 1, "terminal evidence remains owned by the token");
      assert.equal(map.rev, outcome === "failed" || outcome === "uncertain" ? 0 : 1);
      host.dispose();
      if (outcome === "uncertain") {
        assert.throws(() => map.data.state.at(["n"]).set(2), /managed|Locus/i);
        await assert.rejects(host.stage(draft => draft.data.must("state").at(["n"]).set(2)), /closed|faulted/i);
      } else {
        map.data.state.at(["n"]).set(2);
        assert.equal(map.data.state.snap(["n"]), 2);
      }
    }
  });
  await check("close then writes preserves submitted commands and reentrant publication stays ordered", () => {
    const map=hsonLiveMap.fromLibraries({state:{data:{n:0}}});
    const engine=internal_livemap_aggregate_authority(map), staged=make_livemap_staged_writer(engine);
    staged.writer.data.must("state").at(["n"]).set(1);staged.close();
    const writes=staged.writes();assert.equal(writes.length,1);
    assert.throws(()=>staged.writer.data.must("state").at(["n"]).set(99));
    const seen:number[]=[];
    map.commits.observe(c=>{seen.push(c.rev);if(c.rev===1) map.data.state.at(["n"]).set(2)});
    const t=engine.prepare(writes);engine.accept(t);
    assert.deepEqual(seen,[1,2]);assert.equal(map.data.state.snap(["n"]),2);
    assert.throws(()=>engine.preparedSystemRoot(t));
    const id = engine.libraries()[0]!;
    const noop = engine.prepare([{target:engine.target(id,["n"]),kind:"set",value:2}]);
    assert.equal(noop.commit.changed,false);
    engine.accept(noop);
    assert.throws(()=>engine.preparedSystemRoot(noop));
    assert.deepEqual(seen,[1,2]);assert.equal(map.rev,2);
  });
}
