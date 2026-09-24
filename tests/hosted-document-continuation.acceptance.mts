// @hson-live-external-test
import { test_public_exposure } from "./helpers/hosted-exposure.mts";
import assert from "node:assert/strict";
import {
  DocumentContinuationError,
  Hson,
  HsonData,
  add_interaction,
  continue_hosted_document,
  enable_interactions,
  hson,
  hsonEcho,
  hsonLiveMap,
  hsonLocus,
  type DocumentLiveMap,
  type HsonSchema,
  type InteractionDescriptor,
  type InteractionLocalBehaviors,
  type LocusSocketLike,
} from "../src/index.ts";
import type { LocusRequestedProjection } from "../src/types/locus.projection.types.ts";
import { get_node_for_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { default_livetree_runtime } from "../src/api/livetree/runtime/livetree-runtime.ts";
import { continue_hosted_document_internal as continue_legacy_hosted_document } from "../src/api/continuation/continue-hosted-document.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { project_authority_snapshot } from "../src/api/locus/locus.authority-projection-snapshot.ts";
import { make_locus_hosted_projection_policy, normalize_locus_effective_projection } from "../src/api/locus/locus.projection.ts";
import { FakeElement, FakeText, install_fake_document } from "./helpers/fake-document.mts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_node } from "../src/internal/exact-runtime-node-admission.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";
import { acquire_document_identity } from "./helpers/livemap-identity-internal.mts";

install_fake_document();

const path = (...parts: number[]) => Object.freeze({ kind: "path" as const, path: Object.freeze([0, ...parts]) });
const ButtonSchema: HsonSchema = Hson.schema`<type "document" tag "main" content <sequence [<tag "button" content "empty">]>>`;
const StateSchema: HsonSchema = Hson.schema`<type "data" content <count "number">>`;

function documentMap(source: string): DocumentLiveMap {
  const map = admit_exact_runtime_livemap_node(parse_hson_exact_runtime(source, { allowTopLevelDocumentText: true }));
  if (map.mode !== "document") throw new Error("Expected document map.");
  return map;
}

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

function mainFixture(_quid: string): Readonly<{ root: FakeElement; child: FakeElement; text: FakeText }> {
  const root = new FakeElement("main");
  const child = new FakeElement("p");
  const text = new FakeText("hello");
  child.appendChild(text);
  root.appendChild(child);
  return { root, child, text };
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
    exposure: test_public_exposure(authority),
    defaultProjection: { libraries: ["page"], htmlDocument: "page", systemFeatures: ["interactions"] },
    authorizeProjection: () => ({ libraries: ["page"], htmlDocument: "page", systemFeatures: ["interactions"] }),
    actions: { save: (_context, payload) => { handled = payload; } },
  });
  const complete = internal_livemap_aggregate_authority(authority).captureHosted();
  const requested: LocusRequestedProjection = { libraries: ["page"], htmlDocument: "page", systemFeatures: ["interactions"] };
  const policy = make_locus_hosted_projection_policy(complete.registry, complete.authority,
    test_public_exposure(authority), requested, () => requested);
  const effective = normalize_locus_effective_projection(policy, requested);
  if (effective instanceof Promise) throw new Error("Expected synchronous continuation projection.");
  const projected = project_authority_snapshot(complete, effective);
  const replica = hsonLiveMap.fromClientSnapshot({ authority: projected, localLibraries: {} });
  const pair = socketPair();
  locus.connect(pair.server);
  const echo = hsonEcho.create({ socket: pair.client, map: replica, recovery: { logicalMapId: locus.logicalMapId } });
  echo.connect();
  await echo.session.create();
  const root = new FakeElement("main");
  const button = new FakeElement("button");
  root.appendChild(button);
  const otherRequest: LocusRequestedProjection = { libraries: ["page"], htmlDocument: "page" };
  const otherPolicy = make_locus_hosted_projection_policy(complete.registry, complete.authority,
    test_public_exposure(authority), otherRequest, () => otherRequest);
  const otherEffective = normalize_locus_effective_projection(otherPolicy, otherRequest);
  if (otherEffective instanceof Promise) throw new Error("Expected synchronous alternate projection.");
  const otherProjected = project_authority_snapshot(complete, otherEffective);
  await assert.rejects(
    continue_hosted_document({ echo, authority: otherProjected, root: root as unknown as Element }),
    /authority projection does not match/i,
  );
  assert.equal(get_node_for_el(root as unknown as Element), undefined);
  await assert.rejects(
    continue_hosted_document({ echo, authority: Object.freeze({ ...projected, revision: projected.revision + 1 }),
      root: root as unknown as Element }),
    /authority projection does not match/i,
  );
  assert.equal(get_node_for_el(root as unknown as Element), undefined);
  await assert.rejects(
    continue_hosted_document({
      echo,
      authority: projected,
      root: root as unknown as Element,
      interactions: { local: null as unknown as InteractionLocalBehaviors },
    }),
    (cause) => cause instanceof DocumentContinuationError
      && cause.phase === "interactions"
      && cause.cause !== undefined,
  );
  assert.equal(get_node_for_el(root as unknown as Element), undefined);
  const continuation = await continue_hosted_document({
    echo,
    authority: projected,
    root: root as unknown as Element,
    interactions: { local: {} },
  });
  assert.equal(continuation.map, replica.lib("page"));
  button.dispatchEvent(new Event("click"));
  for (let attempt = 0; attempt < 30 && handled === undefined; attempt += 1) await Promise.resolve();
  assert.equal(handled === Hson.data.from({ exact: true }), true);
  continuation.dispose();
  handled = undefined;
  button.dispatchEvent(new Event("click"));
  for (let attempt = 0; attempt < 5; attempt += 1) await Promise.resolve();
  assert.equal(handled, undefined);
  assert.equal(echo.session.status, "attached");
  echo.dispose();
  locus.dispose();
}

process.stdout.write("Hosted document continuation acceptance passed.\n");
