// @hson-live-external-test
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
import { get_node_for_el } from "../src/api/livetree/utils/node-map-helpers.ts";
import { default_livetree_runtime } from "../src/api/livetree/runtime/livetree-runtime.ts";
import { capture_locus_bootstrap, install_locus_bootstrap } from "../src/api/locus/locus.bootstrap.ts";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.ts";
import { make_livemap_hosted_mirror_from_snapshot_internal } from "../src/api/livemap/livemap.libraries.ts";
import { FakeElement, FakeText, install_fake_document } from "./helpers/fake-document.mts";
import { parse_hson_exact_runtime } from "../src/internal/exact-runtime-hson-codec.ts";
import { admit_exact_runtime_livemap_node } from "../src/internal/exact-runtime-node-admission.ts";
import { admit_exact_runtime_livemap_libraries } from "../src/internal/exact-runtime-node-admission.ts";

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

function mainFixture(quid: string): Readonly<{ root: FakeElement; child: FakeElement; text: FakeText }> {
  const root = new FakeElement("main");
  const child = new FakeElement("p");
  child.setAttribute("hson:quid", quid);
  const text = new FakeText("hello");
  child.appendChild(text);
  root.appendChild(child);
  return { root, child, text };
}

{
  const quid = "000004001";
  const source = `<main <p @${quid} "hello"/>/>`;
  const authority = documentMap(source);
  const locus = hsonLocus.create({
    map: authority,
    logicalMapId: "hosted-continuation-replay",
    sessions: {},
    authorizeAction: (context) => context.action !== "document.attrs.set"
      || (context.payload === undefined ? undefined : Hson.data.materialize(context.payload) as { name?: string } | undefined)?.name !== "denied",
  });
  const installed = install_locus_bootstrap(capture_locus_bootstrap(locus, "continuation:replay", "/continuation"));
  const replica = installed.map;
  if (replica.mode !== "document") throw new Error("Expected installed document bootstrap.");
  await locus.mutate((draft) => draft.document.attrs.set(path(0, 0), "data-recovered", "yes"));
  const pair = socketPair();
  locus.connect(pair.server);
  const echo = hsonEcho.create({
    socket: pair.client,
    map: replica,
    session: {},
    recovery: installed.recovery,
  });
  echo.connect();
  await echo.session.create();
  const fixture = mainFixture(quid);
  const rootBefore = fixture.root;
  const childBefore = fixture.child;
  const textBefore = fixture.text;
  const runtime = default_livetree_runtime();
  let managerActivations = 0;
  const managerListener = (): void => { managerActivations += 1; };
  runtime.styleDocumentListeners.add(managerListener);
  const continuation = await continue_hosted_document({ echo, root: fixture.root as unknown as Element });
  assert.equal(managerActivations, 0);
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (): void => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
  assert.equal(managerActivations, 1);
  runtime.styleDocumentListeners.delete(managerListener);
  assert.equal(continuation.echo, echo);
  assert.equal(continuation.map, replica);
  assert.equal(continuation.tree.dom.el(), rootBefore as unknown as Element);
  assert.equal(continuation.tree.find.byQuid(quid)?.dom.el(), childBefore as unknown as Element);
  assert.equal(fixture.child.childNodes[0], textBefore);
  assert.equal(echo.recovery.status, "caught_up");
  assert.equal(echo.recovery.lastAppliedRev, replica.rev);
  assert.equal(continuation.reflect.sourceRevision, replica.rev);
  assert.equal(fixture.child.getAttribute("data-recovered"), "yes");

  const childTree = continuation.tree.find.must.byQuid(quid);
  await childTree.async.attrs.set("data-async", "accepted");
  assert.equal(authority.rev, 2);
  assert.equal(replica.rev, 2);
  assert.equal(continuation.reflect.sourceRevision, 2);
  assert.equal(fixture.child.getAttribute("data-async"), "accepted");
  assert.equal(pair.delivered.some((message) => message.type === "ack" && message.completionRev === 2), true);

  const beforeDenial = replica.rev;
  await assert.rejects(childTree.async.attrs.set("denied", "no"));
  assert.equal(replica.rev, beforeDenial);
  assert.equal(fixture.child.getAttribute("denied"), null);

  continuation.dispose();
  assert.equal(echo.session.status, "attached");
  assert.equal(echo.recovery.status, "caught_up");
  const afterDispose = await echo.action("document.attrs.set", {
    target: path(0, 0), name: "data-after-dispose", value: "alive",
  });
  assert.equal(afterDispose.type, "ack");
  assert.equal(replica.document.attrs.get(path(0, 0), "data-after-dispose"), "alive");
  assert.equal(fixture.child.getAttribute("data-after-dispose"), null);
  echo.dispose();
  locus.dispose();
}

{
  const quid = "000004002";
  const source = `<main <p @${quid} "hello"/>/>`;
  const authority = documentMap(source);
  const locus = hsonLocus.create({ map: authority, logicalMapId: "hosted-continuation-recover-failure", sessions: {} });
  const installed = install_locus_bootstrap(capture_locus_bootstrap(locus, "continuation:failure", "/continuation"));
  const replica = installed.map;
  if (replica.mode !== "document") throw new Error("Expected installed document bootstrap.");
  const pair = socketPair();
  locus.connect(pair.server);
  const echo = hsonEcho.create({ socket: pair.client, map: replica, session: {}, recovery: installed.recovery });
  const fixture = mainFixture(quid);
  await assert.rejects(
    continue_hosted_document({ echo, root: fixture.root as unknown as Element }),
    (cause) => cause instanceof DocumentContinuationError && cause.phase === "recover" && cause.cause !== undefined,
  );
  assert.equal(get_node_for_el(fixture.root as unknown as Element), undefined);
  echo.connect();
  await echo.session.create();
  const retry = await continue_hosted_document({ echo, root: fixture.root as unknown as Element });
  assert.equal(retry.reflect.status, "active");
  retry.dispose();
  echo.dispose();
  locus.dispose();
}

{
  const quid = "000004003";
  const source = `<main <p @${quid} "hello"/>/>`;
  const authority = documentMap(source);
  const locus = hsonLocus.create({ map: authority, logicalMapId: "hosted-continuation-snapshot", sessions: {} });
  const bootstrap = capture_locus_bootstrap(locus, "continuation:snapshot", "/continuation");
  const replica = documentMap(source);
  const pair = socketPair();
  locus.connect(pair.server);
  const echo = hsonEcho.create({
    socket: pair.client,
    map: replica,
    session: {},
    recovery: { logicalMapId: bootstrap.logicalMapId },
  });
  echo.connect();
  await echo.session.create();
  const fixture = mainFixture(quid);
  await assert.rejects(
    continue_hosted_document({ echo, root: fixture.root as unknown as Element }),
    (cause) => cause instanceof DocumentContinuationError
      && cause.phase === "reflect"
      && cause.cause !== undefined,
  );
  assert.equal(echo.recovery.status, "caught_up");
  assert.equal(get_node_for_el(fixture.root as unknown as Element), undefined);
  const retry = await continue_hosted_document({ echo, root: fixture.root as unknown as Element });
  assert.equal(retry.reflect.status, "active");
  retry.dispose();
  echo.dispose();
  locus.dispose();
}

{
  const quid = "000004100";
  const makeMap = () => admit_exact_runtime_livemap_libraries({
    state: { data: { count: 0 }, schema: StateSchema },
    page: { document: parse_hson_exact_runtime(`<main <button @${quid}/>/>`, { allowTopLevelDocumentText: true }), schema: ButtonSchema },
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
    actions: { save: (_context, payload) => { handled = payload; } },
  });
  const replica = make_livemap_hosted_mirror_from_snapshot_internal(
    internal_livemap_aggregate_authority(authority).captureHosted(),
  );
  const pair = socketPair();
  locus.connect(pair.server);
  const echo = hsonEcho.create({ socket: pair.client, map: replica, recovery: { logicalMapId: locus.logicalMapId } });
  echo.connect();
  await echo.session.create();
  const root = new FakeElement("main");
  const button = new FakeElement("button");
  button.setAttribute("hson:quid", quid);
  root.appendChild(button);
  await assert.rejects(
    continue_hosted_document({
      echo,
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
