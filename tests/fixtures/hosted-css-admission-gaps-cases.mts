import assert from "node:assert/strict";
import { admit_hson_data_input, hson_data_text } from "../../src/api/data/hson-data.ts";
import type { LiveMapCssOp } from "../../src/types/livemap.types.ts";
import { lookup_document_quad_internal } from "../../src/api/livemap/livemap.document.quad.ts";
import { document_css_state_internal, document_css_subjects_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { internal_livemap_aggregate_authority as authority } from "../../src/api/livemap/livemap.internal.ts";
import { enumerate_livemap_issued_quids } from "../../src/api/livemap/livemap.identity-epoch.ts";
import { DOCUMENT_SCOPED_QUAD_LIMITS } from "../../src/api/livemap/livemap.document.scoped-quad-codec.ts";
import { decode_document_css_action_subject_context, prepare_document_css_action_subjects, resolve_document_css_action_subjects } from "../../src/internal/css/document-css-action-subjects.ts";
import { document_css_subject_identities } from "../../src/internal/css/css-identity-translation.ts";
import { encode_portable_document_stylesheet } from "../../src/internal/css/portable-document-stylesheet.ts";
import { opaque_document_stylesheet } from "../../src/internal/css/opaque-stylesheet.ts";
import { is_persisted_quid } from "../../src/core/hson-node-quid.ts";
import { queued_fixture } from "./hosted-css-subject-correspondence-cases.mts";
import { deferred, hosted_css_authority_fixture } from "../helpers/hosted-css-authority-fixture.mts";

const wire = (payload: unknown) => hson_data_text(admit_hson_data_input(payload));

function rule(selector: string, key = "admission", scopes: readonly string[] = []): Extract<LiveMapCssOp, { kind: "rule" }> {
  return { domain: "css", kind: "rule", ruleKey: key, scopes,
    rule: { ruleKey: key, scopes, selector, declarations: [["color", "red"]] } };
}
function stylesheet(operation: ReturnType<typeof rule>) {
  return { rules: [operation.rule!], properties: [], keyframes: [],
    order: [{ kind: "rule" as const, ruleKey: operation.ruleKey, scopes: operation.scopes }] };
}

export async function hosted_css_missing_correspondence_cases() {
  const f = await hosted_css_authority_fixture();
  let commits = 0;
  const stop = f.locus.commits.observe(() => { commits++; });
  try {
    const owner = lookup_document_quad_internal(f.owner.doc.must("page"), "label")!;
    const local = lookup_document_quad_internal(f.receiver.doc.must("page"), "label")!;
    for (const selector of [`[hson\\:quid="${local.quid}"]`, `[hson\\:quid="${owner.quid}"]`, '[hson\\:quad="_123456789"]']) {
      const subject = rule(selector), scoped = rule("i", "scope", [`@scope (${selector})`]);
      const operations: LiveMapCssOp[] = [subject, { domain: "css", kind: "batch", operations: [rule(".ordinary"), subject] },
        { domain: "css", kind: "append", stylesheet: stylesheet(subject) },
        { domain: "css", kind: "replace", stylesheet: stylesheet(subject) },
        rule(`:is(${selector}):hover>i`), scoped,
        { domain: "css", kind: "rule", ruleKey: "scope", scopes: scoped.scopes }];
      for (const operation of operations) {
        const before = f.state(), native = f.native(), count = commits;
        const result = await f.continuation.echo.action("document.css", wire({ library: "page", operation }));
        assert.equal(result.type, "error", `${selector}: ${operation.kind}`);
        f.unchanged(before); assert.deepEqual(f.native(), native); assert.equal(commits, count);
      }
    }
    const position = { logicalMapId: f.locus.logicalMapId, incarnationId: f.locus.incarnationId,
      sessionId: f.continuation.echo.session.sessionId!, revision: f.locus.rev, projectionSequence: 0 };
    const subjectContext = { at: position, subjects: [{ name: "_123456789", path: [...owner.path], disposition: "disposable" }] };
    const verified = rule('[hson\\:quad="_123456789"]');
    // A valid first rule never licenses a client-supplied owner or Echo QUID later in the batch.
    for (const quid of [local.quid, owner.quid]) {
      const before = f.state(), native = f.native(), count = commits;
      const result = await f.continuation.echo.action("document.css", wire({ library: "page", subjectContext,
        operation: { domain: "css", kind: "batch", operations: [verified, rule(`[hson\\:quid="${quid}"]`, "unverified")] } }));
      assert.equal(result.type, "error"); f.unchanged(before); assert.deepEqual(f.native(), native); assert.equal(commits, count);
    }
    assert.equal((await f.continuation.echo.action("document.css", wire({ library: "page", subjectContext, operation: verified }))).type, "ack");
    assert.equal(commits, 1); assert.ok(f.owner.doc.must("page").css.snapshot().includes(owner.quid));
    assert.equal((await f.continuation.echo.action("document.css", wire({ library: "page", operation: rule('.plain[data-note="hson:quid"]') }))).type, "ack");
    // Declaration strings and opaque raw stylesheet text are not identity demands.
    const ordinary = rule(".string");
    const operation = { ...ordinary, rule: { ...ordinary.rule!, declarations: [["--text", `'[hson:quid="${owner.quid}"]'`]] } };
    assert.equal((await f.continuation.echo.action("document.css", wire({ library: "page", operation }))).type, "ack");
    assert.equal((await f.continuation.echo.action("document.css", wire({ library: "page", operation: {
      domain: "css", kind: "replace", stylesheet: opaque_document_stylesheet(`[hson\\:quid="${owner.quid}"]{color:blue}`),
    } }))).type, "ack");
    assert.equal(commits, 4);
  } finally { stop(); f.close(); }
  console.log("HTTP CSS admission rejects every missing or mixed subject correspondence carrier without publication.");
}

export async function hosted_css_execution_authorization_cases() {
  for (const subject of [false, true]) for (const revoked of ["projection", "write"] as const) {
    const f = await queued_fixture(false, 1, true), entered = deferred(), release = deferred(), admitted = deferred();
    let commits = 0;
    const stop = f.locus.commits.observe(() => { commits++; });
    try {
      const local = lookup_document_quad_internal(f.receiver.doc.must("page"), "label")!;
      const a = authority(f.map);
      const state = () => ({ snapshot: f.map.capture(), revision: f.locus.rev,
        issued: enumerate_livemap_issued_quids(a.identityEpoch().issued()), commits });
      const barrier = f.run_exclusive(async () => { entered.resolve(); await release.promise; });
      await entered.promise;
      if (revoked === "write") f.writable(false);
      const update = f.session.update({ libraries: revoked === "projection" ? ["state"] : ["page", "state"] });
      f.onAuthorize(admitted.resolve);
      const settled = subject ? assert.rejects(f.page.css(rule(`[hson\\:quid="${local.quid}"]`)), /unavailable|unauthorized|projection/)
        : f.echo.action("document.css", wire({ library: "page", operation: rule(".ordinary") })).then(result => assert.equal(result.type, "error"));
      await admitted.promise;
      const before = state(), native = f.native();
      release.resolve(); await barrier; await update; await settled;
      await f.run_exclusive(() => {});
      assert.deepEqual(state(), before, `${revoked}: ${subject ? "subject" : "ordinary"}`);
      assert.deepEqual(f.native(), native, "Serialized rejection changes no native realization");
    } finally { release.resolve(); stop(); f.close(); }
  }
  // An ordinary action carries no revision fence and may run after an unrelated commit.
  const f = await queued_fixture(), entered = deferred(), release = deferred(), admitted = deferred();
  try {
    const barrier = f.run_exclusive(async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    const earlier = f.locus.stage(w => w.data.must("state").at(["n"]).set(1));
    f.onAuthorize(admitted.resolve);
    const request = f.echo.action("document.css", wire({ library: "page", operation: rule(".no-revision-fence") }));
    await admitted.promise; release.resolve(); await barrier; await earlier;
    assert.equal((await request).type, "ack"); assert.equal(f.locus.rev, 2);
    const retry = await f.echo.retryAction(request.request);
    assert.equal(retry.type, "ack"); assert.equal(retry.delivery, "cached"); assert.equal(f.locus.rev, 2);
  } finally { release.resolve(); f.close(); }
  console.log("HTTP CSS execution rechecks current projection/write grants; subject-free actions retain unfenced revisions and deduplication.");
}

export async function hosted_css_subject_count_cases() {
  const counts = [1, 18, 19, 32, 33, 64, 65, 1024, 1025];
  const f = await queued_fixture(false, counts.at(-1)!);
  try {
    const initial = f.state();
    for (const count of counts) {
      const local = document_css_subjects_internal(f.receiver.doc.must("page"));
      const owner = document_css_subjects_internal(f.map.doc.must("page"));
      const quids = Array.from({ length: count }, (_, index) => lookup_document_quad_internal(f.receiver.doc.must("page"), index === 0 ? "label" : `subject${index}`)!.quid);
      assert.ok(quids.every(is_persisted_quid));
      const operation = rule(quids.map(quid => `[hson\\:quid="${quid}"]`).join(","), `count-${count}`);
      const at = { logicalMapId: f.locus.logicalMapId, incarnationId: f.locus.incarnationId,
        sessionId: f.echo.session.sessionId!, revision: f.locus.rev, projectionSequence: 0 };
      const prepared = prepare_document_css_action_subjects(operation, local, () => ({ at, assertCurrent() {} }));
      assert.ok(prepared.subjectContext); assert.equal(prepared.subjectContext.subjects.length, count);
      assert.equal(new Set(prepared.subjectContext.subjects.map(subject => subject.name)).size, count);
      assert.ok(prepared.subjectContext.subjects.every(subject => subject.name[0] === "_" && is_persisted_quid(subject.name.slice(1))));
      assert.deepEqual(prepare_document_css_action_subjects(operation, local, () => ({ at, assertCurrent() {} })), prepared);
      const translated = resolve_document_css_action_subjects(prepared.operation, prepared.subjectContext, owner);
      assert.deepEqual(resolve_document_css_action_subjects(prepared.operation, prepared.subjectContext, owner), translated,
        "Canonical alpha-renaming is deterministic, unique and accepted by the unchanged label validator");
      const revision = f.locus.rev;
      // This is the public Echo queue and real HTTP admission, not a helper-only cardinality check.
      await f.page.css(operation);
      assert.equal(f.locus.rev, revision + 1);
      const installed = encode_portable_document_stylesheet(document_css_state_internal(f.map.doc.must("page")));
      const references = document_css_subject_identities({ ...installed,
        rules: installed.rules.filter(item => item.ruleKey === operation.ruleKey),
        order: installed.order.filter(item => item.kind === "rule" && item.ruleKey === operation.ruleKey) }, "outbound");
      assert.equal(references.length, count);
      assert.deepEqual(new Set(references), new Set(Array.from({ length: count }, (_, index) => lookup_document_quad_internal(f.map.doc.must("page"), index === 0 ? "label" : `subject${index}`)!.quid)));
    }
    assert.deepEqual(f.state().issued, initial.issued); assert.deepEqual(f.state().receivingIssued, initial.receivingIssued);
    // Honor the complete correspondence bound without allocating identities or changing its validator.
    const maximum = Array.from({ length: DOCUMENT_SCOPED_QUAD_LIMITS.subjects }, (_, index) => ({
      name: `_${String(index).padStart(9, "0")}`, path: [index], disposition: "disposable",
    }));
    const at = { logicalMapId: f.locus.logicalMapId, incarnationId: f.locus.incarnationId,
      sessionId: f.echo.session.sessionId!, revision: f.locus.rev, projectionSequence: 0 };
    assert.equal(decode_document_css_action_subject_context({ at, subjects: maximum }).subjects.length, maximum.length);
    assert.throws(() => decode_document_css_action_subject_context({ at, subjects: [...maximum, { name: "_999999999", path: [maximum.length], disposition: "disposable" }] }));
  } finally { f.close(); }
  console.log(`Hosted canonical disposable labels and authoritative translation passed for ${counts.join(", ")} subjects; correspondence limit retained.`);
}
