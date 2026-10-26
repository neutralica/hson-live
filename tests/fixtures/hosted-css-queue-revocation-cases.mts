import assert from "node:assert/strict";
import { deferred, hosted_css_authority_fixture } from "../helpers/hosted-css-authority-fixture.mts";

export async function hosted_css_queue_revocation_cases() {
  // Original reproducer: enqueue on the real authority, then revoke in the same turn.
  for (const mirrorOnly of [false, true]) {
    const f = await hosted_css_authority_fixture();
    try {
      const css = f.continuation.tree.css.global, asyncCss = f.continuation.tree.async.css.global;
      const retained = asyncCss.sel(".revoked");
      let prepared = 0;
      const pending = Array.from({ length: 3 }, (_, index) => asyncCss.edit(handle => {
        prepared++; handle.sel(".revoked").setMany(index === 2 ? { "@:label": { color: "blue" } } : { color: "red" });
      }));
      const settled = Promise.allSettled(pending);
      if (mirrorOnly) f.continuation.mirror.dispose(); else f.continuation.dispose();
      const before = f.state(), native = f.native();
      for (const result of await settled) {
        assert.equal(result.status, "rejected");
        if (result.status === "rejected") assert.match(String(result.reason), /disposed|active bound/);
      }
      assert.equal(prepared, 0); assert.equal(f.actions.length, 0);
      f.unchanged(before); assert.deepEqual(f.native(), native);
      await assert.rejects(retained.setMany({ color: "purple" }), /disposed|active bound/);
      assert.throws(() => css.sel(".retained").setMany({ color: "purple" }));
      f.unchanged(before); assert.equal(f.actions.length, 0);
    } finally { f.close(); }
  }

  // Disposal while an earlier dispatched request is awaited revokes only pending work.
  {
    const f = await hosted_css_authority_fixture();
    const entered = deferred(), release = deferred();
    try {
      let held = true;
      f.beforeAction(async () => { if (held) { held = false; entered.resolve(); await release.promise; } });
      const css = f.continuation.tree.async.css.global;
      const revision = f.locus.rev;
      const first = css.sel(".accepted").setMany({ color: "green", _hover: { color: "blue" } });
      await entered.promise;
      let prepared = 0;
      const pending = Promise.allSettled(Array.from({ length: 3 }, () => css.edit(handle => {
        prepared++; handle.sel(".pending").setMany({ "@:label": { color: "red" } });
      })));
      f.continuation.dispose();
      const native = f.native(), issued = f.state();
      release.resolve(); await first;
      assert.ok((await pending).every(result => result.status === "rejected"));
      assert.equal(prepared, 0); assert.equal(f.actions.length, 1); assert.equal(f.locus.rev, revision + 1);
      assert.match(f.continuation.map.css.snapshot(), /\.accepted/);
      assert.doesNotMatch(f.continuation.map.css.snapshot(), /\.pending/);
      assert.deepEqual(f.native(), native);
      const after = f.state();
      for (const key of ["ownerIssued", "receiverIssued", "runtimeIssued", "claims", "pending"] as const) assert.deepEqual(after[key], issued[key]);
      const page = f.continuation.echo.doc.must("page");
      assert.equal(page.mode, "document");
      if (page.mode !== "document") throw Error("Expected document");
      await page.at([1, 0]).asElement()!.attrs.set("title", "queue remains usable");
      assert.equal(f.locus.rev, revision + 2); assert.equal(f.actions.length, 2);
      assert.deepEqual(f.native(), native);
    } finally { release.resolve(); f.close(); }
  }

  // Valid recursive batches preserve order, one transition each and stable rule identity.
  {
    const f = await hosted_css_authority_fixture();
    try {
      const revision = f.locus.rev, issued = f.state();
      const rule = f.continuation.tree.async.css.global.sel(".ordered");
      const values = (color: string) => ({ color, _hover: { "& > p": { color } }, $media: { screen: { color } } });
      await Promise.all([rule.setMany(values("red")), rule.setMany(values("blue"))]);
      assert.equal(f.locus.rev, revision + 2); assert.equal(f.actions.length, 2);
      const first = f.actions[0], second = f.actions[1];
      assert.match(JSON.stringify(first), /red/); assert.match(JSON.stringify(second), /blue/);
      const state = f.owner.capture().libraries.find(entry => entry.name === "page")!.css!;
      assert.equal(state.rules.length, 3);
      assert.ok(state.rules.every(rule => rule.declarations.some(([name, value]) => name === "color" && value === "blue")));
      const keys = state.rules.map(rule => rule.ruleKey);
      await rule.setMany(values("blue"));
      assert.equal(f.locus.rev, revision + 2);
      assert.deepEqual(f.owner.capture().libraries.find(entry => entry.name === "page")!.css!.rules.map(rule => rule.ruleKey), keys);
      assert.ok(f.head.childNodes.length > 0);
      assert.match(f.continuation.map.css.snapshot(), /color:blue/);
      const after = f.state();
      assert.deepEqual(after.ownerIssued, issued.ownerIssued); assert.deepEqual(after.receiverIssued, issued.receiverIssued);
    } finally { f.close(); }
  }

  // A synchronous author callback may revoke its own binding before dispatch.
  {
    const f = await hosted_css_authority_fixture();
    try {
      const before = f.state();
      await assert.rejects(f.continuation.tree.async.css.global.edit(css => {
        f.continuation.dispose(); css.sel(".reentrant").setMany({ color: "red" });
      }), /disposed|active bound/);
      f.unchanged(before); assert.equal(f.actions.length, 0);
    } finally { f.close(); }
  }
  console.log("Hosted CSS queue revocation, in-flight completion and ordered publication passed.");
}
