import assert from "node:assert/strict";
import { scoped_tail_fixture, verify_scoped_tail_restart } from "./locus-scoped-tail-cases.mts";
import { scoped_initial_fixture, page, node } from "./echo-scoped-initial-state-cases.mts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { load_persistent_locus_hosted_aggregate_internal as resume, checkpoint_libraries_equal } from "../../src/api/locus/locus.aggregate.persistence.ts";
import { document_scoped_libraries_semantically_equal as equal } from "../../src/api/livemap/livemap.document.scoped-portable.ts";
import { enumerate_livemap_issued_quids as issued } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { validate_document_path as path } from "../../src/api/livemap/livemap.document.path.ts";
import { hsonTransform } from "../../src/index.ts";
import { parse_document_stylesheet } from "../../src/internal/css/parse-document-stylesheet.ts";
import type { LiveMapCssOp } from "../../src/types/livemap.types.ts";
const replacement = () => hsonTransform.fromHson('<article title="H0a" <hson-part lib="parts" at="panel"/> <hson-part lib="parts" at="panel"/> <footer/>/>').toNode();
const root = { kind: "path" as const, path: path([0]) };

export async function h0a_tail_fixture() {
  const f = await scoped_tail_fixture();
  const l = await resume(f.state.checkpoint.logicalMapId, { persistence: f.adapter, scopedDocuments: true }); assert.ok(l);
  const a = authority(l.map), id = a.libraries()[1]!, epoch = a.identityEpoch().current();
  const other = a.libraries()[3]!, otherScopes = a.documentScopes(other), otherOverlay = a.documentOverlay(other);
  const old = a.documentScopes(id)!.occurrences, oldIds = issued(a.identityEpoch().issued());
  try {
    const footer = a.documentQuad(id, "footer", undefined)!.quid;
    const cssOnly = await l.stage(w => {
      page(w).css({ domain: "css", kind: "batch", operations: [
        { domain: "css", kind: "rule", ruleKey: "tail-subject", scopes: [], rule: {
          ruleKey: "tail-subject", scopes: [], selector: `[hson\\:quid="${footer}"]`, declarations: [["outline", "0"]] } },
        { domain: "css", kind: "rule", ruleKey: "tail-other-subject", scopes: [], rule: {
          ruleKey: "tail-other-subject", scopes: [], selector: `[hson\\:quid="${a.documentQuad(id, "left", undefined)!.quid}"]`, declarations: [["opacity", ".9"]] } },
      ] });
      page(w).css.stylesheet('main{color:green}');
    });
    assert.ok(cssOnly); assert.deepEqual(a.documentScopes(id)!.occurrences, old);
    assert.equal(a.identityEpoch().current(), epoch); assert.deepEqual(issued(a.identityEpoch().issued()), oldIds);
    await l.stage(w => {
      page(w).css({ domain: "css", kind: "rule", ruleKey: "independent", scopes: [],
        rule: { ruleKey: "independent", scopes: [], selector: "article", declarations: [["margin", "5px"]] } });
      const data = w.lib("data"); if (data.mode === "document") throw Error(); data.at(["n"]).set(17);
      page(w).graph({ domain: "graph", op: "replace-root", mode: "document", root: replacement() });
      page(w).attrs.set(root, "title", "H0a");
      page(w).css({ domain: "css", kind: "property", name: "--accent",
        definition: { name: "--accent", syn: "<color>", inh: false, init: "red" } });
    });
    assert.equal(a.identityEpoch().current(), epoch);
    assert.equal(a.documentScopes(other), otherScopes); assert.equal(a.documentOverlay(other), otherOverlay);
    const interactions = JSON.stringify(a.systemRoot(a.systemState("@hson/canonical-interactions")!));
    assert.doesNotMatch(interactions, /shared-footer/); assert.match(interactions, /hidden-event/);
    for (const occurrence of a.documentScopes(id)!.occurrences) assert.ok(!old.some(s => s.lifetime === occurrence.lifetime));
    for (const quid of oldIds) assert.ok(a.identityEpoch().issued().has(quid));
    assert.match(JSON.stringify(a.scopedDocumentState(id).css), /margin|color/);
    const equalBefore = a.documentScopes(id)!.occurrences, equalGraph = a.scopedDocumentState(id).root;
    await l.stage(w => page(w).graph({ domain: "graph", op: "replace-root", mode: "document", root: replacement() }));
    assert.deepEqual(a.scopedDocumentState(id).root, equalGraph);
    for (const occurrence of a.documentScopes(id)!.occurrences) assert.ok(!equalBefore.some(s => s.lifetime === occurrence.lifetime));
    const expected = a.captureSemanticCheckpoint(), sourceIds = [...new Set([...f.sourceIds, ...issued(a.identityEpoch().issued())])];
    const state = f.adapter.state(l.logicalMapId)!;
    assert.equal(state.commits.length, 6);
    for (const tail of state.commits) {
      const pageEffects = tail.commit.operations.filter(op => op.library === "page" && op.domain === "document");
      assert.deepEqual(pageEffects.map(op => op.domain === "document" ? op.effect.ordinal : -1), pageEffects.map((_, i) => i));
    }
    const encoded = JSON.stringify(state.commits);
    for (const quid of sourceIds) assert.ok(!encoded.includes(quid));
    return { ...f, expected, sourceIds, state };
  } finally { l.dispose(); }
}

export async function h0a_cases(check: (name: string, run: () => Promise<void>) => Promise<void>) {
  await check("H0a CSS and roots persist in mixed ordered tails and resume into an authorized Echo", async () => {
    await verify_scoped_tail_restart(await h0a_tail_fixture());
  });
  await check("H0a scoped CSS preserves lifetimes, translates independent subjects and supports every CSS unit", async () => {
    const f = await scoped_initial_fixture(), cap = f.fresh(); assert.ok(cap.map);
    const a = authority(cap.map), id = a.libraries()[a.hostedRegistry().libraries.filter(e => e.scope === undefined).findIndex(e => e.name === "page")]!;
    const before = a.documentScopes(id)!.occurrences;
    try {
      const quid = f.a.documentQuad(f.pageId, "footer", undefined)!.quid;
      const operations: readonly LiveMapCssOp[] = [
        { domain: "css" as const, kind: "rule" as const, ruleKey: "independent", scopes: [], rule: {
          ruleKey: "independent", scopes: [], selector: `[hson\\:quid="${quid}"]`, declarations: [["outline", "0"]] as [string, string][] } },
        { domain: "css" as const, kind: "batch" as const, operations: [
          { domain: "css" as const, kind: "property" as const, name: "--test", definition: { name: "--test", syn: "*", inh: false } },
          { domain: "css" as const, kind: "keyframes" as const, name: "pulse", definition: { name: "pulse", steps: [{ at: "to", declarations: [["opacity", "0"]] as [string, string][] }] } },
        ] },
        { domain: "css" as const, kind: "rule" as const, ruleKey: "independent", scopes: [] },
        { domain: "css" as const, kind: "append" as const, stylesheet: { rules: [{ ruleKey: "appended", selector: "aside", scopes: [], declarations: [["display", "block"]] }],
          properties: [], keyframes: [], order: [{ kind: "rule", ruleKey: "appended", scopes: [] }] } },
        { domain: "css" as const, kind: "replace" as const, stylesheet: parse_document_stylesheet('main{color:red}', []) },
        { domain: "css" as const, kind: "clear-all" as const },
      ];
      for (const operation of operations) {
        const batch = await f.stage(w => page(w).css(operation)); cap.replayScopedHosted(batch);
        assert.ok(equal(f.a.scopedDocumentState(f.pageId), a.scopedDocumentState(id)));
        assert.deepEqual(a.documentScopes(id)!.occurrences, before);
      }
      const noOpRev = f.l.rev; await f.l.stage(w => page(w).css({ domain: "css", kind: "clear-all" })); assert.equal(f.l.rev, noOpRev);
      const batch = await f.stage(w => {
        page(w).graph({ domain: "graph", op: "replace-root", mode: "document", root: replacement() });
        page(w).css.stylesheet('article{padding:1px}');
        page(w).content.insert({ kind: "path", path: path([0, 0]) }, 0, node('<hson-part lib="parts" at="leaf"/>'));
      });
      cap.replayScopedHosted(batch);
      assert.ok(equal(f.a.scopedDocumentState(f.pageId), a.scopedDocumentState(id)));
      for (const occurrence of a.documentScopes(id)!.occurrences) assert.ok(!before.some(s => s.lifetime === occurrence.lifetime));
      assert.throws(() => f.a.captureDocumentSsr(f.pageId, [])); assert.throws(() => f.map.capture());
    } finally { cap.dispose(); f.l.dispose(); }
  });
  await check("H0a malformed CSS evidence and later root tails reject atomically with retry", async () => {
    const f = await h0a_tail_fixture();
    const corruptions: readonly ((state: any) => void)[] = [
      s => s.commits[3].commit.operations[0].effect.styles[0].css.rules[0].selector = 'aside',
      s => s.commits[3].commit.operations[0].effect.created.push({ root: [0], parent: null, bindings: [] }),
      s => s.commits[4].commit.operations.find((op: any) => op.effect?.created.length).effect.created[0].parent = [99],
      s => s.commits[5].commit.operations[0].effect.retired = [],
      s => s.commits[5].commit.operations[0].effect.ordinal = 1,
    ];
    for (const corrupt of corruptions) {
      const state = structuredClone(f.state); corrupt(state); f.adapter.seed(state.checkpoint.logicalMapId, state);
      await assert.rejects(() => resume(state.checkpoint.logicalMapId, { persistence: f.adapter, scopedDocuments: true }), /invalid/);
    }
    f.adapter.seed(f.state.checkpoint.logicalMapId, f.state);
    const l = await resume(f.state.checkpoint.logicalMapId, { persistence: f.adapter, scopedDocuments: true }); assert.ok(l);
    try { assert.ok(checkpoint_libraries_equal(f.expected.libraries, authority(l.map).captureSemanticCheckpoint().libraries)); }
    finally { l.dispose(); }
  });
  await check("H0a root replacement rejects dangling independent CSS and keeps valid prefix changes atomic", async () => {
    const f = await scoped_initial_fixture(), before = f.a.captureSemanticCheckpoint(), ledger = f.a.identityEpoch().issued();
    try {
      await assert.rejects(() => f.l.stage(w => {
        page(w).graph({ domain: "graph", op: "replace-root", mode: "document", root: replacement() });
      }), /surviving|subject|scoped/i);
      assert.deepEqual(f.a.captureSemanticCheckpoint(), before); assert.equal(f.a.identityEpoch().issued(), ledger);
      await assert.rejects(() => f.l.stage(w => {
        page(w).css.stylesheet('main{color:pink}');
        page(w).graph({ domain: "graph", op: "replace-root", mode: "document", root: replacement() });
        page(w).content.insert({ kind: "path", path: path([99]) }, 0, node('<b/>'));
      }));
      assert.deepEqual(f.a.captureSemanticCheckpoint(), before); assert.equal(f.a.identityEpoch().issued(), ledger);
      await f.l.stage(w => {
        page(w).css.stylesheet('article{margin:9px}');
        page(w).graph({ domain: "graph", op: "replace-root", mode: "document", root: replacement() });
      });
      assert.match(JSON.stringify(f.a.scopedDocumentState(f.pageId).css), /margin|9px/);
    } finally { f.l.dispose(); }
  });
  await check("H0a append failure preserves CSS roots scopes and ledger; queued independent work survives", async () => {
    const f = await h0a_tail_fixture(), l = await resume(f.state.checkpoint.logicalMapId, { persistence: f.adapter, scopedDocuments: true }); assert.ok(l);
    const a = authority(l.map), before = a.captureSemanticCheckpoint(), ledger = a.identityEpoch().issued();
    const append = f.adapter.appendCommit.bind(f.adapter);
    let queued: Promise<unknown> | undefined;
    f.adapter.appendCommit = async () => {
      f.adapter.appendCommit = append;
      queued = l.stage(w => { const d = w.lib("data"); if (d.mode === "document") throw Error(); d.at(["n"]).set(29); });
      throw Error("storage rejected H0a");
    };
    try {
      await assert.rejects(() => l.stage(w => {
        page(w).css.stylesheet('article{color:pink}');
        page(w).graph({ domain: "graph", op: "replace-root", mode: "document", root: replacement() });
      }), /append/);
      await queued;
      assert.equal(l.rev, before.revision + 1);
      assert.ok(checkpoint_libraries_equal(before.libraries.filter(e => e.css !== undefined), a.captureSemanticCheckpoint().libraries.filter(e => e.css !== undefined)));
      assert.deepEqual(issued(a.identityEpoch().issued()), issued(ledger));
      await l.stage(w => page(w).graph({ domain: "graph", op: "replace-root", mode: "document", root: replacement() }));
      assert.equal(l.rev, before.revision + 2);
    } finally { l.dispose(); }
  });
  await check("H0a CSS and root candidates cannot install after management is revoked", async () => {
    for (const kind of ["css", "root"] as const) for (const reserved of [false, true]) {
      const f = await scoped_initial_fixture();
      await f.l.stage(w => page(w).css.stylesheet('main{color:red}')); f.l.dispose();
      const a = f.a, owner = {}, before = a.captureSemanticCheckpoint(), ledger = a.identityEpoch().issued();
      a.claimManagement(owner);
      const target = { domain: "application" as const, library: f.pageId, path: [] };
      const pending = a.prepareManaged(owner, kind === "css"
        ? [{ target, kind: "css", operation: { domain: "css", kind: "clear-all" } }]
        : [{ target, kind: "graph", operation: { domain: "graph", op: "replace-root", mode: "document", root: replacement() } }], true);
      const release = reserved ? a.reserve(pending) : () => {};
      a.releaseManagement(owner); a.claimManagement(owner);
      try { assert.throws(() => a.accept(pending), /management|authority|stale|installation/i); }
      finally { release(); a.discard(pending); a.releaseManagement(owner); }
      assert.deepEqual(a.captureSemanticCheckpoint(), before); assert.equal(a.identityEpoch().issued(), ledger);
    }
  });

  await check("H0a malformed CSS receiving evidence cannot change state or authority progress", async () => {
    const f = await scoped_initial_fixture(), cap = f.fresh(); assert.ok(cap.map);
    const a = authority(cap.map), baseline = a.captureSemanticCheckpoint(), ledger = a.identityEpoch().issued(), position = a.clientProjection();
    let observed = 0; const stop = a.observeAuthorityPosition(() => observed++);
    try {
      const quid = f.a.documentQuad(f.pageId, "footer", undefined)!.quid;
      const batch = await f.stage(w => page(w).css({ domain: "css", kind: "rule", ruleKey: "incoming", scopes: [],
        rule: { ruleKey: "incoming", scopes: [], selector: `[hson\\:quid="${quid}"]`, declarations: [["outline", "0"]] } }));
      const corruptions: readonly ((effect: any) => void)[] = [
        e => e.styles[0].subjects = [],
        e => e.styles[0].subjects[0].path = [99],
        e => e.styles[0].css.order[0].owner = `[hson\\:quad="${e.styles[0].subjects[0].name}"]`,
        e => e.graph = JSON.stringify({ domain: "css", kind: "clear-all" }),
        e => e.created.push({ root: [0], parent: null, bindings: [] }),
        e => e.after = "0".repeat(64),
      ];
      for (const corrupt of corruptions) {
        const input = structuredClone(batch); const operation = input.operations[0]!; assert.equal(operation.domain, "document");
        if (operation.domain !== "document") throw Error(); corrupt(operation.effect);
        assert.throws(() => cap.replayScopedHosted(input));
        assert.deepEqual(a.captureSemanticCheckpoint(), baseline); assert.equal(a.identityEpoch().issued(), ledger);
        assert.deepEqual(a.clientProjection(), position); assert.equal(observed, 0);
      }
      cap.replayScopedHosted(batch); assert.equal(observed, 1);
      assert.equal(a.clientProjection()!.revision, f.l.rev);
    } finally { stop(); cap.dispose(); f.l.dispose(); }
  });

}
