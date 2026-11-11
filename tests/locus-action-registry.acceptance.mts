import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { ANY_DATA, Hson, HsonDataValue, hsonLiveMap, type LocusInteractionDescriptor } from "../src/index.ts";
import { LocusPersistenceAppendUncertainError, LocusPersistenceError, type LocusClientActionResult } from "../src/api/locus/index.ts";
import { admit_locus_remote_action_internal } from "../src/api/locus/locus.remote-action.internal.ts";
import { attach_locus_semantic_transport_internal } from "../src/api/locus/locus.transport.internal.ts";
import { deferred, MemoryCheckpointAdapter } from "./helpers/memory-checkpoint-adapter.mts";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.action-registry",
  title: "Locus action registry and immediate execution",
  category: "Locus",
  runtime: "node",
  tags: Object.freeze(["locus", "actions", "admission", "persistence"]),
});

const testEvents = create_test_event_emitter("locus.action-registry");
let checks = 0;
async function check(name: string, run: () => Promise<void>) {
  testEvents.case_begin(name, name);
  try {
    await run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  process.stdout.write(`ok ${++checks} - ${name}\n`);
}

function actionError(result: LocusClientActionResult, code: string) {
  assert.ok(result.type === "error");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
  return result.error;
}

const countSchema = Hson.schema`<type "data" content <value "number">>`;
const definitions = {
  state: { json: { value: 0 }, schema: countSchema },
  page: { document: "<main <button/>/>", access: "shared" },
} as const;
const advance: LocusInteractionDescriptor = {
  id: "advance",
  kind: "locus",
  key: "deck.advance",
  payload: { step: 1 },
  subject: { library: "page", path: [0, 0, 1, 0, 0, 0, 0] },
  listener: { event: "click", target: "element", capture: false, once: false, passive: false,
    missingTarget: "ignore", preventDefault: false, stopPropagation: false, stopImmediatePropagation: false },
};

await check("bare definitions execute with governed reads, staged writes, and fresh invocation identities", async () => {
  const locus = hsonLiveMap.locus.create(definitions);
  const ids: string[] = [];
  try {
    const before = locus.cut();
    const requests = locus.actionRequests.debug();
    locus.actions.define("deck.advance", (context, input, message) => {
      ids.push(message.id);
      assert.deepEqual(context.origin, { kind: "direct" });
      assert.equal(context.data.must("state").snap(["value"]), ids.length - 1);
      assert.strictEqual(message.payload, input);
      context.stage.data.must("state").at(["value"]).set(ids.length);
      return input;
    });
    assert.deepEqual(locus.cut(), before);
    assert.equal(locus.rev, 0);
    const first = await locus.actions.trigger("deck.advance", { step: 1 });
    assert.ok(first.type === "ack" && first.ok);
    assert.deepEqual(first.result?.materialize(), { step: 1 });
    assert.deepEqual([first.seq, first.completionRev, locus.rev], [1, 1, 1]);
    assert.equal(first.id, ids[0]);
    const second = await locus.actions.trigger("deck.advance", { step: 1 });
    assert.ok(second.type === "ack" && second.ok);
    assert.notEqual(first.id, second.id);
    assert.deepEqual([second.seq, second.completionRev, locus.rev], [2, 2, 2]);
    assert.deepEqual(locus.actionRequests.debug(), requests);
    assert.equal(locus.session.debug().sessions.length, 0);
  } finally { locus.dispose(); }
});

await check("input contracts distinguish omission, null, and Schema mismatch", async () => {
  const received: (HsonDataValue | undefined)[] = [];
  const echoInput = (_context: unknown, input: HsonDataValue | undefined) => {
    received.push(input);
    return input;
  };
  const locus = hsonLiveMap.locus.create({}, { actions: {
    initialRequired: { handler: echoInput, input: { schema: countSchema, required: true } },
    initialPresence: { handler: echoInput, input: { required: true } },
  } });
  try {
    locus.actions.define("optional", echoInput, { input: { schema: countSchema } });
    locus.actions.define("required", echoInput, { input: { schema: countSchema, required: true } });
    locus.actions.define("presence", echoInput, { input: { required: true } });
    locus.actions.define("nullable", echoInput, { input: { schema: ANY_DATA, required: true } });
    const omitted = await locus.actions.trigger("optional");
    assert.ok(omitted.type === "ack");
    assert.equal(Object.hasOwn(omitted, "result"), false);
    assert.equal(received.at(-1), undefined);
    for (const name of ["initialRequired", "initialPresence", "required", "presence", "nullable"]) {
      actionError(await locus.actions.trigger(name), "LOCUS_SCHEMA_INVALID_PAYLOAD");
    }
    actionError(await locus.actions.trigger("optional", null), "LOCUS_SCHEMA_INVALID_PAYLOAD");
    actionError(await locus.actions.trigger("required", { value: "wrong" }), "LOCUS_SCHEMA_INVALID_PAYLOAD");
    assert.equal(received.length, 1);
    const valid = await locus.actions.trigger("required", { value: 2 });
    assert.ok(valid.type === "ack" && valid.result === received.at(-1));
    for (const name of ["initialPresence", "presence", "nullable"]) {
      const result = await locus.actions.trigger(name, null);
      assert.ok(result.type === "ack" && result.result === received.at(-1));
      assert.equal(result.result?.scalar(), null);
      assert.equal(result.completionRev, 0);
    }
    assert.equal(locus.rev, 0);
  } finally { locus.dispose(); }
});

await check("Schema admission preserves the exact input and result carrier", async () => {
  const schema = Hson.schema`<type "data" content <'10' "number" '2' "number">>`;
  const locus = hsonLiveMap.locus.create({});
  const exact = Hson.data.fromSource('{"10":-0,"2":2}');
  const materialize = HsonDataValue.prototype.materialize;
  try {
    locus.actions.define("exact", (_context, input, message) => {
      assert.strictEqual(input, exact);
      assert.strictEqual(message.payload, exact);
      return input;
    }, { input: { schema } });
    HsonDataValue.prototype.materialize = () => { throw new Error("Schema admission must use the exact carrier."); };
    const result = await locus.actions.trigger("exact", exact);
    assert.ok(result.type === "ack" && result.result === exact);
    const entries = result.result.entries();
    assert.deepEqual(entries?.map(([name]) => name), ["10", "2"]);
    assert.ok(Object.is(entries?.[0]?.[1].scalar(), -0));
  } finally {
    HsonDataValue.prototype.materialize = materialize;
    locus.dispose();
  }
});

await check("initial and additive definitions share membership and captured contracts", async () => {
  const handler = (_context: unknown, input: HsonDataValue | undefined) => input;
  const initial = { handler, input: { schema: countSchema } };
  const locus = hsonLiveMap.locus.create({}, { actions: { initial } });
  const documentSchema = Hson.schema`<type "document" tag "main" content "empty">`;
  try {
    const before = locus.cut();
    const options = { input: { schema: countSchema } };
    locus.actions.define("added", handler, options);
    initial.input.schema = options.input.schema = ANY_DATA;
    for (const name of ["initial", "added"]) {
      assert.throws(() => locus.actions.define(name, handler), /already defined/);
      const omitted = await locus.actions.trigger(name);
      assert.ok(omitted.type === "ack" && omitted.result === undefined);
      actionError(await locus.dispatchAction({ type: "action", id: name, name, payload: { value: "wrong" } }),
        "LOCUS_SCHEMA_INVALID_PAYLOAD");
      const result = await locus.dispatchAction({ type: "action", id: name, name, payload: { value: 8 } });
      assert.ok(result.type === "ack");
      assert.deepEqual(result.result?.materialize(), { value: 8 });
    }
    assert.throws(() => locus.actions.define("document.attrs.set", handler), /reserved.*built-in/);
    for (const args of [
      ["", handler],
      [3, handler],
      ["retry", "handler"],
      ["retry", handler, { input: null }],
      ["retry", handler, { input: { required: "yes" } }],
      ["retry", handler, { input: { schema: {} } }],
      ["retry", handler, { input: { schema: documentSchema } }],
      ["retry", handler, { input: { decoder: handler } }],
    ]) assert.throws(() => Reflect.apply(locus.actions.define, undefined, args), TypeError);
    actionError(await locus.actions.trigger("retry"), "LOCUS_UNKNOWN_ACTION");
    locus.actions.define("retry", handler);
    for (const schema of [{}, documentSchema, handler]) {
      assert.throws(() => Reflect.apply(hsonLiveMap.locus.create, undefined,
        [{}, { actions: { valid: handler, bad: { handler, input: { schema } } } }]), TypeError);
    }
    let legacyCalls = 0;
    assert.throws(() => Reflect.apply(hsonLiveMap.locus.create, undefined, [{}, {
      actions: { initial: handler },
      schema: { actions: { initial: { payload: () => { legacyCalls++; return true; } } } },
    }]), /Configure action input in its definition/);
    assert.equal(legacyCalls, 0);
    for (const name of ["constructor", "__proto__", "toString", "document.custom"]) {
      actionError(await locus.actions.trigger(name), "LOCUS_UNKNOWN_ACTION");
      locus.actions.define(name, handler);
      const result = await locus.actions.trigger(name, name);
      assert.ok(result.type === "ack" && result.result?.scalar() === name);
    }
    assert.deepEqual(locus.cut(), before);
    assert.equal(locus.rev, 0);
  } finally { locus.dispose(); }
});

await check("durable startup snapshots handler and input before a pending load", async () => {
  for (const existing of [false, true]) {
    const entered = deferred(), release = deferred();
    const persistence = new class extends MemoryCheckpointAdapter {
      hold = false;
      async load(id: string) {
        if (this.hold) { entered.resolve(); await release.promise; }
        return super.load(id);
      }
    }();
    const logicalMapId = `registry-startup-${existing}`;
    if (existing) (await hsonLiveMap.locus.resume(definitions, { logicalMapId, persistence })).dispose();
    persistence.hold = true;
    const input = { schema: countSchema, required: true };
    const action = { handler: () => "captured", input };
    const actions = { startup: action };
    const pending = hsonLiveMap.locus.resume(definitions, { logicalMapId, persistence, actions });
    await entered.promise;
    action.handler = () => "changed handler";
    input.schema = ANY_DATA;
    input.required = false;
    actions.startup = { handler: () => "replaced entry", input };
    release.resolve();
    const locus = await pending;
    try {
      actionError(await locus.actions.trigger("startup"), "LOCUS_SCHEMA_INVALID_PAYLOAD");
      actionError(await locus.actions.trigger("startup", "changed contract"), "LOCUS_SCHEMA_INVALID_PAYLOAD");
      const result = await locus.actions.trigger("startup", { value: 1 });
      assert.ok(result.type === "ack" && result.result?.scalar() === "captured");
      assert.equal(persistence.checkpointCalls.length, 1);
    } finally { locus.dispose(); }
  }
});

await check("invalid durable definitions reject before adapter load or checkpoint writes", async () => {
  let loads = 0;
  const persistence = new class extends MemoryCheckpointAdapter {
    async load(id: string) { loads++; return super.load(id); }
  }();
  const document = Hson.schema`<type "document" tag "main" content "empty">`;
  await assert.rejects(hsonLiveMap.locus.resume(definitions, {
    logicalMapId: "registry-invalid", persistence,
    actions: { valid: () => 1, invalid: { handler: () => 2, input: { schema: document } } },
  }), /compile in data mode/);
  assert.equal(loads, 0);
  assert.equal(persistence.chunks.size, 0);
  assert.equal(persistence.manifests.size, 0);
  assert.equal(persistence.states.size, 0);
  assert.equal(persistence.appendCalls.length, 0);
});

await check("direct admission keeps the original name and input when payload reflection mutates the message", async () => {
  const locus = hsonLiveMap.locus.create({});
  let otherCalls = 0;
  const message = {
    type: "action" as const, id: "original-id", name: "validated",
    payload: new Proxy({ value: 4 }, {
      getPrototypeOf(target) {
        message.name = "other";
        message.id = "changed-id";
        return Reflect.getPrototypeOf(target);
      },
    }),
  };
  try {
    locus.actions.define("validated", (context, input, admitted) => {
      assert.deepEqual(context.origin, { kind: "direct" });
      assert.equal(admitted.name, "validated");
      assert.equal(admitted.id, "original-id");
      assert.strictEqual(admitted.payload, input);
      return input;
    }, { input: { schema: countSchema, required: true } });
    locus.actions.define("other", () => { otherCalls++; }, { input: { schema: Hson.schema`<type "data" content <value "string">>` } });
    const result = await locus.dispatchAction(message);
    assert.equal(message.name, "other");
    assert.ok(result.type === "ack" && result.id === "original-id");
    assert.deepEqual(result.result?.materialize(), { value: 4 });
    assert.equal(otherCalls, 0);
  } finally { locus.dispose(); }
});

await check("trigger waits for an awaiting handler and durable acceptance in the authoritative queue", async () => {
  const handlerEntered = deferred(), resumeHandler = deferred();
  const appendEntered = deferred(), acceptAppend = deferred();
  const order: string[] = [];
  const persistence = new class extends MemoryCheckpointAdapter {
    async appendCommit(record: Parameters<MemoryCheckpointAdapter["appendCommit"]>[0]) {
      if (record.commit.rev === 1) {
        appendEntered.resolve();
        await acceptAppend.promise;
      }
      await super.appendCommit(record);
    }
  }();
  const locus = await hsonLiveMap.locus.resume(definitions, { logicalMapId: "registry-queue", persistence });
  try {
    locus.actions.define("held", async (context) => {
      order.push("held");
      context.stage.data.must("state").at(["value"]).set(1);
      handlerEntered.resolve();
      await resumeHandler.promise;
      return 1;
    });
    locus.actions.define("follow", (context) => {
      order.push("follow");
      context.stage.data.must("state").at(["value"]).set(2);
      return context.data.must("state").snap(["value"]);
    });
    const stop = locus.commits.observe((commit) => order.push(`commit ${commit.rev}`));
    let completed = false;
    const first = locus.actions.trigger("held").then((result) => {
      completed = true;
      return result;
    });
    await handlerEntered.promise;
    const staged = locus.stage((draft) => {
      order.push("stage");
      draft.data.must("state").at(["value"]).set(2);
    });
    const second = locus.actions.trigger("follow");
    await Promise.resolve();
    assert.deepEqual(order, ["held"]);
    assert.equal(locus.rev, 0);
    resumeHandler.resolve();
    await appendEntered.promise;
    assert.deepEqual(order, ["held"]);
    assert.equal(locus.data.must("state").snap(["value"]), 0);
    assert.equal(completed, false);
    acceptAppend.resolve();
    const [one, , two] = await Promise.all([first, staged, second]);
    assert.ok(one.type === "ack" && one.result?.scalar() === 1);
    assert.ok(two.type === "ack" && two.result?.scalar() === 2);
    assert.deepEqual(order, ["held", "commit 1", "stage", "commit 2", "follow"]);
    assert.deepEqual([one.completionRev, two.completionRev, locus.rev], [1, 2, 2]);
    stop();

    locus.actions.define("invalidResult", (context) => {
      context.stage.data.must("state").at(["value"]).set(3);
      return { number: Infinity };
    });
    actionError(await locus.actions.trigger("invalidResult"), "LOCUS_ACTION_FAILED");
    assert.equal(locus.data.must("state").snap(["value"]), 2);
    assert.equal(locus.rev, 2);
    assert.equal(persistence.appendCalls.length, 2);
  } finally {
    resumeHandler.resolve();
    acceptAppend.resolve();
    locus.dispose();
  }
});

await check("projected Descriptors and Document grants do not authorize custom actions", async () => {
  const projection = { libraries: ["page"], systemFeatures: ["interactions"] } as const;
  const locus = hsonLiveMap.locus.create(definitions, {
    interactions: [advance],
    authorizeProjection: ({ connection }) => ({
      ...projection,
      writableDocuments: connection?.principalId === "writer" ? ["page"] : [],
    }),
  });
  const writer = attach_locus_semantic_transport_internal(locus, { notice: () => {}, connection: { principalId: "writer" } });
  const reader = attach_locus_semantic_transport_internal(locus, { notice: () => {}, connection: { principalId: "reader" } });
  const custom = { type: "action", id: "custom", clientId: "remote", requestId: "advance", name: advance.key } as const;
  const builtIn = { type: "action", id: "built-in", name: "document.attrs.set",
    payload: { library: "page", target: { kind: "path", path: [0] }, name: "title", value: "written" } } as const;
  let executions = 0;
  try {
    locus.actions.define(advance.key, () => { executions++; });
    const created = await writer.operations.submit({ type: "session-create", id: "writer", projection });
    assert.ok(created.type === "session-created");
    assert.match(locus.session.get(created.sessionId)?.now().libs.system?.interactions.payload ?? "", /deck\.advance/);
    assert.equal((await reader.operations.submit({ type: "session-create", id: "reader", projection })).type, "session-created");
    const rejected = await writer.operations.submit(custom);
    assert.ok(rejected.type === "error" && rejected.delivery === "rejected");
    actionError(rejected, "LOCUS_ACTION_FORBIDDEN");
    actionError(await admit_locus_remote_action_internal(locus, { message: custom }), "LOCUS_ACTION_FORBIDDEN");
    assert.equal(executions, 0);
    assert.equal(locus.actionRequests.debug().retainedTerminalCount, 0);
    const readOnly = await reader.operations.submit(builtIn);
    assert.ok(readOnly.type === "error");
    actionError(readOnly, "LOCUS_ACTION_FORBIDDEN");
    assert.equal((await writer.operations.submit(builtIn)).type, "ack");
    actionError(await locus.actions.trigger(builtIn.name, builtIn.payload), "LOCUS_UNKNOWN_ACTION");
    assert.equal((await locus.dispatchAction(builtIn)).type, "ack");
    assert.equal((await locus.actions.trigger(advance.key)).type, "ack");
    assert.equal(executions, 1);
  } finally { writer.close(); reader.close(); locus.dispose(); }
});

await check("affirmatively authorized attached and ephemeral submissions reach dynamic definitions", async () => {
  const origins: string[] = [];
  const input = Hson.data.from(null);
  const authorizationEntered = deferred(), releaseAuthorization = deferred();
  const locus = hsonLiveMap.locus.create({}, {
    async authorizeAction(context) {
      assert.strictEqual(context.payload, input);
      if (context.connection?.attachment === "hold") {
        authorizationEntered.resolve();
        await releaseAuthorization.promise;
      }
      return context.action === "probe" && context.connection?.principalId === "allowed";
    },
  });
  const connection = { principalId: "allowed" };
  const attached = attach_locus_semantic_transport_internal(locus, { notice: () => {}, connection });
  const message = { type: "action", id: "probe", name: "probe", payload: input } as const;
  try {
    locus.actions.define("probe", (context, payload) => {
      origins.push(context.origin.kind);
      return payload;
    }, { input: { schema: ANY_DATA, required: true } });
    assert.equal((await attached.operations.submit({ type: "session-create", id: "create" })).type, "session-created");
    const remote = await attached.operations.submit(message);
    actionError(await admit_locus_remote_action_internal(locus, { message }), "LOCUS_ACTION_FORBIDDEN");
    const ephemeral = await admit_locus_remote_action_internal(locus, { message, connection });
    for (const result of [remote, ephemeral]) assert.ok(result.type === "ack" && result.result === input);
    locus.actions.define("unapproved", () => "unapproved");
    const mutable = { ...message, id: "held", name: "probe" };
    const pending = admit_locus_remote_action_internal(locus, {
      message: mutable,
      connection: { ...connection, attachment: "hold" },
    });
    await authorizationEntered.promise;
    mutable.name = "unapproved";
    mutable.payload = Hson.data.from("changed input");
    releaseAuthorization.resolve();
    const captured = await pending;
    assert.ok(captured.type === "ack" && captured.result === input);
    assert.deepEqual(origins, ["session", "session", "session"]);
  } finally {
    releaseAuthorization.resolve();
    attached.close();
    locus.dispose();
  }
});

await check("dynamic Schema failures precede authorization in both remote routes", async () => {
  let authorizations = 0, executions = 0;
  const locus = hsonLiveMap.locus.create({}, { authorizeAction: () => { authorizations++; return true; } });
  const attached = attach_locus_semantic_transport_internal(locus, { notice: () => {} });
  try {
    locus.actions.define("validated", () => { executions++; }, { input: { schema: countSchema, required: true } });
    assert.equal((await attached.operations.submit({ type: "session-create", id: "create" })).type, "session-created");
    const message = { type: "action", id: "invalid", name: "validated", payload: { value: "wrong" } } as const;
    const received = await attached.operations.submit(message);
    assert.ok(received.type === "error");
    actionError(received, "LOCUS_SCHEMA_INVALID_PAYLOAD");
    actionError(await admit_locus_remote_action_internal(locus, { message }), "LOCUS_SCHEMA_INVALID_PAYLOAD");
    assert.equal(authorizations, 0);
    assert.equal(executions, 0);
  } finally { attached.close(); locus.dispose(); }
});

await check("only affirmative authorization executes across Promise realms", async () => {
  let decision: unknown = undefined;
  let executions = 0;
  const locus = hsonLiveMap.locus.create({}, {
    authorizeAction: () => (typeof decision === "function" ? decision() : decision) as boolean | Promise<boolean>,
  });
  const attached = attach_locus_semantic_transport_internal(locus, { notice: () => {} });
  try {
    locus.actions.define("probe", () => ++executions);
    assert.equal((await attached.operations.submit({ type: "session-create", id: "create" })).type, "session-created");
    const message = { type: "action", id: "realm", name: "probe" } as const;
    decision = runInNewContext("Promise.resolve(true)");
    assert.equal(decision instanceof Promise, false);
    const allowed = await attached.operations.submit(message);
    assert.ok(allowed.type === "ack" && allowed.result?.scalar() === 1);
    for (const value of [false, "true", runInNewContext("Promise.resolve(false)"), Promise.resolve(1)]) {
      decision = value;
      actionError(await admit_locus_remote_action_internal(locus, { message }), "LOCUS_ACTION_FORBIDDEN");
    }
    for (const value of [() => { throw Error("private"); }, () => Promise.reject(Error("private"))]) {
      decision = value;
      const failure = actionError(await admit_locus_remote_action_internal(locus, { message }), "LOCUS_ACTION_AUTHORIZATION_FAILED");
      assert.equal(failure.message, "Locus action authorization failed.");
      assert.equal(failure.cause, undefined);
    }
    assert.equal(executions, 1);
  } finally { attached.close(); locus.dispose(); }
});

await check("a queued attribute write uses the Document grant after a preceding scope transition", async () => {
  const projection = { libraries: ["page"] } as const;
  const transitionEntered = deferred(), releaseTransition = deferred();
  let revoke = false, writesAuthorized = 0;
  const locus = hsonLiveMap.locus.create(definitions, {
    async authorizeProjection() {
      if (!revoke) return { ...projection, writableDocuments: ["page"] };
      transitionEntered.resolve();
      await releaseTransition.promise;
      return { ...projection, writableDocuments: [] };
    },
    authorizeAction: ({ action }) => {
      if (action !== "document.attrs.set") return false;
      writesAuthorized++;
      return true;
    },
  });
  const attached = attach_locus_semantic_transport_internal(locus, { notice: () => {} });
  const write = { type: "action", id: "write", name: "document.attrs.set",
    payload: { library: "page", target: { kind: "path", path: [0] }, name: "title", value: "queued" } } as const;
  try {
    const session = await locus.session.create(projection);
    const attachedSession = await attached.operations.submit({ type: "session-attach", id: "attach", credential: session.credential });
    assert.equal(attachedSession.type, "session-attached");
    const rev = locus.rev;
    revoke = true;
    const transition = session.update(projection);
    await transitionEntered.promise;
    const pending = attached.operations.submit(write);
    assert.equal(writesAuthorized, 1, "write passed admission under the original grant");
    releaseTransition.resolve();
    assert.equal((await transition).changed, true);
    const rejected = await pending;
    assert.ok(rejected.type === "error");
    const error = actionError(rejected, "LOCUS_ACTION_FAILED");
    assert.match(error.message, /Document authoring is unavailable/);
    assert.equal(writesAuthorized, 1);
    assert.equal(locus.rev, rev);
    assert.doesNotMatch(locus.doc.must("page").render(), /title="queued"/);
    const direct = await locus.dispatchAction(write);
    assert.ok(direct.type === "ack");
    assert.match(locus.doc.must("page").render(), /title="queued"/);
  } finally { releaseTransition.resolve(); attached.close(); locus.dispose(); }
});

await check("unreadable thrown errors and disposal still produce structured failures", async () => {
  const locus = hsonLiveMap.locus.create({});
  let executions = 0, reads = 0, reflections = 0;
  try {
    const unreadable = Object.defineProperty(new Error(), "message", {
      get() { reads++; throw Error("private"); },
    });
    locus.actions.define("unreadable", () => { executions++; throw unreadable; });
    const failure = await locus.actions.trigger("unreadable");
    const error = actionError(failure, "LOCUS_ACTION_FAILED");
    assert.equal(error.message, "Hosted aggregate action failed.");
    assert.equal(reads, 1);
    assert.deepEqual([failure.id, failure.ok, failure.seq, failure.completionRev], ["locus-trigger-1", false, 0, 0]);
    locus.dispose();
    const input = new Proxy({}, { getPrototypeOf() { reflections++; return Object.prototype; } });
    actionError(await locus.actions.trigger("unreadable", input), "LOCUS_DISPOSED");
    assert.equal(executions, 1);
    assert.equal(reflections, 0);
  } finally { locus.dispose(); }
});

await check("durable restoration keeps symbolic state and takes executable definitions from setup", async () => {
  const persistence = new MemoryCheckpointAdapter();
  const configuration = { logicalMapId: "action-registry-restore", persistence };
  const original = await hsonLiveMap.locus.resume(definitions, {
    ...configuration,
    actions: { startup: () => "original" },
    interactions: [advance],
  });
  const revision = original.rev;
  let executions = 0;
  try {
    actionError(await original.actions.trigger(advance.key), "LOCUS_UNKNOWN_ACTION");
    const before = original.cut(), stored = persistence.state(configuration.logicalMapId);
    original.actions.define(advance.key, (context) => {
      executions++;
      context.stage.data.must("state").at(["value"]).set(4);
    });
    assert.equal(original.rev, revision);
    assert.deepEqual(original.cut(), before);
    assert.deepEqual(persistence.state(configuration.logicalMapId), stored);
    assert.equal(persistence.appendCalls.length, 0);
    assert.equal(persistence.checkpointCalls.length, 1);
    const result = await original.actions.trigger(advance.key);
    assert.ok(result.type === "ack" && !Object.hasOwn(result, "result"));
    await hsonLiveMap.locus.checkpoint(original);
    assert.equal(executions, 1);
  } finally { original.dispose(); }

  const restored = await hsonLiveMap.locus.resume(definitions, {
    ...configuration,
    actions: { startup: () => "restored" },
    defaultProjection: { libraries: ["page"], systemFeatures: ["interactions"] },
    authorizeProjection: ({ requested }) => requested,
  });
  try {
    assert.equal(restored.rev, revision + 1);
    const session = await restored.session.create({ libraries: ["page"], systemFeatures: ["interactions"] });
    assert.match(session.now().libs.system?.interactions.payload ?? "", /deck\.advance/);
    actionError(await restored.actions.trigger(advance.key), "LOCUS_UNKNOWN_ACTION");
    const startup = await restored.actions.trigger("startup");
    assert.ok(startup.type === "ack" && startup.result?.scalar() === "restored");
    restored.actions.define(advance.key, (context) => context.data.must("state").snap(["value"]));
    const added = await restored.actions.trigger(advance.key);
    assert.ok(added.type === "ack" && added.result?.scalar() === 4);
    assert.equal(added.completionRev, revision + 1);
  } finally { restored.dispose(); }
});

await check("an uncertain append fences direct execution and survives reload without retry", async () => {
  const persistence = new class extends MemoryCheckpointAdapter {
    async appendCommit(record: Parameters<MemoryCheckpointAdapter["appendCommit"]>[0]) {
      await super.appendCommit(record);
      throw new LocusPersistenceAppendUncertainError();
    }
  }();
  const configuration = { logicalMapId: "action-registry-uncertain", persistence };
  const locus = await hsonLiveMap.locus.resume(definitions, configuration);
  try {
    locus.actions.define("handlerFailure", () => {
      throw new LocusPersistenceError("LOCUS_PERSISTENCE_APPEND_UNCERTAIN", "Handler threw before persistence.");
    });
    const handlerFailure = actionError(await locus.actions.trigger("handlerFailure"), "LOCUS_ACTION_FAILED");
    assert.equal(handlerFailure.cause, undefined);
    locus.actions.define("write", (context) => context.stage.data.must("state").at(["value"]).set(5));
    const failed = await locus.actions.trigger("write");
    const error = actionError(failed, "LOCUS_ACTION_FAILED");
    assert.ok(error.cause instanceof LocusPersistenceError);
    assert.equal(error.cause.code, "LOCUS_PERSISTENCE_APPEND_UNCERTAIN");
    assert.equal(failed.delivery, undefined);
    assert.equal(failed.completionRev, 0);
    assert.equal(locus.rev, 0);
    const fenced = actionError(await locus.actions.trigger("write"), "LOCUS_ACTION_FAILED");
    assert.match(fenced.message, /faulted/);
    assert.equal(fenced.cause, undefined);
    assert.equal(persistence.appendCalls.length, 1);
  } finally { locus.dispose(); }
  const restored = await hsonLiveMap.locus.resume(definitions, configuration);
  try {
    assert.equal(restored.rev, 1);
    assert.equal(restored.data.must("state").snap(["value"]), 5);
  } finally { restored.dispose(); }
});

process.stdout.write(`1..${checks}\n`);
testEvents.terminal("pass");
