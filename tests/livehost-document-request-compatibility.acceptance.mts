// @hson-live-external-test
import assert from "node:assert/strict";
import {
  create_livehost_persistent_store,
  create_persistent_livehost,
  hson,
} from "../src/index.ts";
import { resolve_livehost_document_action } from "../src/api/livehost/livehost.document-actions.ts";
import { make_livehost_action_dedupe_store } from "../src/api/livehost/livehost.actions.ts";
import {
  decode_livehost_canonical_commit,
  decode_livehost_server_message,
} from "../src/api/livehost/livehost.protocol.ts";
import type {
  ElementLiveMap,
  LiveMapAuthority,
  LiveMapGraphCommit,
} from "../src/types/livemap.types.ts";
import type {
  LiveHostPersistenceAdapter,
  LiveHostPersistedCommit,
  LiveHostPersistedDocumentCheckpoint,
  LiveHostPersistedMapState,
} from "../src/types/livehost.types.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

const Q1 = "000000721";
const Q2 = "000000722";

let checks = 0;
let sequence = Promise.resolve();
function check(name: string, run: () => void | Promise<void>): void {
  sequence = sequence.then(async () => {
    await run();
    checks += 1;
    process.stdout.write(`ok ${checks} - ${name}\n`);
  });
}

function element(source: string): ElementLiveMap {
  const map = hson.liveMap.fromHson(source);
  if (map.mode !== "element") throw new Error("Expected element LiveMap");
  return map;
}

function legacyEnvelope(
  ops: readonly unknown[],
  mode: "element" | "fragment" = "element",
  prevRev = 0,
): unknown {
  return {
    logicalMapId: "unit-5-host",
    incarnationId: "unit-5-incarnation",
    mode,
    prevRev,
    rev: prevRev + 1,
    ops,
  };
}

function legacySet(quid: string, value = "legacy"): unknown {
  return {
    domain: "graph",
    op: "set-attr",
    target: { kind: "quid", quid },
    name: "id",
    value,
  };
}

function readyAction(
  map: LiveMapAuthority,
  name: string,
  payload: Parameters<typeof resolve_livehost_document_action>[2],
) {
  const resolution = resolve_livehost_document_action(map, name, payload);
  if (resolution.kind !== "ready") throw new Error(`Expected ready document action, observed ${resolution.kind}`);
  return resolution;
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

function operationTarget(operation: unknown): unknown {
  return field(operation, "target");
}

function targetField(operation: unknown, name: string): unknown {
  return field(operationTarget(operation), name);
}

function executeOnDraft(
  action: ReturnType<typeof readyAction>,
  draft: object,
): LiveMapGraphCommit {
  return Reflect.apply(action.execute, action, [draft]);
}

class CapturingPersistenceAdapter implements LiveHostPersistenceAdapter {
  state: LiveHostPersistedMapState | undefined;
  readonly appended: LiveHostPersistedCommit[] = [];

  async load(): Promise<LiveHostPersistedMapState | undefined> {
    return this.state === undefined ? undefined : structuredClone(this.state);
  }

  async appendCommit(record: LiveHostPersistedCommit): Promise<void> {
    if (this.state === undefined) throw new Error("Checkpoint required");
    this.appended.push(record);
    this.state = Object.freeze({
      checkpoint: this.state.checkpoint,
      commits: Object.freeze([...this.state.commits, record]),
    });
  }

  async replaceCheckpoint(record: LiveHostPersistedDocumentCheckpoint): Promise<void> {
    this.state = Object.freeze({ checkpoint: record, commits: Object.freeze([]) });
  }
}

check("strict canonical decoder rejects a QUID-only target", () => {
  assert.equal(decode_livehost_canonical_commit(legacyEnvelope([legacySet(Q1)])), undefined);
});

check("the current server decoder rejects QUID-only canonical input", () => {
  const decoded = decode_livehost_server_message(JSON.stringify({
    type: "commit",
    id: "strict",
    commit: legacyEnvelope([legacySet(Q1)]),
  }));
  assert.equal(decoded.ok, false);
});

check("LiveHost path action publishes a canonical path target", async () => {
  const map = element(`<main/>`);
  const host = hson.liveHost.create({ map, logicalMapId: "path-action" });
  const action = readyAction(map, "document.attrs.set", {
    target: { kind: "path", path: [] }, name: "id", value: "path",
  });
  await host.mutate((draft) => executeOnDraft(action, draft));
  assert.deepEqual(operationTarget(host.stream.history.replay_after(0)?.[0]?.ops[0]), { kind: "path", path: [] });
  host.dispose();
});

check("LiveHost QUID action lowers inside mutation execution", async () => {
  const map = element(`<main @${Q1}/>`);
  const host = hson.liveHost.create({ map, logicalMapId: "quid-action" });
  const action = readyAction(map, "document.attrs.set", {
    target: { kind: "quid", quid: Q1 }, name: "id", value: "quid",
  });
  await host.mutate((draft) => executeOnDraft(action, draft));
  assert.deepEqual(operationTarget(host.stream.history.replay_after(0)?.[0]?.ops[0]), {
    kind: "path", path: [], witness: { quid: Q1 },
  });
  host.dispose();
});

check("changed LiveHost history contains no QUID-only target", async () => {
  const map = element(`<main @${Q1}/>`);
  const host = hson.liveHost.create({ map });
  const action = readyAction(map, "document.attrs.set", {
    target: { kind: "quid", quid: Q1 }, name: "id", value: "x",
  });
  await host.mutate((draft) => executeOnDraft(action, draft));
  const target = operationTarget(host.stream.history.replay_after(0)?.[0]?.ops[0]);
  assert.equal(field(target, "kind"), "path");
  host.dispose();
});

check("no-op LiveHost action publishes no canonical commit", async () => {
  const map = element(`<main id="same" @${Q1}/>`);
  const host = hson.liveHost.create({ map });
  const action = readyAction(map, "document.attrs.set", {
    target: { kind: "quid", quid: Q1 }, name: "id", value: "same",
  });
  const commit = await host.mutate((draft) => executeOnDraft(action, draft));
  assert.equal(commit.changed, false);
  assert.equal(host.stream.history.debug().retainedCommitCount, 0);
  host.dispose();
});

check("failed LiveHost QUID resolution changes no authority state", async () => {
  const map = element(`<main/>`);
  const host = hson.liveHost.create({ map });
  const before = map.capture();
  const action = readyAction(map, "document.attrs.set", {
    target: { kind: "quid", quid: Q1 }, name: "id", value: "bad",
  });
  await assert.rejects(host.mutate((draft) => executeOnDraft(action, draft)));
  assert.deepEqual(map.capture(), before);
  host.dispose();
});

check("failed LiveHost QUID resolution appends no history", async () => {
  const map = element(`<main/>`);
  const host = hson.liveHost.create({ map });
  const action = readyAction(map, "document.attrs.set", {
    target: { kind: "quid", quid: Q1 }, name: "id", value: "bad",
  });
  await assert.rejects(host.mutate((draft) => executeOnDraft(action, draft)));
  assert.equal(host.stream.history.debug().retainedCommitCount, 0);
  host.dispose();
});

check("exclusive FIFO resolves queued QUID request after the preceding move", async () => {
  const map = element(`<main <a @${Q1}/> <b @${Q2}/>/>`);
  const host = hson.liveHost.create({ map });
  const move = readyAction(map, "document.content.move", {
    target: { kind: "path", path: [0] }, from: 0, to: 1,
  });
  const set = readyAction(map, "document.attrs.set", {
    target: { kind: "quid", quid: Q1 }, name: "id", value: "queued",
  });
  const first = host.mutate((draft) => executeOnDraft(move, draft));
  const second = host.mutate((draft) => executeOnDraft(set, draft));
  await first;
  const accepted = await second;
  assert.deepEqual(targetField(accepted.ops[0], "path"), [0, 1]);
  host.dispose();
});

check("deduplicated QUID action executes and resolves once", async () => {
  const map = element(`<main @${Q1}/>`);
  const host = hson.liveHost.create({ map });
  const dedupe = make_livehost_action_dedupe_store(() => map.rev, () => 0);
  const action = readyAction(map, "document.attrs.set", {
    target: { kind: "quid", quid: Q1 }, name: "id", value: "once",
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let executions = 0;
  const request = {
    clientId: "unit-5-client",
    requestId: "same-request",
    actionName: "document.attrs.set",
    payload: { target: { kind: "quid" as const, quid: Q1 }, name: "id", value: "once" },
    retry: false,
    run: async () => {
      executions += 1;
      await gate;
      const commit = await host.mutate((draft) => executeOnDraft(action, draft));
      return { state: "succeeded" as const, seq: 1, completionRev: commit.rev };
    },
  };
  const firstPromise = dedupe.execute(request);
  const secondPromise = dedupe.execute(request);
  release();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(first.ok && second.ok && first.delivery !== second.delivery, true);
  assert.equal(executions, 1);
  assert.equal(host.stream.history.debug().retainedCommitCount, 1);
  assert.equal(dedupe.debug().executionsStarted, 1);
  dedupe.dispose();
  host.dispose();
});

check("recovery replay body exposes path-authoritative history", async () => {
  const map = element(`<main @${Q1}/>`);
  const host = hson.liveHost.create({ map, logicalMapId: "recovery-paths" });
  const action = readyAction(map, "document.attrs.set", {
    target: { kind: "quid", quid: Q1 }, name: "one", value: "1",
  });
  await host.mutate((draft) => executeOnDraft(action, draft));
  const plan = host.recovery.plan({
    logicalMapId: host.stream.logicalMapId,
    incarnationId: host.stream.incarnationId,
    lastAppliedRev: 0,
  });
  if (plan.outcome !== "replay") throw new Error(`Expected replay, observed ${plan.outcome}`);
  assert.equal(targetField(plan.body[0]?.ops[0], "kind"), "path");
  plan.dispose();
  host.dispose();
});

check("recovery tail generated after the cut contains path targets", async () => {
  const map = element(`<main @${Q1}/>`);
  const host = hson.liveHost.create({ map, logicalMapId: "recovery-tail-paths" });
  const first = readyAction(map, "document.attrs.set", {
    target: { kind: "quid", quid: Q1 }, name: "one", value: "1",
  });
  await host.mutate((draft) => executeOnDraft(first, draft));
  const plan = host.recovery.plan({
    logicalMapId: host.stream.logicalMapId,
    incarnationId: host.stream.incarnationId,
    lastAppliedRev: 0,
  });
  if (plan.outcome === "reject") throw new Error("Unexpected recovery rejection");
  const second = readyAction(map, "document.attrs.set", {
    target: { kind: "quid", quid: Q1 }, name: "two", value: "2",
  });
  await host.mutate((draft) => executeOnDraft(second, draft));
  const completed = plan.complete();
  assert.equal(targetField(completed.tail[0]?.ops[0], "kind"), "path");
  plan.dispose();
  host.dispose();
});

check("persistence load rejects a QUID-only canonical tail", async () => {
  const adapter = new CapturingPersistenceAdapter();
  const original = element(`<main @${Q1}/>`);
  const initial = await create_persistent_livehost({
    map: original,
        persistence: adapter,
    logicalMapId: "unit-5-host",
    incarnationId: "unit-5-incarnation",
  });
  initial.dispose();
  const checkpoint = adapter.state?.checkpoint;
  if (checkpoint === undefined) throw new Error("Expected persisted checkpoint");
  Reflect.set(adapter, "state", Object.freeze({
    checkpoint,
    commits: Object.freeze([Object.freeze({
      logicalMapId: "unit-5-host",
      incarnationId: "unit-5-incarnation",
      mapKind: "document",
      commit: legacyEnvelope([legacySet(Q1)]),
    })]),
  }));
  const store = create_livehost_persistent_store(adapter);
  const loaded = await store.load("unit-5-host");
  assert.equal(loaded.ok, false);
});

check("new persistence append stores a path target", async () => {
  const adapter = new CapturingPersistenceAdapter();
  const map = element(`<main @${Q1}/>`);
  const host = await create_persistent_livehost({ map, persistence: adapter });
  await host.mutate((draft) => draft.document.attrs.set(
    { kind: "quid", quid: Q1 }, "id", "persisted",
  ));
  assert.equal(targetField(adapter.appended[0]?.commit.ops[0], "kind"), "path");
  host.dispose();
});

check("new persistence append retains only an optional witness QUID", async () => {
  const adapter = new CapturingPersistenceAdapter();
  const map = element(`<main @${Q1}/>`);
  const host = await create_persistent_livehost({ map, persistence: adapter });
  await host.mutate((draft) => draft.document.attrs.set(
    { kind: "quid", quid: Q1 }, "id", "persisted",
  ));
  assert.deepEqual(operationTarget(adapter.appended[0]?.commit.ops[0]), {
    kind: "path", path: [], witness: { quid: Q1 },
  });
  host.dispose();
});

check("Unit 5 adds no canonical protocol version field", async () => {
  const map = element(`<main @${Q1}/>`);
  const host = hson.liveHost.create({ map, logicalMapId: "unchanged-format" });
  const action = readyAction(map, "document.attrs.set", {
    target: { kind: "quid", quid: Q1 }, name: "id", value: "x",
  });
  await host.mutate((draft) => executeOnDraft(action, draft));
  const commit = host.stream.history.replay_after(0)?.[0];
  assert.deepEqual(Object.keys(commit ?? {}).sort(), [
    "incarnationId", "logicalMapId", "mode", "ops", "prevRev", "rev",
  ]);
  host.dispose();
});

check("read-only hosted byQuid remains a lookup rather than a mutation", () => {
  const map = element(`<main @${Q1}/>`);
  const host = hson.liveHost.create({ map });
  assert.equal(host.map.document.byQuid(Q1)?.$_tag, "main");
  assert.equal(host.stream.history.debug().retainedCommitCount, 0);
  host.dispose();
});

await sequence;
process.stdout.write(`# ${checks} LiveHost request compatibility checks passed\n`);
emit_hson_live_test_completion("livehost.document-request-compatibility", checks, checks, 0);
