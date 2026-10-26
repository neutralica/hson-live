import assert from "node:assert/strict";
import { lookup_document_quad_internal } from "../../src/api/livemap/livemap.document.quad.ts";
import { admit_hson_data_input } from "../../src/api/data/hson-data.ts";
import { hosted_css_authority_fixture } from "../helpers/hosted-css-authority-fixture.mts";

/** Public queued authoring traverses the real HTTP action admission and replay. */
export async function hosted_css_subject_boundary_cases() {
  const f = await hosted_css_authority_fixture();
  try {
    const owner = lookup_document_quad_internal(f.owner.doc.must("page"), "label")!;
    const receiver = lookup_document_quad_internal(f.receiver.doc.must("page"), "label")!;
    assert.ok(owner); assert.ok(receiver); assert.notEqual(owner.quid, receiver.quid);
    assert.deepEqual(owner.path, receiver.path);
    await f.continuation.tree.async.css.global.sel(".plain").setProp("color", "teal");
    const plain = f.actions.at(-1)!;
    if (plain.type !== "action") throw Error("Expected action");
    assert.equal(Object.hasOwn(admit_hson_data_input(plain.payload).materialize() as object, "subjectContext"), false);
    const initial = f.state();
    for (const values of [
      { "@:label": { color: "red" } },
      { "@:label": { _hover: { "& > p": { color: "red" } } } },
      { $media: { screen: { "@:label": { _focus: { color: "red" } } } } },
      { "@:label": { opacity: .5 }, "@:other": { color: "blue" } },
    ]) {
      const before = f.locus.rev, dispatched = f.actions.length;
      const rule = f.continuation.tree.async.css.global.sel(".boundary");
      await rule.setMany(values);
      assert.equal(f.locus.rev, before + 1); assert.equal(f.actions.length, dispatched + 1);
      const action = f.actions.at(-1)!;
      assert.equal(action.type, "action");
      if (action.type !== "action") throw Error("Expected action");
      const payload = admit_hson_data_input(action.payload).materialize() as any;
      assert.equal(payload.subjectContext.at.revision, before);
      assert.equal(payload.subjectContext.at.sessionId, f.continuation.echo.session.sessionId);
      assert.equal(payload.subjectContext.subjects.length, "@:other" in values ? 2 : 1);
      assert.ok(JSON.stringify(payload.operation).includes("hson\\\\:quad"));
      assert.ok(f.owner.doc.must("page").css.snapshot().includes(owner.quid));
      assert.ok(f.continuation.map.css.snapshot().includes(receiver.quid));
      assert.equal(f.owner.doc.must("page").css.snapshot().includes(receiver.quid), false);
      await rule.setMany(values); assert.equal(f.locus.rev, before + 1, "Translated rule identity retains no-op behavior");
    }
    const after = f.state();
    assert.deepEqual(after.ownerIssued, initial.ownerIssued); assert.deepEqual(after.receiverIssued, initial.receiverIssued);
    assert.equal(JSON.stringify(f.session.now()).includes("subjectContext"), false);
    const before = f.state(), native = f.native(), dispatched = f.actions.length;
    await assert.rejects(f.continuation.tree.async.css.global.sel(".missing").setMany({ color: "blue", "@:missing": { color: "red" } }));
    f.unchanged(before); assert.deepEqual(f.native(), native); assert.equal(f.actions.length, dispatched);
    await Promise.all(["green", "purple"].map(color => f.continuation.tree.async.css.global.sel(".ordered-subject").setMany({ "@:label": { color } })));
    assert.equal(f.locus.rev, before.revision + 2);
    assert.match(f.owner.doc.must("page").css.snapshot(), /color:purple/);
    const retryRevision = f.locus.rev, retryStart = f.actions.length;
    f.loseNextActionResponse();
    await f.continuation.tree.async.css.global.sel(".lost-response").setMany({ "@:label": { color: "orange" } });
    assert.equal(f.locus.rev, retryRevision + 1);
    const attempts = f.actions.slice(retryStart);
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every(attempt => attempt.type === "action"));
    const [first, second] = attempts;
    if (first?.type !== "action" || second?.type !== "action") throw Error("Expected action attempts");
    assert.equal(JSON.stringify(first.payload), JSON.stringify(second.payload), "Retry preserves the frozen portable payload");
    await f.continuation.tree.async.css.global.sel(".declaration-order").setMany({ "@:label": { "--z": "first", "--a": "second" } });
    const declarations = f.owner.capture().libraries.find(library => library.name === "page")!.css!.rules
      .find(rule => rule.scopes.length === 0 && rule.declarations.some(([name]) => name === "--z"))!.declarations;
    assert.ok(declarations.findIndex(([name]) => name === "--z") < declarations.findIndex(([name]) => name === "--a"));
  } finally { f.close(); }
  console.log("Hosted contextual CSS subjects publish atomically with receiving-local identities.");
}
