import assert from "node:assert/strict";
import { Hson, hsonLiveMap } from "../../src/index.js";
import { internal_livemap_aggregate_authority } from "../../src/api/livemap/livemap.internal.js";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.js";

export async function representation_required_cases() {
  const map = hsonLiveMap.fromLibraries({
    state: { data: { value: [1], nullable: null } },
    page: { document: '<main @:page <b @:subject "before"/>/>' },
    parts: { parts: { submit: { kind: "document", document: "<button hson:part/>" } } },
  });
  const aggregate = internal_livemap_aggregate_authority(map);
  const before = map.capture(), issued = enumerate_livemap_issued_quids(aggregate.identityEpoch().issued());
  const value = map.data.state.at(["value"]), required = value.must;
  assert.equal(required, value.must);
  assert.equal(map.data.state.at(["nullable"]).must.snap(), null);
  assert.deepEqual(required.snap(), [1]);
  assert.deepEqual(Hson.data.materialize(required.hson()), [1]);
  const detached = required.snap();
  assert.ok(Array.isArray(detached)); detached.push(99);
  assert.deepEqual(required.snap(), [1]);
  assert.equal("data" in value, false);
  assert.equal("render" in value, false);
  const checked = value.asArray()!, checkedRequired = checked.must;
  assert.deepEqual(map.capture(), before);
  assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), issued);
  value.replace({ other: true });
  assert.equal(checked.snap(), undefined); assert.equal(checked.hson(), undefined);
  assert.throws(checkedRequired.snap, /refinement/); assert.throws(checkedRequired.hson, /refinement/);
  assert.throws(() => checked.array.map(x => x), /array/);
  value.delete();
  assert.equal(value.snap(), undefined); assert.throws(required.snap, /absent/);
  map.restore(before);
  assert.deepEqual(checkedRequired.snap(), [1]);
  assert.deepEqual(required.snap(), [1]);


  const part = map.parts.parts.submit, partMust = part.must;
  const definition = partMust.snap(); Reflect.set(definition, "document", "<aside/>");
  assert.equal(partMust.snap().document, "<button hson:part/>");
  assert.deepEqual(Hson.data.materialize(partMust.hson()), { kind: "document", document: "<button hson:part/>" });
  assert.equal("render" in part, false); assert.equal("data" in part, false);
  part.delete(); assert.equal(part.snap(), undefined); assert.throws(partMust.hson, /absent/);
  map.parts.parts.at([]).object.setKey("submit", { kind: "document", document: "<input hson:part/>" });
  assert.equal(partMust.snap().document, "<input hson:part/>");
  map.restore(before);
  assert.equal(partMust.snap().document, "<button hson:part/>");

  const page = map.doc.page, location = page.at([0]), must = location.must;
  const documentBefore = map.capture(), documentIssued = enumerate_livemap_issued_quids(aggregate.identityEpoch().issued());
  assert.equal(must.snap(), "<b>before</b>");
  assert.equal(must.hson(), Hson.document`<b "before"/>`);
  assert.equal(typeof page.root(), "object");
  assert.equal("render" in location, false);
  const refined = location.asElement()!, refinedMust = refined.must;
  const subject = page.q("subject")!, subjectMust = subject.must;
  subjectMust.snap(); subjectMust.hson(); page.must.snap(); page.must.hson();
  assert.deepEqual(map.capture(), documentBefore);
  assert.deepEqual(enumerate_livemap_issued_quids(aggregate.identityEpoch().issued()), documentIssued);
  location.replace("replacement");
  assert.equal(location.snap(), "replacement");
  assert.equal(refined.snap(), undefined); assert.equal(refined.hson(), undefined);
  assert.throws(refinedMust.snap, /refinement/);
  assert.equal(subject.snap(), undefined); assert.throws(subjectMust.snap, /absent/);
  map.restore(before);
  assert.equal(must.snap(), "<b>before</b>");
  assert.equal(refinedMust.snap(), "<b>before</b>");
  assert.equal(subject.snap(), undefined); assert.throws(subjectMust.hson, /absent/);
  location.delete();
  assert.equal(location.snap(), undefined); assert.equal(location.hson(), undefined);
  assert.throws(must.snap, /absent/); assert.throws(must.hson, /absent/);
  map.restore(before);
  assert.equal(must.snap(), "<b>before</b>");

  const notifications: (string | undefined)[] = [], whole: string[] = [];
  const stop = location.watch(next => notifications.push(next)), stopWhole = page.watch(next => whole.push(next));
  page.css.sel("b").set.color("red");
  page.css.sel("b").set.color("blue");
  map.restore(map.capture());
  assert.deepEqual(notifications, ["<b>before</b>", "<b>before</b>", "<b>before</b>"]);
  assert.equal(whole.length, 3); assert.ok(whole.every(value => value === "<main><b>before</b></main>"));
  stop(); stopWhole();
  const saved = map.capture();
  let reentered = false;
  const first = location.watch(value => {
    if (value === undefined && !reentered) { reentered = true; map.restore(saved); }
  });
  const later = location.watch(value => {
    assert.equal(typeof value, "string");
    assert.equal(must.snap(), "<b>before</b>");
  });
  location.delete(); first(); later(); assert.equal(reentered, true);

  const roots = hsonLiveMap.fromLibraries({ page: { document: "<a/> <b/>" } }).doc.page;
  const rootRefinement = roots.at([]).asRoot()!, rootMust = rootRefinement.must;
  roots.at([1]).delete();
  assert.equal(rootRefinement.snap(), undefined); assert.throws(rootMust.snap, /refinement/);
  assert.equal(roots.snap(), "<a></a>");

  const emptyMap = hsonLiveMap.fromLibraries({ empty: { document: { $_tag: "_hson_root", $_content: [] } } });
  const empty = emptyMap.doc.empty;
  assert.equal(empty.snap(), ""); assert.equal(empty.must.snap(), ""); assert.equal(empty.at([]).snap(), "");
  for (const read of [empty.hson, empty.must.hson, empty.at([]).hson, empty.at([]).must.hson]) {
    assert.throws(read, error => typeof error === "object" && error !== null && "code" in error && error.code === "HSON_DOCUMENT_EMPTY");
  }
  assert.equal(empty.at([0]).snap(), undefined); assert.equal(empty.at([0]).hson(), undefined);
  for (const document of ['<textarea "\\nA"/>', '<textarea ""/>']) {
    const page = hsonLiveMap.fromLibraries({ page: { document } }).doc.page;
    assert.equal(typeof page.snap(), "string");
    assert.throws(page.render, /browser-parser realization/);
  }

  const locus = hsonLiveMap.locus.create({
    page: { document: '<main <b "before"/>/>' }, state: { data: { value: [1] } },
  }, { actions: { inspect(context) {
    assert.equal(context.doc.page.must.snap(), "<main><b>before</b></main>");
    assert.equal(context.doc.page.at([0]).must.hson(), Hson.document`<b "before"/>`);
    assert.deepEqual(context.data.state.at(["value"]).must.snap(), [1]);
    assert.equal("set" in context.data.state.at(["value"]).must, false);
    assert.equal("snap" in context.stage.doc.page.at([]), false);
    assert.equal("must" in context.stage.data.state.at([]), false);
  } } });
  await locus.dispatchAction({ type: "action", id: "inspect", name: "inspect" });
  const localRequired = locus.doc.page.at([0]).must;
  const localElement = locus.doc.page.at([0]).asElement()!, localElementMust = localElement.must;
  await locus.doc.page.at([0]).replace("after");
  assert.equal(localRequired.snap(), "after");
  assert.equal(localElement.snap(), undefined); assert.throws(localElementMust.hson, /refinement/);
  const localChecked = locus.data.state.at(["value"]).asArray()!;
  await locus.data.state.at(["value"]).replace({ changed: true });
  assert.equal(localChecked.snap(), undefined); assert.throws(localChecked.must.snap);
  let expired: (() => unknown) | undefined;
  await locus.stage(writer => {
    assert.equal("snap" in writer.doc.page, false);
    assert.equal("hson" in writer.doc.page, false);
    assert.equal("must" in writer.parts, true); // Family selector requirement is independent.
    const staged = writer.data.state.at(["value"]);
    assert.equal("must" in staged, false);
    expired = () => staged.replace({});
  });
  assert.throws(() => expired!(), /Expired/);
  const localLibrary = locus.doc.page.must;
  locus.dispose();
  assert.throws(localRequired.snap, /Disposed/); assert.throws(localLibrary.hson, /Disposed/);
}
