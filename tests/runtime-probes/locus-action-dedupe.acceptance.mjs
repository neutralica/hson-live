import { create_test_event_emitter } from "../test-events.mjs";
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { hson } from '../../src/index.ts';

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "locus.action-dedupe",
  title: "Locus action deduplication",
  category: "Locus",
  runtime: "node-real-websocket-process",
  tags: Object.freeze(["actions", "deduplication", "identity", "websocket"]),
});

const testEvents = create_test_event_emitter("locus.action-dedupe");
let checks = 0;
async function check(name, fn) {
  testEvents.case_begin(name, name);
  try {
    await fn();
    testEvents.case_end(name, "pass");
    checks += 1;
    process.stdout.write(`ok ${checks} - ${name}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function fake_clock() {
    let time = 1_000;
    let nextId = 0;
    const tasks = new Map();
    function schedule(delay, callback) {
        const id = ++nextId;
        tasks.set(id, { due: time + delay, callback });
        return () => tasks.delete(id);
    }
    function advance(ms) {
        time += ms;
        while (true) {
            const due = [...tasks.entries()]
                .filter(([, task]) => task.due <= time)
                .sort((a, b) => a[1].due - b[1].due)[0];
            if (!due) break;
            tasks.delete(due[0]);
            due[1].callback();
        }
    }
    return { now: () => time, schedule, advance, pending: () => tasks.size };
}

function socket_pair() {
    const clientMessages = new Set();
    const serverMessages = new Set();
    const clientCloses = new Set();
    const serverCloses = new Set();
    const clientSent = [];
    const serverSent = [];
    let closed = false;
    const client = {
        send(raw) {
            clientSent.push(raw);
            for (const listener of [...serverMessages]) listener(raw);
        },
        close() {
            close();
        },
        onMessage(listener) {
            clientMessages.add(listener);
            return () => clientMessages.delete(listener);
        },
        onClose(listener) {
            clientCloses.add(listener);
            return () => clientCloses.delete(listener);
        },
    };
    const server = {
        send(raw) {
            serverSent.push(raw);
            for (const listener of [...clientMessages]) listener(raw);
        },
        close() {
            close();
        },
        onMessage(listener) {
            serverMessages.add(listener);
            return () => serverMessages.delete(listener);
        },
        onClose(listener) {
            serverCloses.add(listener);
            return () => serverCloses.delete(listener);
        },
    };
    function close() {
        if (closed) return;
        closed = true;
        for (const listener of [...clientCloses]) listener();
        for (const listener of [...serverCloses]) listener();
    }
    return { client, server, clientSent, serverSent, close };
}

function connect(host, clientId, options = {}, connectionContext) {
    const pair = socket_pair();
    host.connect(pair.server, connectionContext);
    const client = hson.echo.create({
        socket: pair.client,
        clientId,
        ...options,
    });
    client.connect();
    if (options.session === undefined) void client.session.create();
    return { pair, client };
}

function principal(id) {
    return { principalId: id };
}

function separately_initialized_default_identity() {
    const fixturePath = fileURLToPath(
        new URL(
            './fixtures/locus-default-identity-runtime.mjs',
            import.meta.url,
        ),
    );
    const output = execFileSync(
        process.execPath,
        ['--import=tsx', fixturePath],
        {
            cwd: fileURLToPath(new URL('..', import.meta.url)),
            encoding: 'utf8',
        },
    );
    return JSON.parse(output);
}

function fixture(options = {}) {
    const gate = deferred();
    const entered = deferred();
    const completed = deferred();
    let executions = 0;
    let reentrant;
    const host = hson.locus.create({
        state: { value: 0 },
        logicalMapId: options.logicalMapId ?? 'action-map',
        incarnationId: options.incarnationId,
        actionDedupe: options.actionDedupe,
        authorizeAction: options.authorizeAction,
        actions: {
            async gated(ctx, value) {
                executions += 1;
                entered.resolve();
                await gate.promise;
                await ctx.mutate((draft) => draft.set(['value'], value));
                completed.resolve();
                return { value };
            },
            echo(_ctx, value) {
                executions += 1;
                return value;
            },
            fail() {
                executions += 1;
                throw new Error('expected failure');
            },
            async mutateFail(ctx, value) {
                executions += 1;
                await ctx.mutate((draft) => draft.set(['value'], value));
                throw new Error('after mutation');
            },
            noop() {
                executions += 1;
                return { ok: true };
            },
            invalidResult() {
                executions += 1;
                return new Date();
            },
            async independent(ctx, value) {
                executions += 1;
                entered.resolve();
                await gate.promise;
                await ctx.mutate((draft) => draft.set(['value'], value));
                return value;
            },
            reentrant(_ctx, value) {
                executions += 1;
                reentrant?.();
                return value;
            },
        },
    });
    return {
        host,
        gate,
        entered,
        completed,
        executions: () => executions,
        setReentrant(fn) {
            reentrant = fn;
        },
    };
}

await check(
    'new request installs pending and returns request ID plus completion revision',
    async () => {
        const f = fixture();
        const { client } = connect(f.host, 'client-new');
        const call = client.action('gated', 3);
        await f.entered.promise;
        assert.equal(f.host.actionRequests.debug().pendingRequestCount, 1);
        assert.equal(f.executions(), 1);
        assert.equal(
            (await client.actionStatus(call.request.requestId)).state,
            'pending',
        );
        f.gate.resolve();
        const result = await call;
        assert.equal(result.type, 'ack');
        assert.equal(result.requestId, call.request.requestId);
        assert.equal(result.completionRev, f.host.stream.headRev);
        assert.equal(result.delivery, 'executed');
        assert.equal(f.host.actionRequests.debug().retainedTerminalCount, 1);
    },
);

await check('duplicate pending requests join one execution', async () => {
    const f = fixture();
    const a = connect(f.host, 'same-client');
    const b = connect(f.host, 'same-client');
    const original = a.client.action('gated', 4);
    await f.entered.promise;
    const joined1 = b.client.retryAction(original.request);
    const joined2 = b.client.retryAction(original.request);
    assert.equal(f.executions(), 1);
    assert.equal(f.host.actionRequests.debug().pendingWaiterCount, 3);
    f.gate.resolve();
    const [one, two, three] = await Promise.all([original, joined1, joined2]);
    assert.equal(one.delivery, 'executed');
    assert.equal(two.delivery, 'joined');
    assert.equal(three.delivery, 'joined');
    assert.equal(one.completionRev, two.completionRev);
    assert.deepEqual(one.result, two.result);
    assert.equal(f.host.actionRequests.debug().joinedPendingDuplicateCount, 2);
});

await check('completed duplicate returns cached outcome', async () => {
    const f = fixture();
    const { client } = connect(f.host, 'cached-client');
    const first = await client.action('echo', { b: 2, a: 1 });
    const request = client.action('echo', { a: 1, b: 2 }).request;
    const same = { ...request, requestId: first.requestId };
    const cached = await client.retryAction(same);
    assert.equal(cached.delivery, 'cached');
    assert.equal(cached.completionRev, first.completionRev);
    assert.deepEqual(cached.result, first.result);
    assert.equal(f.executions(), 2);
});

await check('same principal retains lineage across a new session', async () => {
    const f = fixture();
    const aliceA = connect(f.host, 'owned-client', {}, principal('alice')).client;
    const first = aliceA.action('echo', { owner: 'alice' });
    const outcome = await first;
    const aliceB = connect(f.host, 'owned-client', {}, principal('alice')).client;
    const status = await aliceB.actionStatus(first.request.requestId);
    assert.equal(status.state, 'succeeded');
    assert.deepEqual(status.outcome, {
        state: 'succeeded',
        seq: outcome.seq,
        completionRev: outcome.completionRev,
        result: { owner: 'alice' },
    });
    assert.equal((await aliceB.retryAction(first.request)).delivery, 'cached');
    assert.equal(f.executions(), 1);
});

await check('different principal cannot inspect, join, conflict, or cache a lineage', async () => {
    let authorizations = 0;
    const f = fixture({
        authorizeAction() {
            authorizations += 1;
            return true;
        },
    });
    const alice = connect(f.host, 'shared-owned-client', {}, principal('alice')).client;
    const bob = connect(f.host, 'shared-owned-client', {}, principal('bob')).client;
    const pending = alice.action('gated', 17);
    await f.entered.promise;

    await assert.rejects(
        bob.actionStatus(pending.request.requestId),
        (error) => error.code === 'LOCUS_SESSION_CREDENTIAL_UNKNOWN',
    );
    const deniedJoin = await bob.retryAction(pending.request);
    assert.equal(deniedJoin.type, 'error');
    assert.equal(deniedJoin.error.code, 'LOCUS_SESSION_CREDENTIAL_UNKNOWN');
    assert.equal(authorizations, 2);
    assert.equal(f.host.actionRequests.debug().pendingWaiterCount, 1);
    assert.equal(f.executions(), 1);

    f.gate.resolve();
    await pending;
    const deniedConflict = await bob.retryAction({
        ...pending.request,
        payload: 99,
    });
    assert.equal(deniedConflict.type, 'error');
    assert.equal(deniedConflict.error.code, 'LOCUS_SESSION_CREDENTIAL_UNKNOWN');
    assert.equal(f.host.actionRequests.debug().requestIdConflictCount, 0);
    const deniedCached = await bob.retryAction(pending.request);
    assert.equal(deniedCached.type, 'error');
    assert.equal(deniedCached.error.code, 'LOCUS_SESSION_CREDENTIAL_UNKNOWN');
    await assert.rejects(
        bob.actionStatus(pending.request.requestId),
        (error) => error.code === 'LOCUS_SESSION_CREDENTIAL_UNKNOWN',
    );
    assert.equal((await alice.actionStatus(pending.request.requestId)).state, 'succeeded');
    assert.equal((await alice.retryAction(pending.request)).delivery, 'cached');
    assert.equal(authorizations, 5);
});

await check('anonymous lineage survives a new anonymous session and rejects principal takeover', async () => {
    const f = fixture();
    const anonymousA = connect(f.host, 'anonymous-client').client;
    const first = anonymousA.action('echo', 'anonymous');
    await first;
    const anonymousB = connect(f.host, 'anonymous-client').client;
    assert.equal((await anonymousB.actionStatus(first.request.requestId)).state, 'succeeded');
    assert.equal((await anonymousB.retryAction(first.request)).delivery, 'cached');

    const alice = connect(f.host, 'anonymous-client', {}, principal('alice')).client;
    await assert.rejects(
        alice.actionStatus(first.request.requestId),
        (error) => error.code === 'LOCUS_SESSION_CREDENTIAL_UNKNOWN',
    );
    const denied = await alice.retryAction(first.request);
    assert.equal(denied.type, 'error');
    assert.equal(denied.error.code, 'LOCUS_SESSION_CREDENTIAL_UNKNOWN');
    assert.equal(f.executions(), 1);
});

await check('anonymous caller cannot access principal lineage, including its tombstone', async () => {
    const clock = fake_clock();
    const f = fixture({
        actionDedupe: {
            maxTerminalRecords: 0,
            maxTerminalBytes: 0,
            maxExpiredTombstones: 2,
            now: clock.now,
            schedule: clock.schedule,
        },
    });
    const alice = connect(f.host, 'principal-client', {}, principal('alice')).client;
    const first = alice.action('echo', 'principal');
    await first;
    assert.equal((await alice.actionStatus(first.request.requestId)).state, 'expired');

    const anonymous = connect(f.host, 'principal-client').client;
    await assert.rejects(
        anonymous.actionStatus(first.request.requestId),
        (error) => error.code === 'LOCUS_SESSION_CREDENTIAL_UNKNOWN',
    );
    const denied = await anonymous.retryAction(first.request);
    assert.equal(denied.type, 'error');
    assert.equal(denied.error.code, 'LOCUS_SESSION_CREDENTIAL_UNKNOWN');
    assert.equal(f.executions(), 1);
});

await check(
    'request fingerprint conflict never starts a second execution',
    async () => {
        const f = fixture();
        const { client } = connect(f.host, 'conflict-client');
        const original = client.action('gated', 5);
        await f.entered.promise;
        const conflict = await client.retryAction({
            requestId: original.request.requestId,
            name: 'gated',
            payload: 6,
        });
        assert.equal(conflict.type, 'error');
        assert.equal(
            conflict.error.code,
            'LOCUS_ACTION_REQUEST_ID_CONFLICT',
        );
        assert.equal(conflict.delivery, 'rejected');
        assert.equal(f.executions(), 1);
        const nameConflict = await client.retryAction({
            requestId: original.request.requestId,
            name: 'echo',
            payload: 5,
        });
        assert.equal(
            nameConflict.error.code,
            'LOCUS_ACTION_REQUEST_ID_CONFLICT',
        );
        assert.equal(f.executions(), 1);
        f.gate.resolve();
        assert.equal((await original).type, 'ack');
        assert.equal(f.host.actionRequests.debug().requestIdConflictCount, 2);
    },
);

await check(
    'overlapping independent request IDs execute without global serialization',
    async () => {
        const f = fixture();
        const { client } = connect(f.host, 'parallel-client');
        const one = client.action('independent', 1);
        const two = client.action('independent', 2);
        await f.entered.promise;
        assert.equal(f.executions(), 2);
        assert.equal(f.host.actionRequests.debug().pendingRequestCount, 2);
        f.gate.resolve();
        const [first, second] = await Promise.all([one, two]);
        assert.equal(first.delivery, 'executed');
        assert.equal(second.delivery, 'executed');
        assert.ok(first.completionRev <= f.host.stream.headRev);
        assert.ok(second.completionRev <= f.host.stream.headRev);
    },
);

await check(
    'disconnect uncertainty resolves through status and cached retry in a new session',
    async () => {
        const f = fixture();
        const a = connect(f.host, 'uncertain-client');
        const original = a.client.action('gated', 7);
        await f.entered.promise;
        const request = original.request;
        a.pair.close();
        await assert.rejects(original);
        const b = connect(f.host, 'uncertain-client');
        assert.equal(
            (await b.client.actionStatus(request.requestId)).state,
            'pending',
        );
        const joined = b.client.retryAction(request);
        f.gate.resolve();
        const outcome = await joined;
        assert.equal(outcome.delivery, 'joined');
        const status = await b.client.actionStatus(request.requestId);
        assert.equal(status.state, 'succeeded');
        assert.equal(status.outcome.completionRev, outcome.completionRev);
        assert.equal((await b.client.retryAction(request)).delivery, 'cached');
        assert.equal(f.executions(), 1);
    },
);

await check('failed action is terminal and cached', async () => {
    const f = fixture();
    const { client } = connect(f.host, 'failure-client');
    const first = client.action('fail');
    const failure = await first;
    assert.equal(failure.type, 'error');
    assert.equal(failure.error.code, 'LOCUS_ACTION_FAILED');
    assert.equal(typeof failure.completionRev, 'number');
    const cached = await client.retryAction(first.request);
    assert.equal(cached.delivery, 'cached');
    assert.deepEqual(cached.error, failure.error);
    assert.equal(f.executions(), 1);
    assert.equal(
        (await client.actionStatus(first.request.requestId)).state,
        'failed',
    );
});

await check(
    'mutation then failure preserves commit and completion revision without rerun',
    async () => {
        const f = fixture();
        const { client } = connect(f.host, 'mutation-failure');
        const before = f.host.stream.headRev;
        const first = client.action('mutateFail', 9);
        const failure = await first;
        assert.equal(failure.type, 'error');
        assert.equal(f.host.stream.headRev, before + 1);
        assert.equal(failure.completionRev, f.host.stream.headRev);
        assert.deepEqual(f.host.map.snap(), { value: 9 });
        await client.retryAction(first.request);
        assert.equal(f.host.stream.headRev, before + 1);
        assert.equal(f.executions(), 1);
    },
);

await check(
    'no-op success retains the current authoritative head',
    async () => {
        const f = fixture();
        const { client } = connect(f.host, 'noop-client');
        const before = f.host.stream.headRev;
        const first = client.action('noop');
        const outcome = await first;
        assert.equal(outcome.completionRev, before);
        assert.equal(
            (await client.retryAction(first.request)).completionRev,
            before,
        );
        assert.equal(f.executions(), 1);
    },
);

await check(
    'independent IDs and browser clients execute independently',
    async () => {
        const f = fixture();
        const a = connect(f.host, 'client-a', {
            actionId: () => 'shared-request-id',
        });
        const b = connect(f.host, 'client-b', {
            actionId: () => 'shared-request-id',
        });
        const one = a.client.action('echo', 1);
        const two = b.client.action('echo', 2);
        const [outcomeA, outcomeB] = await Promise.all([one, two]);
        assert.equal(outcomeA.delivery, 'executed');
        assert.equal(outcomeB.delivery, 'executed');
        assert.equal(f.executions(), 2);

        const c = connect(f.host, 'client-c');
        const idOne = c.client.action('echo', 3);
        const idTwo = c.client.action('echo', 4);
        await Promise.all([idOne, idTwo]);
        assert.notEqual(idOne.request.requestId, idTwo.request.requestId);
        assert.equal(f.executions(), 4);
    },
);

await check(
    'separately initialized browser runtimes cannot collide with retained outcomes',
    async () => {
        const oneIdentity = separately_initialized_default_identity();
        const twoIdentity = separately_initialized_default_identity();
        assert.notEqual(oneIdentity.clientId, twoIdentity.clientId);
        assert.notEqual(oneIdentity.requestId, twoIdentity.requestId);

        const f = fixture();
        const one = connect(f.host, oneIdentity.clientId, {
            actionId: () => oneIdentity.requestId,
        }).client;
        const two = connect(f.host, twoIdentity.clientId, {
            actionId: () => twoIdentity.requestId,
        }).client;
        const first = await one.action('echo', 1);
        const second = await two.action('echo', 1);
        assert.equal(first.delivery, 'executed');
        assert.equal(second.delivery, 'executed');
        assert.equal(f.executions(), 2);
        assert.equal(
            f.host.actionRequests.debug().cachedOutcomeResponseCount,
            0,
        );
    },
);

await check('same identity is isolated by map incarnation', async () => {
    const one = fixture({ logicalMapId: 'same-map', incarnationId: 'inc-one' });
    const two = fixture({ logicalMapId: 'same-map', incarnationId: 'inc-two' });
    const clientOne = connect(one.host, 'same-browser', {
        actionId: () => 'same-request',
    }).client;
    const clientTwo = connect(two.host, 'same-browser', {
        actionId: () => 'same-request',
    }).client;
    assert.equal((await clientOne.action('echo', 1)).delivery, 'executed');
    assert.equal((await clientTwo.action('echo', 2)).delivery, 'executed');
    assert.equal(one.executions(), 1);
    assert.equal(two.executions(), 1);
});

await check(
    'canonical fingerprint ignores object insertion order',
    async () => {
        const f = fixture();
        const { client } = connect(f.host, 'canonical-client');
        const first = client.action('echo', { a: 1, nested: { x: 2, y: 3 } });
        await first;
        const cached = await client.retryAction({
            requestId: first.request.requestId,
            name: 'echo',
            payload: { nested: { y: 3, x: 2 }, a: 1 },
        });
        assert.equal(cached.delivery, 'cached');
        assert.equal(f.executions(), 1);
    },
);

await check('outcome normalization failure is retained', async () => {
    const f = fixture();
    const { client } = connect(f.host, 'normalization-client');
    const first = client.action('invalidResult');
    const outcome = await first;
    assert.equal(outcome.type, 'error');
    assert.equal(
        outcome.error.code,
        'LOCUS_ACTION_OUTCOME_NORMALIZATION_FAILED',
    );
    assert.equal((await client.retryAction(first.request)).delivery, 'cached');
    assert.equal(f.executions(), 1);
    assert.equal(
        f.host.actionRequests.debug().outcomeNormalizationFailureCount,
        1,
    );
});

await check(
   'malformed identity, unknown actions, and invalid payloads are classified',
    async () => {
        const f = fixture();
        const raw = connect(f.host, 'identity-client');
        raw.pair.client.send(
            JSON.stringify({
                type: 'action',
                id: 'attempt-missing',
                clientId: 'identity-client',
                name: 'echo',
                payload: 1,
            }),
        );
        assert.equal(
            JSON.parse(raw.pair.serverSent.at(-1)).error.code,
            'LOCUS_ACTION_REQUEST_ID_MISSING',
        );
        raw.pair.client.send(
            JSON.stringify({
                type: 'action',
                id: 'attempt-malformed',
                requestId: '',
                clientId: 'identity-client',
                name: 'echo',
                payload: 1,
            }),
        );
        assert.equal(
            JSON.parse(raw.pair.serverSent.at(-1)).error.code,
            'LOCUS_ACTION_REQUEST_ID_MALFORMED',
        );
        const unknown = await raw.client.action('does-not-exist', 1);

        assert.equal(unknown.error.code, 'LOCUS_UNKNOWN_ACTION');

        const invalidHost = hson.locus.create({
            state: { value: 0 },
            actions: {
                echo(_ctx, value) {
                    return value;
                },
            },
            schema: {
                actions: {
                    echo: { payload: (value) => typeof value === 'number' },
                },
            },
        });
        const invalidClient = connect(invalidHost, 'invalid-client').client;
        const invalid = await invalidClient.action('echo', 'not-a-number');
        assert.equal(invalid.error.code, 'LOCUS_SCHEMA_INVALID_PAYLOAD');
        assert.equal(invalidHost.actionRequests.debug().executionsStarted, 0);
    },
);

await check(
    'count byte and time retention produce explicit expired or unknown results',
    async () => {
        const clock = fake_clock();
        const count = fixture({
            actionDedupe: {
                maxTerminalRecords: 1,
                maxTerminalBytes: 1_000_000,
                terminalRetentionMs: 1_000,
                maxExpiredTombstones: 2,
                now: clock.now,
                schedule: clock.schedule,
            },
        });
        const client = connect(count.host, 'retention-client').client;
        const first = client.action('echo', 'one');
        await first;
        const second = client.action('echo', 'two');
        await second;
        assert.equal(
            (await client.actionStatus(first.request.requestId)).state,
            'expired',
        );
        assert.equal(
            (await client.retryAction(first.request)).error.code,
            'LOCUS_ACTION_REQUEST_EXPIRED',
        );
        clock.advance(1_001);
        assert.equal(
            (await client.actionStatus(second.request.requestId)).state,
            'expired',
        );

        const bytes = fixture({
            actionDedupe: {
                maxTerminalRecords: 10,
                maxTerminalBytes: 1,
                terminalRetentionMs: 1_000,
                maxExpiredTombstones: 1,
                now: clock.now,
                schedule: clock.schedule,
            },
        });
        const byteClient = connect(bytes.host, 'byte-client').client;
        const byteRequest = byteClient.action('echo', 'large-result');
        await byteRequest;
        assert.equal(
            (await byteClient.actionStatus(byteRequest.request.requestId))
                .state,
            'expired',
        );

        const forgotten = fixture({
            actionDedupe: {
                maxTerminalRecords: 0,
                maxTerminalBytes: 0,
                maxExpiredTombstones: 1,
                now: clock.now,
                schedule: clock.schedule,
            },
        });
        const forgottenClient = connect(
            forgotten.host,
            'forgotten-client',
        ).client;
        const old = forgottenClient.action('echo', 1);
        await old;
        const newer = forgottenClient.action('echo', 2);
        await newer;
        assert.equal(
            (await forgottenClient.actionStatus(old.request.requestId)).state,
            'unknown',
        );
        const unknownRetry = await forgottenClient.retryAction(old.request);
        assert.equal(
            unknownRetry.error.code,
            'LOCUS_ACTION_REQUEST_UNKNOWN',
        );
        assert.equal(forgotten.executions(), 2);
    },
);

await check('terminal limits never evict a pending action', async () => {
    const clock = fake_clock();
    const f = fixture({
        actionDedupe: {
            maxTerminalRecords: 0,
            maxTerminalBytes: 0,
            maxExpiredTombstones: 1,
            now: clock.now,
            schedule: clock.schedule,
        },
    });
    const { client } = connect(f.host, 'pending-retention');
    const pending = client.action('gated', 1);
    await f.entered.promise;
    await client.action('echo', 2);
    assert.equal(
        (await client.actionStatus(pending.request.requestId)).state,
        'pending',
    );
    assert.equal(f.host.actionRequests.debug().pendingRequestCount, 1);
    f.gate.resolve();
    await pending;
});

await check(
    'reentrant identical request joins after pending installation',
    async () => {
        const f = fixture();
        const a = connect(f.host, 'reentrant-client', {
            map: hson.liveMap.fromJson({ value: 0 }),
            recovery: { logicalMapId: f.host.stream.logicalMapId },
            actionId: () => 'reentrant-request',
        });
        const b = connect(f.host, 'reentrant-client');
        const descriptor = {
            requestId: 'reentrant-request',
            name: 'reentrant',
            payload: 12,
        };
        let joined;
        f.setReentrant(() => {
            joined = b.client.retryAction(descriptor);
        });
        const original = a.client.action('reentrant', 12);
        const [one, two] = await Promise.all([original, joined]);
        assert.equal(one.delivery, 'executed');
        assert.equal(two.delivery, 'joined');
        assert.equal(f.executions(), 1);
    },
);

await check('fenced transport cannot create a dedupe record', async () => {
    const f = fixture();
    const first = connect(f.host, 'fenced-client', { session: {} });
    await first.client.session.create();
    const credential = first.client.session.credential;
    const second = connect(f.host, 'fenced-client', {
        session: { credential },
    });
    await second.client.session.reattach();
    first.pair.client.send(
        JSON.stringify({
            type: 'action',
            id: 'fenced-id',
            requestId: 'fenced-id',
            clientId: 'fenced-client',
            name: 'echo',
            payload: 1,
        }),
    );
    assert.equal(f.executions(), 0);
    assert.equal(
        (await second.client.actionStatus('fenced-id')).state,
        'unknown',
    );
});

await check('fencing after admission preserves work and retention but suppresses old delivery', async () => {
    const f = fixture();
    const first = connect(f.host, 'post-admission-fence', { session: {} });
    await first.client.session.create();
    const original = first.client.action('gated', 43);
    await f.entered.promise;
    assert.equal(f.host.actionRequests.debug().pendingRequestCount, 1);
    assert.equal(f.host.activity.snapshot().actionCount, 1);
    const originalRequest = original.request;
    const originalAttemptId = first.pair.clientSent.map(JSON.parse)
        .findLast((message) => message.type === 'action').attemptId;
    const second = connect(f.host, 'post-admission-fence', {
        session: { credential: first.client.session.credential },
    });
    await second.client.session.reattach();
    await assert.rejects(original);
    assert.equal((await second.client.actionStatus(originalRequest.requestId)).state, 'pending');
    const joined = second.client.retryAction(originalRequest);
    f.gate.resolve();
    const outcome = await joined;
    assert.equal(outcome.delivery, 'joined');
    assert.equal(outcome.completionRev, 1);
    assert.deepEqual(f.host.map.snap(), { value: 43 });
    assert.equal(f.executions(), 1);
    assert.equal(f.host.actionRequests.debug().retainedTerminalCount, 1);
    assert.equal(f.host.activity.snapshot().actionCount, 0);
    const oldTerminalDelivery = first.pair.serverSent.map(JSON.parse).some((message) =>
        message.attemptId === originalAttemptId && (message.type === 'ack' || message.type === 'error'));
    assert.equal(oldTerminalDelivery, false);
    const status = await second.client.actionStatus(originalRequest.requestId);
    assert.equal(status.state, 'succeeded');
    assert.equal(status.outcome.completionRev, outcome.completionRev);
    assert.equal((await second.client.retryAction(originalRequest)).delivery, 'cached');
});

await check(
    'dedupe store disposal releases waiters and stays unavailable',
    async () => {
        const f = fixture();
        const { client } = connect(f.host, 'dispose-client');
        const pending = client.action('gated', 1);
        await f.entered.promise;
        f.host.actionRequests.dispose();
        f.host.actionRequests.dispose();
        const outcome = await pending;
        assert.equal(
            outcome.error.code,
            'LOCUS_ACTION_DEDUPE_STORE_UNAVAILABLE',
        );
        const retry = await client.retryAction(pending.request);
        assert.equal(
            retry.error.code,
            'LOCUS_ACTION_DEDUPE_STORE_UNAVAILABLE',
        );
        assert.equal(f.host.actionRequests.debug().disposed, true);
        f.gate.resolve();
    },
);

function ws_socket(ws) {
    return {
        send(raw) {
            ws.send(raw);
        },
        close(code, reason) {
            ws.close(code, reason);
        },
        onMessage(listener) {
            const handler = (data) => listener(data.toString());
            ws.on('message', handler);
            return () => ws.off('message', handler);
        },
        onClose(listener) {
            ws.on('close', listener);
            return () => ws.off('close', listener);
        },
    };
}
function opened(ws) {
    return new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });
}
function closed(ws) {
    return new Promise((resolve) => ws.once('close', resolve));
}

await check(
    'real WebSocket uncertain action joins after disconnect and recovery reaches completionRev',
    async () => {
        const f = fixture({ logicalMapId: 'real-action' });
        const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
        await new Promise((resolve) => server.once('listening', resolve));
        server.on('connection', (socket) => f.host.connect(ws_socket(socket)));
        const address = server.address();
        const url = `ws://127.0.0.1:${address.port}`;
        const wsA = new WebSocket(url);
        await opened(wsA);
        const clientA = hson.echo.create({
            socket: ws_socket(wsA),
            clientId: 'real-browser',
            map: hson.liveMap.fromJson({ value: 0 }),
            recovery: { logicalMapId: f.host.stream.logicalMapId },
        });
        clientA.connect();
        await clientA.session.create();
        await clientA.recovery.recover();
        const original = clientA.action('gated', 42);
        const request = original.request;
        await f.entered.promise;
        const closeA = closed(wsA);
        wsA.close();
        await closeA;
        await assert.rejects(original);
        const savedMap = clientA.map;
        const savedCursor = {
            incarnationId: clientA.recovery.incarnationId,
            lastAppliedRev: clientA.recovery.lastAppliedRev,
        };
        const credential = clientA.session.credential;
        clientA.dispose();

        const wsB = new WebSocket(url);
        await opened(wsB);
        const clientB = hson.echo.create({
            socket: ws_socket(wsB),
            clientId: 'real-browser',
            map: savedMap,
            recovery: {
                logicalMapId: f.host.stream.logicalMapId,
                cursor: savedCursor,
            },
            session: { credential },
        });
        clientB.connect();
        await clientB.session.reattach();
        await clientB.recovery.recover();
        assert.equal(
            (await clientB.actionStatus(request.requestId)).state,
            'pending',
        );
        const joined = clientB.retryAction(request);
        assert.equal(
            (await clientB.actionStatus(request.requestId)).state,
            'pending',
        );
        assert.equal(
            f.host.actionRequests.debug().joinedPendingDuplicateCount,
            1,
        );
        f.gate.resolve();
        const outcome = await joined;
        assert.equal(outcome.delivery, 'joined');
        assert.equal(f.executions(), 1);
        assert.ok(clientB.recovery.lastAppliedRev >= outcome.completionRev);
        assert.equal(
            (await clientB.actionStatus(request.requestId)).state,
            'succeeded',
        );
        const closeB = closed(wsB);
        wsB.close();
        await closeB;
        await new Promise((resolve) => server.close(resolve));
    },
);

process.stdout.write(
    `Locus action dedupe acceptance checks passed (${checks}).\n`,
);
testEvents.terminal("pass");
