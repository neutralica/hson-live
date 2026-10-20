import { document_hson_value } from "../helpers/document-hson-value.mts";
import assert from "node:assert/strict";
import { Hson, hsonLiveMap, hsonTransform, LiveMapDocumentMutationError } from "../../src/index.ts";
import { install_libraries_snapshot } from "../../src/api/livemap/index.ts";
import { make_livemap_from_authored_libraries_internal as authored, add_client_local_libraries_internal,
  reconcile_client_projection_snapshot_internal } from "../../src/api/livemap/livemap.libraries.ts";
import { decode_hosted_root } from "../../src/api/livemap/livemap.hosted.ts";
import { capture_selected_authority_projection_snapshot, authority_projection_as_client_composition_internal } from "../../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../../src/api/locus/locus.projection.ts";
import { client_projection_map } from "../helpers/client-projection.mts";
import { test_public_projection } from "../helpers/hosted-catalog.mts";
import { internal_livemap_aggregate_authority as owner } from "../../src/api/livemap/livemap.internal.ts";
import { lookup_document_quad_internal as lookup } from "../../src/api/livemap/livemap.document.quad.ts";
import { validate_document_path } from "../../src/api/livemap/livemap.document.path.ts";
import { set_livemap_quid_candidate_source_for_tests as allocator } from "../../src/api/livemap/livemap.quid-allocation.ts";
import { acquire_document_identity } from "../helpers/livemap-identity-internal.mts";
import type { LiveMap, LiveMapDocumentLibrary } from "../../src/types/livemap.types.ts";

const fixture = () => authored({ page: { document: '<main @:page <button @:nextButton "Next"/> <aside/>/>' } });
function page(map: LiveMap): LiveMapDocumentLibrary {
  const selected = map.doc.must("page"); if (selected.mode !== "document") throw Error("document"); return selected;
}
function atomic(map: LiveMap, run: () => unknown): void {
  const before = map.capture(), ledger = owner(map).identityEpoch().issued();
  const overlays = owner(map).libraries().map(id => owner(map).documentOverlay(id));
  let commits = 0, publications = 0;
  const stop = map.commits.observe(() => commits++), off = owner(map).observeAuthorityPosition(() => publications++);
  try { assert.throws(run); } finally { stop(); off(); }
  assert.deepEqual(map.capture(), before); assert.equal(owner(map).identityEpoch().issued(), ledger);
  owner(map).libraries().forEach((id, i) => assert.equal(owner(map).documentOverlay(id), overlays[i]));
  assert.equal(commits, 0); assert.equal(publications, 0);
}
const button = () => hsonTransform.fromHson('<button title="replacement"/>').toNode().$_content[0]!;
function currency_cause(error: unknown): boolean {
  const seen = new Set<Error>();
  while (error instanceof Error && !seen.has(error)) {
    if (error.message.includes("identity or authority changed during capture")) return true;
    seen.add(error); error = error.cause;
  }
  return false;
}
const retired_subject = (error: unknown): boolean => error instanceof LiveMapDocumentMutationError
  && error.code === "DOCUMENT_TARGET_NOT_FOUND" && error.reason === "QUAD subject lifetime is no longer active";
function shared_projection(map: LiveMap) {
  const snapshot = owner(map).captureHosted(), options = test_public_projection(map);
  const policy = make_locus_hosted_projection_policy(snapshot.registry, snapshot.authority,
    options.libraries, options.defaultProjection, options.authorizeProjection);
  const effective = normalize_locus_effective_projection(policy, options.defaultProjection);
  if (effective instanceof Promise) throw new Error("Expected synchronous fixture projection");
  return capture_selected_authority_projection_snapshot(map, effective);
}

export function document_q_cases(check: (name: string, run: () => void) => void): void {
  check("public q retires on installed hosted incarnation replacement with retained epoch and QUID", () => {
    const map = fixture(), aggregate = owner(map), selected = page(map);
    selected.q("nextButton")!.attrs.set("title", "revision one"); assert.equal(map.rev, 1);
    const old = selected.q("nextButton")!, child = old.at([0]), saved = aggregate.captureHosted();
    const identity = lookup(selected, "nextButton")!, epoch = aggregate.identityEpoch().current();
    const overlay = aggregate.documentOverlay(aggregate.libraries()[0]!);
    const generic = acquire_document_identity(selected.document, { kind: "path", path: identity.path });
    aggregate.restoreHosted(saved, { ...saved.authority, incarnationId: saved.authority.incarnationId + "-replacement" });
    assert.equal(aggregate.identityEpoch().current(), epoch);
    assert.equal(aggregate.documentOverlay(aggregate.libraries()[0]!), overlay);
    assert.deepEqual(lookup(selected, "nextButton"), identity); assert.equal(generic.active, true);
    assert.equal(old.active, false); assert.equal(child.active, false); assert.equal(old.snap(), undefined);
    const before = aggregate.captureHosted(); let commits = 0; const off = map.commits.observe(() => commits++);
    try {
      assert.throws(() => old.attrs.set("title", "crossed"), retired_subject);
      assert.throws(() => child.replace("crossed"), retired_subject);
    } finally { off(); }
    assert.equal(commits, 0); assert.deepEqual(aggregate.captureHosted(), before);
    const fresh = selected.q("nextButton")!; fresh.attrs.set("title", "fresh incarnation");
    assert.equal(fresh.attrs.get("title"), "fresh incarnation");
    aggregate.restoreHosted(saved);
    assert.equal(old.active, false); assert.equal(child.active, false); assert.equal(fresh.active, false);
    assert.throws(() => old.attrs.clear(), retired_subject);
    selected.q("nextButton")!.attrs.set("title", "original incarnation, new capability");
  });
  check("public q incarnation retirement happens before no-poll reentrant restore publication", () => {
    const map = fixture(), aggregate = owner(map), selected = page(map);
    selected.q("nextButton")!.attrs.set("title", "revision one");
    const saved = aggregate.captureHosted(), old = selected.q("nextButton")!, child = old.at([0]);
    let armed = true, observed = 0;
    const off = aggregate.observeRestore(() => {
      if (!armed) return; armed = false; observed++;
      // No old-family read occurs until the original incarnation is restored again.
      aggregate.restoreHosted(saved);
      assert.equal(old.active, false); assert.equal(child.active, false);
      assert.throws(() => old.attrs.set("title", "revived"), retired_subject);
      selected.q("nextButton")!.attrs.set("title", "fresh observer capability");
    });
    try { aggregate.restoreHosted(saved, { ...saved.authority, incarnationId: saved.authority.incarnationId + "-replacement" }); }
    finally { off(); }
    assert.equal(observed, 1); assert.equal(old.active, false); assert.equal(child.snap(), undefined);
    assert.equal(selected.q("nextButton")!.attrs.get("title"), "fresh observer capability");
  });
  check("public q preserves same-incarnation exact restoration and rejects failed replacements without retirement", () => {
    const map = fixture(), aggregate = owner(map), selected = page(map);
    selected.q("nextButton")!.attrs.set("title", "revision one");
    const old = selected.q("nextButton")!, saved = aggregate.captureHosted(), identity = lookup(selected, "nextButton")!;
    assert.throws(() => aggregate.restoreHosted(structuredClone(saved), {
      ...saved.authority, incarnationId: saved.authority.incarnationId + "-failed",
    }), (error: unknown) => error instanceof Error
      && error.message === "Exact hosted snapshot requires its original living runtime owner and epoch.");
    assert.equal(old.active, true); assert.deepEqual(aggregate.captureHosted(), saved);
    old.attrs.set("title", "later"); aggregate.restoreHosted(saved);
    assert.equal(old.active, true); assert.equal(old.attrs.get("title"), "revision one");
    assert.deepEqual(lookup(selected, "nextButton"), identity);
    selected.q("page")!.move(0, 1); assert.deepEqual(old.path(), [1]);
    selected.q("nextButton")!.attrs.set("title", "updated");
    assert.equal(old.active, true); old.attrs.set("title", "updated"); assert.equal(old.attrs.get("title"), "updated");
  });
  check("public q remote incarnation replacement preserves client-local families and projected write guards", () => {
    const source = fixture(), sourceOwner = owner(source);
    page(source).q("nextButton")!.attrs.set("title", "revision one");
    const saved = sourceOwner.captureHosted(), client = client_projection_map({ authority: shared_projection(source), local: {} });
    const localSource = fixture(), localOwner = owner(localSource), localCapture = localSource.capture().libraries[0]!;
    add_client_local_libraries_internal(client, [{ name: "local", family: "document",
      root: decode_hosted_root(localCapture.root), schema: localOwner.librarySchema(localOwner.libraries()[0]!), quads: localCapture.quads }], {});
    const local = client.doc.must("local"); if (String(local.mode) !== "document") throw new Error("Expected local document");
    const localFamily = local.q("nextButton")!, localChild = localFamily.at([0]), projectedFamily = page(client).q("nextButton")!;
    const clientOwner = owner(client), localIdentity = clientOwner.libraries().find(identity =>
      clientOwner.documentOverlay(identity).quidAtPath(lookup(local, "nextButton")!.path) === lookup(local, "nextButton")!.quid)!;
    assert.equal(clientOwner.documentAuthority(localIdentity), undefined);
    const epoch = clientOwner.identityEpoch().current(), localQuid = lookup(local, "nextButton")!.quid;
    sourceOwner.restoreHosted(saved, { ...saved.authority, incarnationId: saved.authority.incarnationId + "-replacement" });
    const manager = {}; clientOwner.claimManagement(manager);
    try {
      reconcile_client_projection_snapshot_internal(client, manager,
        authority_projection_as_client_composition_internal(shared_projection(source)));
      assert.equal(clientOwner.identityEpoch().current(), epoch); assert.equal(lookup(local, "nextButton")!.quid, localQuid);
      assert.equal(localFamily.active, true); assert.equal(localChild.snap(), "Next");
      assert.equal(projectedFamily.active, false);
      assert.throws(() => projectedFamily.attrs.set("title", "old projected"), retired_subject);
      assert.throws(() => page(client).q("nextButton")!.attrs.set("title", "unauthorized"),
        (error: unknown) => error instanceof Error && error.message === "Client LiveMap transition crosses its library mutation authority.");
    } finally { clientOwner.releaseManagement(manager); }
    localFamily.attrs.set("title", "local survived"); assert.equal(localFamily.attrs.get("title"), "local survived");
  });
  check("public q rejects a stale attribute plan after same-revision exact restoration", () => {
    const map = fixture(), aggregate = owner(map), selected = page(map), initial = aggregate.captureHosted();
    selected.q("nextButton")!.attrs.set("title", "A");
    const a = aggregate.captureHosted(), overlayA = aggregate.documentOverlay(aggregate.libraries()[0]!);
    aggregate.restoreHosted(initial);
    selected.q("nextButton")!.attrs.set("title", "B");
    const b = aggregate.captureHosted();
    assert.equal(a.revision, 1); assert.equal(b.revision, 1);
    assert.equal(aggregate.documentOverlay(aggregate.libraries()[0]!), overlayA);
    aggregate.restoreHosted(a);
    const location = selected.q("nextButton")!, names = ["absent"];
    Object.defineProperty(names, "0", { get: () => { aggregate.restoreHosted(b); return "absent"; } });
    let commits = 0, restorations = 0, positions = 0;
    const off = map.commits.observe(() => commits++);
    const stopRestore = aggregate.observeRestore(() => restorations++);
    const stopPosition = aggregate.observeAuthorityPosition(() => positions++);
    try { assert.throws(() => location.attrs.dropMany(names), /identity or authority changed during capture/); }
    finally { off(); stopRestore(); stopPosition(); }
    assert.equal(commits, 0); assert.equal(restorations, 1); assert.equal(positions, 1);
    assert.equal(map.rev, 1); assert.deepEqual(aggregate.captureHosted(), b);
    assert.equal(location.active, true); location.attrs.set("title", "valid");
    assert.equal(map.rev, 2); assert.equal(location.attrs.get("title"), "valid");
  });
  check("public q retirement remains terminal through exact restoration with or without polling", () => {
    for (const poll of [false, true]) {
      const map = fixture(), aggregate = owner(map), selected = page(map);
      const location = selected.q("nextButton")!, child = location.at([0]), saved = aggregate.captureHosted();
      const quid = lookup(selected, "nextButton")!.quid;
      const generic = acquire_document_identity(selected.document, { kind: "path", path: lookup(selected, "nextButton")!.path });
      location.delete();
      if (poll) { assert.equal(location.active, false); assert.equal(child.active, false); }
      aggregate.restoreHosted(saved);
      assert.equal(lookup(selected, "nextButton")!.quid, quid);
      assert.equal(generic.active, true, "generic same-runtime exact restoration remains supported");
      assert.equal(location.active, false); assert.equal(child.active, false); assert.equal(location.snap(), undefined);
      atomic(map, () => location.attrs.set("title", "retired")); atomic(map, () => child.replace("retired"));
      const fresh = selected.q("nextButton")!, independent = selected.q("nextButton")!;
      fresh.attrs.set("title", "restored"); assert.equal(fresh.at([0]).snap(), "Next");
      assert.equal(independent.attrs.get("title"), "restored"); fresh.at([0]).dispose();
      assert.equal(fresh.active, false); assert.equal(independent.active, true);
      selected.q("page")!.move(0, 1); assert.deepEqual(independent.path(), [1]);
      selected.q("nextButton")!.attrs.set("title", "updated");
      assert.equal(independent.active, true); independent.attrs.set("title", "updated");
      assert.equal(location.active, false); assert.equal(child.active, false);
    }
  });
  check("public q uses the owner currency fence across attribute and content argument normalization", () => {
    for (const method of ["setMany", "replaceAttrs", "setStyle", "replace", "insert"]) {
      const map = fixture(), aggregate = owner(map), selected = page(map), initial = aggregate.captureHosted();
      selected.document.attrs.set({ kind: "path", path: [0, 0, 0] }, "title", "A");
      const a = aggregate.captureHosted(); aggregate.restoreHosted(initial);
      selected.document.attrs.set({ kind: "path", path: [0, 0, 0] }, "title", "B");
      const b = aggregate.captureHosted(); aggregate.restoreHosted(a);
      const location = selected.q("nextButton")!;
      let restores = 0, commits = 0;
      const reenter = <T extends object>(value: T): T => new Proxy(value, { ownKeys(target) {
        if (restores++ === 0) aggregate.restoreHosted(b);
        return Reflect.ownKeys(target);
      } });
      const values = reenter({ title: "outer" });
      const content = reenter({ $_tag: "button", $_content: [] });
      const style = reenter({ color: "red" });
      const off = map.commits.observe(() => commits++);
      try {
        assert.throws(() => {
          if (method === "setMany") location.attrs.setMany(values);
          else if (method === "replaceAttrs") location.attrs.replace(values);
          else if (method === "setStyle") location.attrs.set("style", style);
          else if (method === "replace") location.replace(content);
          else location.insert(0, content);
        }, currency_cause, method);
      } finally { off(); }
      assert.ok(restores > 0, method); assert.equal(commits, 0, method); assert.equal(map.rev, 1);
      assert.deepEqual(aggregate.captureHosted(), b); assert.equal(location.active, true);
      location.attrs.set("title", "valid"); assert.equal(location.attrs.get("title"), "valid");
    }
  });
  check("public q latches retirement before a public observer can restore and acquire a new handle", () => {
    const map = fixture(), aggregate = owner(map), selected = page(map), saved = aggregate.captureHosted();
    let armed = true;
    let fresh: ReturnType<typeof selected.q>;
    const off = map.commits.observe(() => {
      if (!armed) return; armed = false;
      aggregate.restoreHosted(saved);
      assert.equal(location.active, false); assert.equal(child.active, false);
      assert.throws(() => location.attrs.set("title", "inside observer"));
      fresh = selected.q("nextButton"); assert.ok(fresh); fresh.attrs.set("title", "fresh");
    });
    const location = selected.q("nextButton")!, child = location.at([0]);
    try { location.delete(); } finally { off(); }
    assert.equal(location.active, false); assert.equal(child.active, false); assert.ok(fresh);
    assert.equal(fresh.active, true); assert.equal(fresh.attrs.get("title"), "fresh");
  });
  check("public q latches an unseen exact-restoration absence before queued restore publications", () => {
    const map = fixture(), aggregate = owner(map), selected = page(map), initial = aggregate.captureHosted();
    selected.document.attrs.set({ kind: "path", path: [0, 0, 0] }, "title", "saved");
    const saved = aggregate.captureHosted(); aggregate.restoreHosted(initial);
    selected.document.content.remove({ kind: "path", path: [0, 0] }, 0);
    const absent = aggregate.captureHosted(); assert.equal(absent.revision, saved.revision);
    aggregate.restoreHosted(saved);
    let armed = true;
    let fresh: ReturnType<typeof selected.q>;
    const off = aggregate.observeRestore(() => {
      if (!armed) return; armed = false;
      aggregate.restoreHosted(saved);
      assert.equal(location.active, false); assert.equal(child.active, false);
      assert.throws(() => child.replace("revived"));
      fresh = selected.q("nextButton"); assert.ok(fresh); fresh.attrs.set("title", "new lifetime");
    });
    const location = selected.q("nextButton")!, child = location.at([0]);
    try { aggregate.restoreHosted(absent); } finally { off(); }
    assert.equal(location.active, false); assert.equal(child.active, false); assert.ok(fresh);
    assert.equal(fresh.active, true); assert.equal(fresh.attrs.get("title"), "new lifetime");
  });
  check("public q observes existing names without issuance or publication, including prototype-shaped names", () => {
    const map = authored({ page: { document: '<main @:constructor <button @:__proto__/> <aside @:_subject/>/>' } });
    const selected = page(map), before = map.capture(), ledger = owner(map).identityEpoch().issued();
    let commits = 0, positions = 0, allocations = 0;
    const off = map.commits.observe(() => commits++), stop = owner(map).observeAuthorityPosition(() => positions++);
    allocator(owner(map).identityEpoch().owner, () => { allocations++; throw Error("lookup minted identity"); });
    try {
      for (const [name, tag] of [["constructor", "main"], ["__proto__", "button"], ["_subject", "aside"]]) {
        const location = selected.q(name!); assert.ok(location); assert.equal(location.active, true);
        const snapshot = document_hson_value(location.hson()); assert.ok(snapshot && typeof snapshot === "object"); assert.equal(snapshot.$_tag, tag);
        snapshot.$_tag = "changed";
        const again = document_hson_value(location.hson()); assert.ok(again && typeof again === "object"); assert.equal(again.$_tag, tag);
      }
      for (const name of ["absent", "toString", "", "bad name"]) assert.equal(selected.q(name), undefined);
      assert.throws(() => Reflect.apply(selected.q, selected, [null]), TypeError);
    } finally { allocator(owner(map).identityEpoch().owner, undefined); off(); stop(); }
    assert.deepEqual(map.capture(), before); assert.equal(owner(map).identityEpoch().issued(), ledger);
    assert.equal(allocations, 0); assert.equal(commits, 0); assert.equal(positions, 0);
    const plain = hsonLiveMap.fromLibraries({ page: { document: '<main/>' }, data: { data: { member: {} } } });
    const clean = plain.capture(); assert.equal(page(plain).q("anything"), undefined);
    assert.equal("q" in plain.data.must("data"), false); assert.equal(owner(plain).identityEpoch().issued().size, 0);
    assert.deepEqual(plain.capture(), clean);
  });
  check("public q edits publish through the owner and movement follows the subject while at stays fixed", () => {
    const map = fixture(), selected = page(map), location = selected.q("nextButton")!, root = selected.q("page")!;
    const fixed = selected.at([0]), text = location.at([0]);
    let commits = 0; const off = map.commits.observe(() => commits++);
    try {
      assert.deepEqual(location.path(), [0]); assert.equal(text.snap(), "Next");
      assert.equal(location.attrs.set("title", "Ready").changed, true);
      location.flags.set("disabled"); assert.equal(location.flags.has("disabled"), true); location.flags.clear("disabled");
      root.move(0, 1); assert.deepEqual(location.path(), [1]); assert.deepEqual(text.path(), [1, 0]);
      assert.deepEqual(fixed.path(), [0]);
      const stationary = document_hson_value(fixed.hson()); assert.ok(stationary && typeof stationary === "object"); assert.equal(stationary.$_tag, "aside");
      assert.equal(fixed.asElement()!.attrs.get("title"), undefined);
      location.attrs.setMany({ title: "Moved", id: "same" }); text.replace("Proceed");
      assert.equal(selected.at([1]).asElement()!.attrs.get("title"), "Moved"); assert.equal(text.snap(), "Proceed");
      location.insert(1, hsonTransform.fromHson('<b/>').toNode().$_content[0]!);
      location.move(1, 0);
      const newOccupant = document_hson_value(text.hson()); assert.ok(newOccupant && typeof newOccupant === "object"); assert.equal(newOccupant.$_tag, "b");
      location.at([0]).delete(); assert.equal(text.snap(), "Proceed");
      assert.equal(location.attrs.must.get("id"), "same"); assert.ok(location.attrs.keys().includes("id"));
      location.attrs.dropMany(["id"]); location.attrs.drop("title"); location.attrs.replace({ title: "Last" }); location.attrs.clear();
      assert.deepEqual(location.attrs.keys(), []);
      assert.equal(commits, map.rev);
    } finally { off(); }
  });
  check("public q canonical correspondence handles fragment roots and nested carriers", () => {
    const map = authored({ page: { document: '<aside/> <section @:section <div <button @:button/>/>/>' } });
    const selected = page(map), location = selected.q("button")!;
    assert.deepEqual(location.path(), [1, 0, 0]); location.attrs.set("title", "deep");
    selected.at([]).asRoot()!.move(1, 0);
    assert.deepEqual(location.path(), [0, 0, 0]); assert.equal(location.attrs.get("title"), "deep");
  });
  check("public q retains precise mutations and retires ordinary replacement or removal without retargeting", () => {
    for (const remove of [false, true]) {
      const map = fixture(), selected = page(map), location = selected.q("nextButton")!, child = location.at([0]);
      const identity = lookup(selected, "nextButton")!.quid;
      selected.q("nextButton")!.attrs.set("title", "updated");
      assert.equal(lookup(selected, "nextButton")!.quid, identity); assert.equal(location.active, true);
      location.attrs.set("title", "updated"); assert.equal(location.attrs.get("title"), "updated");
      if (remove) { location.delete(); selected.q("page")!.insert(0, button()); }
      else location.replace(button());
      assert.equal(location.active, false); assert.equal(child.active, false); assert.equal(location.snap(), undefined);
      assert.equal(selected.q("nextButton"), undefined); assert.throws(() => location.path());
      atomic(map, () => location.attrs.set("title", "stale")); atomic(map, () => child.replace("stale"));
    }
  });
  check("public q fresh restoration and repeated Library names fence old capabilities", () => {
    const map = fixture(), selected = page(map), old = selected.q("nextButton")!, saved = map.capture();
    const first = lookup(selected, "nextButton")!.quid;
    const restored = install_libraries_snapshot(saved).map, fresh = page(restored).q("nextButton")!;
    assert.notEqual(lookup(page(restored), "nextButton")!.quid, first);
    fresh.attrs.set("title", "restored"); assert.equal(old.attrs.get("title"), undefined);
    map.restore(saved); assert.equal(old.active, false); atomic(map, () => old.attrs.clear());
    const current = page(map).q("nextButton")!; assert.notEqual(lookup(page(map), "nextButton")!.quid, first);
    current.attrs.set("title", "new lifetime"); assert.equal(old.snap(), undefined);
    const staleFacade = page(map), stale = current;
    map.restore(saved); assert.equal(stale.active, false); assert.equal(stale.snap(), undefined);
    assert.ok(staleFacade.q("nextButton")); atomic(map, () => stale.attrs.set("title", "cross incarnation"));
  });
  check("public q disposal shares a root-relative family but independent lookups remain active", () => {
    const map = fixture(), selected = page(map), one = selected.q("nextButton")!, child = one.at([0]), two = selected.q("nextButton")!;
    child.dispose(); assert.equal(one.active, false); assert.equal(child.snap(), undefined); assert.equal(two.active, true);
    atomic(map, () => one.attrs.set("title", "disposed")); two.attrs.set("title", "live");
  });
  check("public q rejects Schema exactness and managed edits atomically", () => {
    const schema = Hson.schema`<type "document" tag "main" content <repeat <tag "button" content "empty">>>`;
    const map = authored({ page: { document: '<main @:page <button @:nextButton/>/>', schema } });
    const location = page(map).q("nextButton")!, root = page(map).q("page")!;
    atomic(map, () => location.replace(hsonTransform.fromHson('<aside/>').toNode().$_content[0]!));
    atomic(map, () => root.insert(0, { $_tag: "button", $_meta: { quid: "000009001" }, $_content: [] }));
    atomic(map, () => location.attrs.setMany({ title: "partial", "bad name": "invalid" }));
    const manager = {}; owner(map).claimManagement(manager);
    try {
      assert.ok(page(map).q("nextButton")); assert.equal(location.active, true);
      atomic(map, () => location.attrs.set("title", "unauthorized")); atomic(map, () => location.delete());
    } finally { owner(map).releaseManagement(manager); }
    location.attrs.set("title", "authorized"); assert.equal(location.attrs.get("title"), "authorized");
  });
  check("public q admission reentrancy cannot edit an old occupant or a disposed lifetime", () => {
    for (const dispose of [false, true]) {
      const map = fixture(), selected = page(map), location = selected.q("nextButton")!;
      location.attrs.set("title", "retained");
      let publications = 0; const off = map.commits.observe(() => publications++);
      const names = ["title"];
      Object.defineProperty(names, "0", { get: () => {
        if (dispose) location.dispose(); else selected.q("page")!.move(0, 1);
        return "title";
      } });
      try { assert.throws(() => location.attrs.dropMany(names)); } finally { off(); }
      assert.equal(publications, dispose ? 0 : 1);
      assert.equal(selected.q("nextButton")!.attrs.get("title"), "retained");
      assert.equal(selected.at([dispose ? 1 : 0]).asElement()!.attrs.get("title"), undefined);
      assert.equal(location.active, !dispose);
    }
  });
}
