import { test_echo_transport } from "./helpers/echo-websocket-transport.mts";
import { bind_locus_websocket } from "../src/api/locus/locus.websocket.ts";
// @hson-live-external-test
import { test_application_catalog } from "./helpers/hosted-catalog.mts";
import assert from "node:assert/strict";
import {
  DocumentContinuationError,
  Hson,
  HsonData,
  add_interaction,
  continue_hosted_document,
  enable_interactions,
  hsonEcho,
  hsonLiveMap,
  hsonLocus,
  type HsonSchema,
  type InteractionDescriptor,
  type InteractionLocalBehaviors,
  type LocusWebSocketLike,
} from "../src/index.ts";
import type { LocusRequestedProjection } from "../src/types/locus.projection.types.ts";
import { get_node_for_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { prepare_hosted_document_internal } from "../src/api/continuation/continue-hosted-document.ts";
import { set_document_adoption_fault_hook_for_tests } from "../src/api/continuation/continuation.adopt.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { project_authority_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import { FakeElement, install_fake_document } from "./helpers/fake-document.mts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";

install_fake_document();

const ButtonSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "button" content "empty">]>>`;
const StateSchema: HsonSchema = Hson.schema`<type "data" content <count "number">>`;

function socketPair(): Readonly<{
  client: LocusWebSocketLike;
  server: LocusWebSocketLike;
  delivered: readonly Readonly<{ type?: string; completionRev?: number }>[];
}> {
  const clientMessages = new Set<(raw: string) => void>();
  const serverMessages = new Set<(raw: string) => void>();
  const clientClose = new Set<() => void>();
  const serverClose = new Set<() => void>();
  const delivered: Readonly<{ type?: string; completionRev?: number }>[] = [];
  return Object.freeze({
    client: Object.freeze({
      send(raw: string) { for (const listener of [...serverMessages]) listener(raw); },
      close() { for (const listener of [...clientClose]) listener(); },
      onMessage(listener: (raw: string) => void) {
        clientMessages.add((raw) => {
          delivered.push(JSON.parse(raw) as Readonly<{ type?: string; completionRev?: number }>);
          listener(raw);
        });
        const registered = [...clientMessages].at(-1)!;
        return () => clientMessages.delete(registered);
      },
      onClose(listener: () => void) { clientClose.add(listener); return () => clientClose.delete(listener); },
    }),
    server: Object.freeze({
      send(raw: string) { for (const listener of [...clientMessages]) listener(raw); },
      close() { for (const listener of [...serverClose]) listener(); },
      onMessage(listener: (raw: string) => void) { serverMessages.add(listener); return () => serverMessages.delete(listener); },
      onClose(listener: () => void) { serverClose.add(listener); return () => serverClose.delete(listener); },
    }),
    delivered,
  });
}

{
  const makeMap = () => admit_exact_runtime_livemap_libraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: parse_hson_exact_runtime("<main <button/>/>", { allowTopLevelDocumentText: true }), schema: ButtonSchema },
  });
  const descriptor: InteractionDescriptor = Object.freeze({
    id: "authoritative-click",
    subject: Object.freeze({ library: "page", path: [0, 0, 0] }),
    kind: "locus",
    key: "save",
    payload: Hson.data.from({ exact: true }),
    listener: Object.freeze({
      event: "click", target: "element", capture: false, once: false, passive: false,
      missingTarget: "throw", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false,
    }),
  });
  const authority = makeMap();
  enable_interactions(authority);
  add_interaction(authority, descriptor);
  let handled: HsonData | undefined;
  const locus = hsonLocus.create({
    map: authority,
    libraries: [...test_application_catalog(authority),
      { name: "ui", ownership: "local", initializer: { data: { value: 0 } } }],
    defaultProjection: { libraries: ["page", "ui"], systemFeatures: ["interactions"] },
    authorizeProjection: () => ({ libraries: ["page", "ui"], systemFeatures: ["interactions"] }),
    actions: { save: (_context, payload) => { handled = payload; } },
  });
  const complete = internal_livemap_aggregate_authority(authority).captureHosted();
  const requested: LocusRequestedProjection = { libraries: ["page"], systemFeatures: ["interactions"] };
  const policy = make_locus_hosted_projection_policy(complete.registry, complete.authority,
    test_application_catalog(authority), requested, () => requested);
  const effective = normalize_locus_effective_projection(policy, requested);
  if (effective instanceof Promise) throw new Error("Expected synchronous continuation projection.");
  const projected = project_authority_snapshot(complete, effective);
  const session = await locus.session.create({ libraries: ["page", "ui"], systemFeatures: ["interactions"] });
  const cut = session.now();
  assert.deepEqual(cut.local.map((entry) => entry.name), ["ui"]);
  const fresh = () => {
    const pair = socketPair();
    const detach = bind_locus_websocket(locus, pair.server);
    return { shared: { credential: session.credential!, transport: test_echo_transport(pair.client) }, detach };
  };
  let wire = fresh();
  const root = new FakeElement("main");
  const button = new FakeElement("button");
  root.appendChild(button);
  await assert.rejects(continue_hosted_document({ ...wire.shared, now: cut, document: "state", root: root as unknown as Element }),
    /unknown|document/i);
  assert.equal(get_node_for_el(root as unknown as Element), undefined);
  wire.detach(); wire = fresh();
  await assert.rejects(
    continue_hosted_document({ ...wire.shared, now: { ...cut, libs: Object.freeze({ ...projected, revision: projected.revision + 1 }) },
      root: root as unknown as Element }),
    (cause) => cause instanceof DocumentContinuationError && cause.phase === "recover",
  );
  assert.equal(get_node_for_el(root as unknown as Element), undefined);
  wire.detach(); wire = fresh();
  await assert.rejects(
    continue_hosted_document({
      ...wire.shared,
      now: cut,
      root: root as unknown as Element,
      interactions: { local: null as unknown as InteractionLocalBehaviors },
    }),
    (cause) => cause instanceof DocumentContinuationError
      && cause.phase === "interactions"
      && cause.cause !== undefined,
  );
  assert.equal(get_node_for_el(root as unknown as Element), undefined);
  wire.detach(); wire = fresh();
  const continuation = await continue_hosted_document({
    ...wire.shared,
    now: cut,
    root: root as unknown as Element,
    interactions: { local: {} },
  });
  assert.equal(continuation.map, continuation.echo.map.lib("page"));
  assert.equal(continuation.echo.map.lib("ui").mode, "data-object");
  button.dispatchEvent(new Event("click"));
  for (let attempt = 0; attempt < 30 && handled === undefined; attempt += 1) await Promise.resolve();
  assert.equal(handled === Hson.data.from({ exact: true }), true);
  continuation.dispose();
  handled = undefined;
  button.dispatchEvent(new Event("click"));
  for (let attempt = 0; attempt < 5; attempt += 1) await Promise.resolve();
  assert.equal(handled, undefined);
  assert.equal(continuation.echo.session.status, "attached");
  continuation.echo.dispose();
  wire.detach();
  locus.dispose();
}

// An admitted but altered initial document cut must reconcile through the
// already-bound Mirror after exact DOM adoption.
{
  const authority = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime("<main <button/>/>", { allowTopLevelDocumentText: true }), schema: ButtonSchema },
  });
  enable_interactions(authority);
  add_interaction(authority, {
    id: "save-click",
    subject: { library: "page", path: [0, 0, 0] },
    kind: "locus",
    key: "save",
    payload: Hson.data.from({ value: 1 }),
    listener: { event: "click", target: "element", capture: false, once: false,
      passive: false, missingTarget: "throw", preventDefault: false, stopPropagation: false,
      stopImmediatePropagation: false },
  });
  const empty = admit_exact_runtime_livemap_libraries({
    page: { document: parse_hson_exact_runtime("<main <button/>/>", { allowTopLevelDocumentText: true }), schema: ButtonSchema },
  });
  enable_interactions(empty);
  const emptyLocus = hsonLocus.create({ map: empty, libraries: test_application_catalog(empty),
    authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }) });
  const emptySession = await emptyLocus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
  const locus = hsonLocus.create({ map: authority, libraries: [
    ...test_application_catalog(authority),
    { name: "ui", ownership: "local", initializer: { data: { value: 0 } } },
  ], authorizeProjection: () => ({ libraries: ["page", "ui"], systemFeatures: ["interactions"] }) });
  const session = await locus.session.create({ libraries: ["page", "ui"], systemFeatures: ["interactions"] });
  const cut = session.now();
  assert.deepEqual(cut.local.map((entry) => entry.name), ["ui"]);
  const mixed = { ...cut, libs: { ...cut.libs, system: emptySession.now().libs.system } };
  const pair = socketPair();
  const detach = bind_locus_websocket(locus, pair.server);
  const root = new FakeElement("main");
  const button = new FakeElement("button");
  root.appendChild(button);
  const continuation = await continue_hosted_document({ now: mixed, credential: session.credential!,
    transport: test_echo_transport(pair.client), root: root as unknown as Element });
  assert.equal(continuation.echo.sync.strategy, "reconcile");
  const ui = continuation.echo.map.lib("ui");
  if (ui.mode === "document") throw new Error("Expected local data Library.");
  assert.equal(ui.snap(["value"]), 0);
  const authorityRev = locus.rev;
  ui.at(["value"]).set(12);
  assert.equal(locus.rev, authorityRev);
  assert.equal(ui.snap(["value"]), 12);
  assert.equal(continuation.map, continuation.echo.map.lib("page"));
  assert.equal(get_node_for_el(button as unknown as Element) !== undefined, true);
  assert.equal(continuation.mirror.status, "active");
  continuation.dispose(); continuation.echo.dispose(); detach(); locus.dispose(); emptyLocus.dispose();
}

// A future declarative marker can remain in the body through preparation and
// disappear before the first exact DOM admission. No matcher exception is used.
{
  const authority = hsonLiveMap.fromLibraries({ page: { document: '<html <head/> <body <button/>/>/>' } });
  enable_interactions(authority);
  add_interaction(authority, {
    id: "prepared-click",
    subject: { library: "page", path: [0, 0, 1, 0, 0] },
    kind: "browser",
    key: "clicker",
    args: Hson.data.from(null),
    listener: { event: "click", target: "element", capture: false, once: false,
      passive: false, missingTarget: "throw", preventDefault: false, stopPropagation: false,
      stopImmediatePropagation: false },
  });
  const locus = hsonLocus.create({ map: authority, libraries: test_application_catalog(authority),
    authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }) });
  const session = await locus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
  const now = session.now({ html: "page" });
  const wire = () => {
    const pair = socketPair();
    return { detach: bind_locus_websocket(locus, pair.server), transport: test_echo_transport(pair.client) };
  };
  const fixture = () => {
    const root = new FakeElement("html");
    const head = new FakeElement("head");
    const body = new FakeElement("body");
    const button = new FakeElement("button");
    body.appendChild(button);
    root.appendChild(head);
    root.appendChild(body);
    return { root, head, body, button };
  };
  const page = fixture();
  const sentinel = new FakeElement("hson-scout");
  sentinel.setAttribute("hidden", "");
  page.body.appendChild(sentinel);
  const connection = wire();
  let clicks = 0;
  const options = { now, credential: session.credential!, transport: connection.transport,
    root: page.root as unknown as Element, interactions: { local: { clicker: () => { clicks += 1; } } } };

  const bodyChildren = page.body.childNodes;
  Object.defineProperty(page.body, "childNodes", { configurable: true, get() {
    throw new Error("Preparation inspected the application body.");
  } });
  const prepared = (() => {
    try { return prepare_hosted_document_internal(options); }
    finally { Object.defineProperty(page.body, "childNodes", { configurable: true, writable: true, value: bodyChildren }); }
  })();
  assert.equal(page.body.childNodes.at(-1), sentinel);
  assert.equal(get_node_for_el(page.root as unknown as Element), undefined);
  assert.equal(get_node_for_el(page.button as unknown as Element), undefined);
  const forbiddenTransport = Object.create(null);
  Object.defineProperty(forbiddenTransport, "operations", { get() {
    throw new Error("Duplicate claim reached Echo preparation.");
  } });
  assert.throws(() => prepare_hosted_document_internal({ ...options, transport: forbiddenTransport }),
    /already has an active document continuation/);
  await assert.rejects(continue_hosted_document({ ...options, transport: forbiddenTransport }),
    /already has an active document continuation/);
  page.body.removeChild(sentinel);
  let adoptionStarts = 0;
  set_document_adoption_fault_hook_for_tests((point) => {
    if (point === "after-first-link") adoptionStarts += 1;
  });
  const starting = prepared.start();
  await assert.rejects(prepared.start(), /starting state/);
  let continuation: Awaited<typeof starting>;
  try { continuation = await starting; }
  finally { set_document_adoption_fault_hook_for_tests(undefined); }
  assert.equal(adoptionStarts, 1);
  assert.equal(continuation.tree.dom.el(), page.root as unknown as Element);
  assert.equal(continuation.tree.find.byTag("button")?.dom.el(), page.button as unknown as Element);
  assert.equal(continuation.tree.find.byTag("hson-scout"), undefined);
  assert.equal(get_node_for_el(sentinel as unknown as Element), undefined);
  assert.equal(continuation.mirror.status, "active");
  page.button.dispatchEvent(new Event("click"));
  assert.equal(clicks, 1);
  await assert.rejects(prepared.start(), /started state/);
  assert.throws(() => prepared.dispose(), /started state/);
  await assert.rejects(continue_hosted_document(options), /already has an active document continuation/);
  continuation.dispose();
  assert.equal(continuation.echo.session.status, "attached");
  continuation.echo.dispose();
  connection.transport.dispose();
  connection.detach();

  const abandonedWire = wire();
  const abandoned = prepare_hosted_document_internal({ ...options, transport: abandonedWire.transport });
  abandoned.dispose();
  abandoned.dispose();
  await assert.rejects(abandoned.start(), /disposed state/);
  abandonedWire.transport.dispose();
  abandonedWire.detach();
  const releasedWire = wire();
  const released = prepare_hosted_document_internal({ ...options, transport: releasedWire.transport });
  released.dispose();
  releasedWire.transport.dispose();
  releasedWire.detach();

  const anotherRoot = fixture();
  const firstRootWire = wire();
  const secondRootWire = wire();
  const firstRoot = prepare_hosted_document_internal({ ...options, transport: firstRootWire.transport });
  const secondRoot = prepare_hosted_document_internal({ ...options,
    root: anotherRoot.root as unknown as Element, transport: secondRootWire.transport });
  firstRoot.dispose();
  secondRoot.dispose();
  firstRootWire.transport.dispose();
  secondRootWire.transport.dispose();
  firstRootWire.detach();
  secondRootWire.detach();

  const mismatch = fixture();
  mismatch.body.removeChild(mismatch.button);
  const mismatchWire = wire();
  const mismatchOptions = { ...options, root: mismatch.root as unknown as Element, transport: mismatchWire.transport };
  const mismatched = prepare_hosted_document_internal(mismatchOptions);
  await assert.rejects(mismatched.start(),
    (cause) => cause instanceof DocumentContinuationError && cause.phase === "adopt");
  assert.equal(get_node_for_el(mismatch.root as unknown as Element), undefined);
  mismatchWire.transport.dispose();
  mismatchWire.detach();
  const retryWire = wire();
  const retry = prepare_hosted_document_internal({ ...mismatchOptions, transport: retryWire.transport });
  retry.dispose();
  retryWire.transport.dispose();
  retryWire.detach();

  const fault = fixture();
  const faultWire = wire();
  const faultPrepared = prepare_hosted_document_internal({ ...options,
    root: fault.root as unknown as Element, transport: faultWire.transport });
  set_document_adoption_fault_hook_for_tests((point) => {
    if (point === "after-first-link") throw new Error("hosted adoption fault");
  });
  try {
    await assert.rejects(faultPrepared.start(),
      (cause) => cause instanceof DocumentContinuationError && cause.phase === "adopt");
  } finally { set_document_adoption_fault_hook_for_tests(undefined); }
  assert.equal(get_node_for_el(fault.root as unknown as Element), undefined);
  assert.equal(get_node_for_el(fault.body as unknown as Element), undefined);
  faultWire.transport.dispose();
  faultWire.detach();

  const stale = fixture();
  const staleWire = wire();
  const staleNow = { ...now, libs: { ...now.libs, revision: now.libs.revision + 1 } };
  const stalePrepared = prepare_hosted_document_internal({ ...options, now: staleNow,
    root: stale.root as unknown as Element, transport: staleWire.transport });
  await assert.rejects(stalePrepared.start(),
    (cause) => cause instanceof DocumentContinuationError && cause.phase === "recover");
  assert.equal(get_node_for_el(stale.root as unknown as Element), undefined);
  staleWire.transport.dispose();
  staleWire.detach();
  locus.dispose();
}

process.stdout.write("Hosted document continuation acceptance passed.\n");
