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
  type LocusSocketLike,
} from "../src/index.ts";
import type { LocusRequestedProjection } from "../src/types/locus.projection.types.ts";
import { get_node_for_el } from "../src/api/livetree/utils/node-map-helpers.ts";
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
  client: LocusSocketLike;
  server: LocusSocketLike;
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
    kind: "locus-authoritative",
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
    libraries: test_application_catalog(authority),
    defaultProjection: { libraries: ["page"], systemFeatures: ["interactions"] },
    authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }),
    actions: { save: (_context, payload) => { handled = payload; } },
  });
  const complete = internal_livemap_aggregate_authority(authority).captureHosted();
  const requested: LocusRequestedProjection = { libraries: ["page"], systemFeatures: ["interactions"] };
  const policy = make_locus_hosted_projection_policy(complete.registry, complete.authority,
    test_application_catalog(authority), requested, () => requested);
  const effective = normalize_locus_effective_projection(policy, requested);
  if (effective instanceof Promise) throw new Error("Expected synchronous continuation projection.");
  const projected = project_authority_snapshot(complete, effective);
  const session = await locus.session.create(requested);
  const cut = session.now();
  const fresh = () => {
    const pair = socketPair();
    const detach = locus.connect(pair.server);
    return { shared: { credential: session.credential!, socket: pair.client }, detach };
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
    kind: "locus-authoritative",
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
  const locus = hsonLocus.create({ map: authority, libraries: test_application_catalog(authority),
    authorizeProjection: () => ({ libraries: ["page"], systemFeatures: ["interactions"] }) });
  const session = await locus.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
  const cut = session.now();
  const mixed = { ...cut, libs: { ...cut.libs, system: emptySession.now().libs.system } };
  const pair = socketPair();
  const detach = locus.connect(pair.server);
  const root = new FakeElement("main");
  const button = new FakeElement("button");
  root.appendChild(button);
  const continuation = await continue_hosted_document({ now: mixed, credential: session.credential!,
    socket: pair.client, root: root as unknown as Element });
  assert.equal(continuation.echo.sync.strategy, "reconcile");
  assert.equal(get_node_for_el(button as unknown as Element) !== undefined, true);
  assert.equal(continuation.mirror.status, "active");
  continuation.dispose(); continuation.echo.dispose(); detach(); locus.dispose(); emptyLocus.dispose();
}

process.stdout.write("Hosted document continuation acceptance passed.\n");
