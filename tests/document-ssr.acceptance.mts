// @hson-live-external-test
import assert from "node:assert/strict";
import {
  DocumentSsrError,
  hsonLiveMap,
  hsonLocus,
  render_document,
  render_hosted_document,
  type DocumentLiveMap,
} from "../src/index.ts";
import type {
  LocusRecoveryPlan,
  LocusRecoveryPlanner,
  LocusRecoverySnapshotPlan,
  LocusSnapshotEnvelope,
} from "../src/types/locus.types.ts";
import type { LocusBootstrapAuthority } from "../src/api/locus/locus.bootstrap.ts";
import { set_document_ssr_hook_for_tests } from "../src/api/ssr/ssr.ts";

const target = (...parts: number[]) => Object.freeze({
  kind: "path" as const,
  path: Object.freeze([0, ...parts]),
});

function document_map(source: string): DocumentLiveMap {
  const map = hsonLiveMap.fromHson(source);
  if (map.mode !== "document") throw new Error("Expected a document map.");
  return map;
}

function counted_authority(
  authority: LocusBootstrapAuthority,
  onPlan: (plan: LocusRecoveryPlan) => void,
): LocusBootstrapAuthority {
  const recovery: LocusRecoveryPlanner = Object.freeze({
    plan(request, hooks) {
      const plan = hooks === undefined
        ? authority.recovery.plan(request)
        : authority.recovery.plan(request, hooks);
      onPlan(plan);
      return plan;
    },
    debug: authority.recovery.debug,
    dispose: authority.recovery.dispose,
  });
  return Object.freeze({ stream: authority.stream, recovery });
}

{
  const map = document_map(`<main <p @000005001 "before"/>/>`);
  let captures = 0;
  const counted: DocumentLiveMap = Object.freeze({
    ...map,
    capture: (): ReturnType<DocumentLiveMap["capture"]> => {
      captures += 1;
      return map.capture();
    },
  });
  set_document_ssr_hook_for_tests((point) => {
    if (point === "local-after-capture") {
      map.document.attrs.set(target(0, 0), "data-cut", "after");
    }
  });
  const result = render_document({ map: counted });
  set_document_ssr_hook_for_tests(undefined);
  assert.equal(captures, 1);
  assert.equal(result.bootstrap.rev, 0);
  assert.equal(map.rev, 1);
  assert.doesNotMatch(result.html, /data-cut/);
  assert.match(result.html, /hson:quid="000005001"/);
  assert.deepEqual(result.bootstrap, document_map(`<main <p @000005001 "before"/>/>`).capture());
}

{
  const map = document_map(`<main "old"/>`);
  const before = render_document({ map });
  map.document.attrs.set(target(), "data-version", "new");
  const after = render_document({ map });
  assert.equal(before.bootstrap.rev, 0);
  assert.equal(after.bootstrap.rev, 1);
  assert.doesNotMatch(before.html, /data-version/);
  assert.match(after.html, /data-version="new"/);
}

for (const source of [
  `<main <p "a" "" "b"/>/>`,
  `<main <p @000005002 "quid"/>/>`,
  `<main <p "no quid"/>/>`,
  `<html <head <title "Page"/>/> <body <main "whole"/>/>/>`,
]) {
  const map = document_map(source);
  const first = render_document({ map });
  const second = render_document({ map });
  assert.equal(first.html, second.html);
  assert.deepEqual(first.bootstrap, second.bootstrap);
  assert.equal(map.rev, 0);
}

{
  const paired = render_document({ map: document_map(`<main <p "a" "" "b"/>/>`) });
  assert.match(paired.html, /hson-boundary:v1:/);
  assert.equal(JSON.stringify(paired.bootstrap).includes("hson-boundary"), false);
}

{
  const full = render_document({ map: document_map(`<html <head/> <body <main "whole"/>/>/>`) });
  assert.match(full.html, /^<!doctype html><html>/);
  assert.equal(full.bootstrap.root.$_content.some((item) => typeof item === "string" && /doctype/i.test(item)), false);
  const application = render_document({ map: document_map(`<main "application"/>`) });
  assert.equal(application.html.startsWith("<!doctype"), false);
}

{
  const map = document_map(`<p <div "direct DOM only"/>/>`);
  const before = map.capture();
  assert.throws(
    () => render_document({ map }),
    (cause) => cause instanceof DocumentSsrError
      && cause.phase === "realize"
      && cause.cause instanceof Error
      && cause.cause.name === "BrowserRealizationIncompatibilityError"
      && /canonical path/i.test(`${cause.cause.message} canonical path`),
  );
  assert.deepEqual(map.capture(), before);
  assert.equal(map.rev, 0);
}

const emptyDocument = hsonLiveMap.fromHson("");
if (emptyDocument.mode !== "document") throw new Error("Expected an empty document map.");
for (const map of [emptyDocument, document_map(`<main/> <aside/>`)]) {
  assert.throws(
    () => render_document({ map }),
    (cause) => cause instanceof DocumentSsrError
      && cause.phase === "realize"
      && cause.cause instanceof Error
      && /exactly one ordinary canonical document root/.test(cause.cause.message),
  );
}

{
  const map = document_map(`<main "capture failure"/>`);
  const failing: DocumentLiveMap = Object.freeze({
    ...map,
    capture: (): never => { throw new Error("capture-fault"); },
  });
  assert.throws(
    () => render_document({ map: failing }),
    (cause) => cause instanceof DocumentSsrError
      && cause.phase === "capture"
      && cause.cause instanceof Error
      && cause.cause.message === "capture-fault",
  );
}

{
  const map = document_map(`<main <p @000005003 "hosted N"/>/>`);
  const locus = hsonLocus.create({ map, logicalMapId: "ssr-same-cut", sessions: {} });
  let plans = 0;
  let exactSnapshot: LocusSnapshotEnvelope | undefined;
  const authority = counted_authority(locus, (plan) => {
    plans += 1;
    if (plan.outcome === "snapshot") exactSnapshot = plan.body;
  });
  set_document_ssr_hook_for_tests((point) => {
    if (point === "hosted-after-snapshot") {
      void locus.mutate((draft) => draft.document.attrs.set(
        target(0, 0),
        "data-authority",
        "N+1",
      ));
    }
  });
  const result = render_hosted_document({ authority });
  set_document_ssr_hook_for_tests(undefined);
  assert.equal(plans, 1);
  assert.equal(result.bootstrap, exactSnapshot);
  assert.equal(result.bootstrap.rev, 0);
  assert.equal(map.rev, 1);
  assert.equal(result.bootstrap.logicalMapId, "ssr-same-cut");
  assert.deepEqual(Object.keys(result.bootstrap).sort(), ["hson", "incarnationId", "logicalMapId", "mode", "rev"]);
  assert.equal("endpoint" in result.bootstrap, false);
  assert.equal("locusSelector" in result.bootstrap, false);
  assert.doesNotMatch(result.html, /data-authority/);
  assert.match(result.html, /hson:quid="000005003"/);
  locus.dispose();
}

{
  const map = document_map(`<main "stable"/>`);
  const locus = hsonLocus.create({ map, logicalMapId: "ssr-deterministic", sessions: {} });
  const first = render_hosted_document({ authority: locus });
  const second = render_hosted_document({ authority: locus });
  assert.equal(first.html, second.html);
  assert.deepEqual(first.bootstrap, second.bootstrap);
  locus.dispose();
}

{
  const map = document_map(`<p <div "hosted direct DOM only"/>/>`);
  const before = map.capture();
  const locus = hsonLocus.create({ map, logicalMapId: "ssr-incompatible", sessions: {} });
  assert.throws(
    () => render_hosted_document({ authority: locus }),
    (cause) => cause instanceof DocumentSsrError
      && cause.phase === "realize"
      && cause.cause instanceof Error
      && cause.cause.name === "BrowserRealizationIncompatibilityError",
  );
  assert.deepEqual(map.capture(), before);
  locus.dispose();
}

{
  const data = hsonLiveMap.fromJson({ ready: true });
  const locus = hsonLocus.create({ map: data, logicalMapId: "ssr-wrong-mode", sessions: {} });
  assert.throws(
    () => render_hosted_document({ authority: locus }),
    (cause) => cause instanceof DocumentSsrError && cause.phase === "select",
  );
  locus.dispose();
}

{
  const map = document_map(`<main "malformed semantic state"/>`);
  const locus = hsonLocus.create({ map, logicalMapId: "ssr-malformed-snapshot", sessions: {} });
  let disposed = false;
  const recovery: LocusRecoveryPlanner = Object.freeze({
    plan(request, hooks) {
      const plan = hooks === undefined
        ? locus.recovery.plan(request)
        : locus.recovery.plan(request, hooks);
      if (plan.outcome !== "snapshot") return plan;
      const body: LocusSnapshotEnvelope = Object.freeze({
        logicalMapId: plan.body.logicalMapId,
        incarnationId: plan.body.incarnationId,
        rev: plan.body.rev,
        mode: "document",
        hson: "<",
      });
      const corrupted: LocusRecoverySnapshotPlan = Object.freeze({
        outcome: "snapshot",
        reason: plan.reason,
        body,
        logicalMapId: plan.logicalMapId,
        incarnationId: plan.incarnationId,
        headRev: plan.headRev,
        complete: plan.complete,
        debug: plan.debug,
        dispose() {
          disposed = true;
          plan.dispose();
        },
      });
      return corrupted;
    },
    debug: locus.recovery.debug,
    dispose: locus.recovery.dispose,
  });
  assert.throws(
    () => render_hosted_document({ authority: { stream: locus.stream, recovery } }),
    (cause) => cause instanceof DocumentSsrError
      && cause.phase === "bootstrap"
      && cause.cause instanceof Error,
  );
  assert.equal(disposed, true);
  locus.dispose();
}

{
  const map = document_map(`<main "hosted capture failure"/>`);
  const locus = hsonLocus.create({ map, logicalMapId: "ssr-capture-failure", sessions: {} });
  const recovery: LocusRecoveryPlanner = Object.freeze({
    plan() { throw new Error("hosted-capture-fault"); },
    debug: locus.recovery.debug,
    dispose: locus.recovery.dispose,
  });
  assert.throws(
    () => render_hosted_document({ authority: { stream: locus.stream, recovery } }),
    (cause) => cause instanceof DocumentSsrError
      && cause.phase === "capture"
      && cause.cause instanceof Error
      && cause.cause.message === "hosted-capture-fault",
  );
  locus.dispose();
}

assert.throws(
  () => render_document(null as unknown as Readonly<{ map: DocumentLiveMap }>),
  TypeError,
);

process.stdout.write("Document SSR acceptance passed.\n");
