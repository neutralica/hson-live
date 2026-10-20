import assert from "node:assert/strict";
import { hsonLiveTree, hsonLiveMap, hsonMirror } from "../../src/index.ts";
import { runtime_for_tree, subject_for_tree, create_livetree_runtime } from "../../src/api/livetree/runtime/livetree-runtime.ts";
import { create_staged_livetree_in_runtime } from "../../src/api/livetree/creation/create-livetree.ts";
import type { LiveMap } from "../../src/types/livemap.types.ts";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.ts";

export function lazy_css_cases(check: (name: string, run: () => void) => void): void {
  check("QUID-free standalone factory candidate global/snapshot access stays sparse", () => {
    // Existing private candidate construction provides a lawful eligible subject
    // before allocation; do not delete identity from a public constructed tree.
    const runtime = create_livetree_runtime();
    const tree = create_staged_livetree_in_runtime({ $_tag: 'main', $_content: [] }, runtime);
    const before = tree.node;
    const css = tree.css, global = css.global;
    assert.equal(tree.css, css); assert.equal(css.global, global);
    assert.equal(css.snapshot(), '');
    assert.throws(() => global.stylesheet('@import url(forbidden.css);'), /@import/);
    global.sel('.x').set.color('red');
    global.var.set('tone', 'green');
    global.atProperty.register(['--phase', '<number>', '0']);
    global.keyframes.set({ name: 'fade', steps: { from: { opacity: '0' }, to: { opacity: '1' } } });
    assert.match(css.snapshot(), /@keyframes fade/);
    global.drop('sel:.x'); global.clearAll();
    assert.deepEqual(tree.node, before);
    assert.equal(runtime.quidToNode.size, 0); assert.equal(runtime.issuedQuids.size, 0);
    css.set.opacity('.5');
    const quid = tree.node.$_meta?.quid;
    assert.equal(typeof quid, 'string');
    assert.equal(runtime.quidToNode.get(quid!), subject_for_tree(tree));
    css.set.opacity('.7');
    assert.equal(tree.node.$_meta?.quid, quid); assert.equal(runtime.issuedQuids.size, 1);
    tree.remove();
  });

  check("standalone global and snapshots retain existing identity and append semantics", () => {
    const tree = hsonLiveTree.fromHson('<main/>', { isolated: true });
    const runtime = runtime_for_tree(tree);
    const before = [...runtime.issuedQuids];
    const node = tree.node;
    const css = tree.css, global = css.global;
    assert.equal(tree.css, css);
    assert.equal(tree.css.global, global);
    assert.equal(css.snapshot(), "");
    global.stylesheet('.a{color:red}');
    global.stylesheet('.b{color:blue}');
    assert.equal(css.snapshot(), '.a{color:red;}\n\n.b{color:blue;}');
    assert.throws(() => global.stylesheet('@import url(forbidden.css);'), /@import/);
    global.sel('.c').set.color('green');
    global.drop('sel:.c');
    global.clearAll();
    assert.equal(css.snapshot(), "");
    assert.deepEqual([...runtime.issuedQuids], before);
    assert.deepEqual(tree.node, node);
    tree.detach();
    global.sel('.detached').set.color('red');
    assert.match(css.snapshot(), /detached/);
    tree.remove();
    assert.throws(() => css.snapshot(), /disposed/i);
    assert.throws(() => global.sel('.dead').set.color('red'), /disposed/i);
    assert.throws(() => tree.css, /disposed/i);
  });

  check("plain Mirror global routing stays runtime-owned with no source identity demand", () => {
    const map: LiveMap = hsonLiveMap.fromLibraries({ page: { document: '<main <span/>/>' } });
    const page = map.doc.must('page');
    if (page.mode !== 'document') throw Error('Expected document Library');
    const mirror = hsonMirror(page);
    const tree = mirror.tree.find.must.byTag('span');
    const runtime = runtime_for_tree(tree);
    const authority = internal_livemap_aggregate_authority(map);
    const epoch = authority.identityEpoch();
    const before = map.capture();
    const ledger = epoch.issued();
    const rev = map.rev;
    let commits = 0;
    const off = map.commits.observe(() => commits++);
    const assertSparse = () => {
      assert.equal(tree.node.$_meta?.quid, undefined);
      assert.equal(runtime.quidToNode.size, 0);
      assert.equal(runtime.pendingQuidClaims.size, 0);
      assert.equal(runtime.issuedQuids.size, 0);
      assert.equal(epoch.issued(), ledger);
      assert.equal(epoch.current(), 0);
      assert.equal(map.rev, rev);
      assert.equal(commits, 0);
      assert.deepEqual(map.capture(), before);
    };
    const css = tree.css;
    assert.equal(Object.hasOwn(css, 'global'), true);
    assert.equal(Object.hasOwn(css, 'snapshot'), true);
    assertSparse();
    const global = css.global;
    assert.equal(tree.css, css);
    assert.equal(css.global, global);
    assert.equal(css.snapshot(), '');
    assertSparse();
    assert.throws(() => global.stylesheet('@import url(forbidden.css);'), /@import/);
    assertSparse();
    global.stylesheet('.x{color:red}');
    global.stylesheet('.y{color:blue}');
    global.sel('.z').set.opacity('.5');
    const snapshot = css.snapshot();
    assert.match(snapshot, /\.x\{color:red;\}/);
    assert.match(snapshot, /\.y\{color:blue;\}/);
    assert.equal(page.css.snapshot(), '');
    global.sel('.z').set.opacity('.5');
    assert.equal(css.snapshot(), snapshot);
    assert.equal(global.has('sel:.z'), true);
    assert.match(global.get('sel:.z') ?? '', /opacity:0.5|opacity:\.5/);
    assertSparse();
    global.drop('sel:.z');
    global.clearAll();
    global.clearAll();
    assert.equal(css.snapshot(), '');
    assertSparse();

    // Access to a subject capability is the existing demand boundary.
    css.set.opacity('.4');
    const quid = tree.node.$_meta?.quid;
    assert.equal(typeof quid, 'string');
    assert.equal(runtime.quidToNode.get(quid!), subject_for_tree(tree));
    assert.equal(runtime.nodeToQuid.get(subject_for_tree(tree)), quid);
    assert.equal(runtime.issuedQuids.has(quid!), true);
    assert.equal(epoch.issued().has(quid!), true);
    assert.equal(epoch.issued().size, 1);
    assert.equal(map.rev, rev);
    assert.equal(commits, 0);
    css.selector('& > .child').set.color('red');
    css.set.opacity('.7');
    assert.equal(tree.node.$_meta?.quid, quid);
    assert.equal(runtime.issuedQuids.size, 1);
    assert.equal(css.global, global);
    assert.match(css.snapshot(), /0\.7|\.7/);
    css.clear();
    global.clearAll();
    assert.equal(runtime.issuedQuids.has(quid!), true);
    assert.equal(epoch.issued().has(quid!), true);
    assert.equal(mirror.status, 'active');
    off();
    mirror.dispose();
    mirror.tree.remove();
  });

  check("Mirror binding disposal preserves uncached rejection and active cached runtime ownership", () => {
    for (const cached of [false, true]) {
      const map: LiveMap = hsonLiveMap.fromLibraries({ page: { document: '<main/>' } });
      const page = map.doc.must('page');
      if (page.mode !== 'document') throw Error('Expected document Library');
      const mirror = hsonMirror(page), tree = mirror.tree.find.must.byTag('main');
      const global = cached ? tree.css.global : undefined;
      const runtime = runtime_for_tree(tree);
      const issued = runtime.issuedQuids.size;
      mirror.dispose();
      assert.equal(tree.isDisposed, false);
      if (global === undefined) assert.throws(() => tree.css, /stale linked binding/);
      else {
        global.sel('.still-active').set.color('red');
        assert.match(tree.css.snapshot(), /still-active/);
        assert.throws(() => tree.css.set.opacity('.5'), /stale linked binding/);
      }
      assert.equal(runtime.issuedQuids.size, issued);
      assert.equal(map.rev, 0);
      mirror.tree.remove();
    }
  });

  check("cached no-QUID aliases retain operation-time stale-subject guards", () => {
    const map: LiveMap = hsonLiveMap.fromLibraries({ page: { document: '<main <span/>/>' } });
    const page = map.doc.must('page');
    if (page.mode !== 'document') throw Error('Expected document Library');
    const mirror = hsonMirror(page);
    const tree = mirror.tree.find.must.byTag('span');
    const css = tree.css, global = css.global, snapshot = css.snapshot;
    const rule = global.sel('.x');
    const issued = runtime_for_tree(tree).issuedQuids.size;
    map.restore(map.capture());
    assert.equal(tree.isDisposed, true);
    for (const operation of [() => tree.css, () => css.global, () => snapshot(),
      () => global.stylesheet('.x{color:red}'), () => rule.set.color('red')]) {
      assert.throws(operation, /disposed/i);
    }
    assert.equal(runtime_for_tree(tree).issuedQuids.size, issued);
    assert.equal(mirror.status, 'active');
    const fresh = mirror.tree.find.must.byTag('span');
    fresh.css.global.sel('.fresh').set.color('green');
    assert.equal(fresh.node.$_meta?.quid, undefined);
    mirror.dispose();
    mirror.tree.remove();
  });
}
