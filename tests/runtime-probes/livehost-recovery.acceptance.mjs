import assert from "node:assert/strict";
import { LiveHostRecoveryError, hson } from "../../src/index.ts";

function request_for(host, lastAppliedRev = host.stream.headRev) {
  return {
    logicalMapId: host.stream.logicalMapId,
    incarnationId: host.stream.incarnationId,
    lastAppliedRev,
  };
}

function expect_recovery_error(fn, code) {
  try {
    fn();
    assert.fail(`Expected LiveHost recovery error ${code}.`);
  } catch (cause) {
    assert.ok(cause instanceof LiveHostRecoveryError);
    assert.equal(cause.code, code);
  }
}

function project_snapshot_hson(source) {
  const node = hson.fromHson(source).toNode();
  return hson.fromNode(node).toJson().value();
}

// Already-current recovery works even when the history ring is empty.
{
  const host = hson.liveHost.create({
    state: { value: 0 },
    history: { maxCommits: 0, maxBytes: 0 },
  });
  const plan = host.recovery.plan(request_for(host));
  assert.equal(plan.outcome, "current");
  assert.deepEqual(plan.body, []);
  const completion = plan.complete();
  assert.equal(completion.caughtUp.throughRev, plan.headRev);
  assert.deepEqual(completion.tail, []);
}

// Replay is contiguous and a reentrant mutation during body publication lands
// in the tail, after every replay commit and exactly once.
{
  const host = hson.liveHost.create({ state: { value: 0 } });
  const baseRev = host.stream.headRev;
  host.map.set(["value"], 1);
  host.map.set(["value"], 2);

  const plan = host.recovery.plan(request_for(host, baseRev));
  assert.equal(plan.outcome, "replay");
  assert.deepEqual(plan.body.map((commit) => commit.rev), [baseRev + 1, baseRev + 2]);

  const produced = [];
  const completion = plan.complete((item) => {
    assert.equal(item.kind, "commit");
    produced.push(item.commit.rev);
    if (item.commit.rev === baseRev + 1) host.map.set(["value"], 3);
  });

  assert.deepEqual(produced, [baseRev + 1, baseRev + 2]);
  assert.deepEqual(completion.tail.map((commit) => commit.rev), [baseRev + 3]);
  assert.equal(completion.caughtUp.throughRev, baseRev + 2);

  const allRecovered = [...produced, ...completion.tail.map((commit) => commit.rev)];
  assert.deepEqual(allRecovered, [baseRev + 1, baseRev + 2, baseRev + 3]);
  assert.equal(new Set(allRecovered).size, allRecovered.length);
}

// Deterministic barriers prove the snapshot cut: a mutation immediately before
// the cut and one while capture is prepared belong to the snapshot; a mutation
// immediately after the fixed cut belongs only to the tail.
{
  const host = hson.liveHost.create({ state: { value: 0 } });
  const plan = host.recovery.plan(
    { logicalMapId: host.stream.logicalMapId },
    {
      before_cut: () => {
        host.map.set(["value"], 1);
      },
      during_snapshot_capture: () => {
        host.map.set(["value"], 2);
      },
      after_cut: () => {
        host.map.set(["value"], 3);
      },
    },
  );

  assert.equal(plan.outcome, "snapshot");
  assert.equal(plan.reason, "no_usable_revision");
  assert.equal(plan.body.rev, plan.headRev);
  assert.deepEqual(Object.keys(plan.body).sort(), ["hson", "incarnationId", "logicalMapId", "mode", "rev"]);
  assert.equal(plan.body.mode, "data-object");
  assert.equal(plan.body.hson, `<value 2>`);
  assert.equal(plan.body.hson.includes("\n"), false);
  assert.equal("value" in plan.body, false);
  assert.deepEqual(project_snapshot_hson(plan.body.hson), { value: 2 });
  assert.equal(Object.isFrozen(plan.body), true);

  const completion = plan.complete();
  assert.equal(completion.caughtUp.throughRev, plan.body.rev);
  assert.deepEqual(completion.tail.map((commit) => commit.rev), [plan.body.rev + 1]);
  assert.deepEqual(project_snapshot_hson(plan.body.hson), { value: 2 });
}

// Snapshot HSON covers the complete projected JsonValue domain while remaining
// compact canonical text inside the recovery envelope.
{
  const state = {
    nested: {
      array: [1, true, false, null, `quote" slash\\ tab\t line\nnext`],
      emptyObject: {},
      emptyArray: [],
      mixed: [{ name: "Ada", active: true }, [2, 3], null],
    },
    count: 42,
  };
  const host = hson.liveHost.create({ state });
  const plan = host.recovery.plan({ logicalMapId: host.stream.logicalMapId });
  assert.equal(plan.outcome, "snapshot");
  assert.equal(typeof plan.body.hson, "string");
  assert.equal(plan.body.hson.includes("\n"), false);
  assert.equal("value" in plan.body, false);
  assert.deepEqual(project_snapshot_hson(plan.body.hson), state);
  plan.dispose();
}

// Same logical map but a different incarnation resets through a snapshot.
{
  const host = hson.liveHost.create({ state: { value: 4 } });
  const plan = host.recovery.plan({
    logicalMapId: host.stream.logicalMapId,
    incarnationId: "obsolete-incarnation",
    lastAppliedRev: 999,
  });
  assert.equal(plan.outcome, "snapshot");
  assert.equal(plan.reason, "incarnation_mismatch");
  assert.equal(plan.body.incarnationId, host.stream.incarnationId);
  plan.dispose();
}

// Same-incarnation revision-ahead is a hard classified rejection.
{
  const host = hson.liveHost.create({ state: { value: 0 } });
  const plan = host.recovery.plan(request_for(host, host.stream.headRev + 1));
  assert.equal(plan.outcome, "reject");
  assert.equal(plan.error.code, "REVISION_AHEAD_OF_AUTHORITY");
  assert.equal(host.recovery.debug().activeAttemptCount, 0);
}

// Incomplete history falls back to snapshot; Patch 1 coverage remains exact.
{
  const host = hson.liveHost.create({
    state: { value: 0 },
    history: { maxCommits: 1, maxBytes: 1_000_000 },
  });
  const baseRev = host.stream.headRev;
  host.map.set(["value"], 1);
  host.map.set(["value"], 2);
  assert.equal(host.stream.history.can_replay(baseRev, host.stream.headRev), false);

  const plan = host.recovery.plan(request_for(host, baseRev));
  assert.equal(plan.outcome, "snapshot");
  assert.equal(plan.reason, "history_unavailable");
  assert.equal(plan.body.rev, host.stream.headRev);
  assert.deepEqual(project_snapshot_hson(plan.body.hson), { value: 2 });
  plan.dispose();
}

// Tail overflow aborts visibly, clears queued state, emits no completion, and
// leaves both stream and planner reusable.
{
  const host = hson.liveHost.create({
    state: { value: 0 },
    recovery: { maxTailCommits: 1, maxTailBytes: 1_000_000 },
  });
  const baseRev = host.stream.headRev;
  host.map.set(["value"], 1);
  const plan = host.recovery.plan(request_for(host, baseRev));
  assert.equal(plan.outcome, "replay");

  expect_recovery_error(() => {
    plan.complete(() => {
      host.map.set(["value"], 2);
      host.map.set(["value"], 3);
    });
  }, "LIVEHOST_RECOVERY_TAIL_OVERFLOW");

  assert.equal(plan.debug().state, "aborted");
  assert.equal(plan.debug().queuedTailCommits, 0);
  assert.equal(host.recovery.debug().activeAttemptCount, 0);

  const later = host.recovery.plan(request_for(host));
  assert.equal(later.outcome, "current");
  later.complete();
}

// Explicit disposal releases the subscription and all queued state.
{
  const host = hson.liveHost.create({ state: { value: 0 } });
  const cut = host.stream.headRev;
  const plan = host.recovery.plan(request_for(host, cut), {
    after_cut: () => host.map.set(["value"], 1),
  });
  assert.equal(plan.outcome, "current");
  assert.equal(plan.debug().queuedTailCommits, 1);
  plan.dispose();
  assert.equal(plan.debug().state, "disposed");
  assert.equal(plan.debug().queuedTailCommits, 0);
  assert.equal(host.recovery.debug().activeAttemptCount, 0);
  host.map.set(["value"], 2);
  assert.equal(plan.debug().queuedTailCommits, 0);
  expect_recovery_error(() => plan.complete(), "LIVEHOST_RECOVERY_DISPOSED");
}

// The byte bound is enforced independently of the commit-count bound.
{
  const host = hson.liveHost.create({
    state: { value: 0 },
    recovery: { maxTailCommits: 100, maxTailBytes: 1 },
  });
  expect_recovery_error(() => {
    host.recovery.plan(request_for(host), {
      after_cut: () => host.map.set(["value"], 1),
    });
  }, "LIVEHOST_RECOVERY_TAIL_OVERFLOW");
  assert.equal(host.recovery.debug().activeAttemptCount, 0);
}

// Snapshot-planning and observer failures dispose cleanly and do not poison a
// later attempt or Patch 1 canonical history.
{
  const host = hson.liveHost.create({ state: { value: 0 } });
  expect_recovery_error(() => {
    host.recovery.plan(
      { logicalMapId: host.stream.logicalMapId },
      { during_snapshot_capture: () => { throw new Error("capture barrier failed"); } },
    );
  }, "LIVEHOST_RECOVERY_SNAPSHOT_FAILED");
  assert.equal(host.recovery.debug().activeAttemptCount, 0);

  const baseRev = host.stream.headRev;
  host.map.set(["value"], 1);
  const replay = host.recovery.plan(request_for(host, baseRev));
  assert.equal(replay.outcome, "replay");
  expect_recovery_error(() => {
    replay.complete(() => { throw new Error("observer failed"); });
  }, "LIVEHOST_RECOVERY_OBSERVER_FAILED");
  assert.equal(host.recovery.debug().activeAttemptCount, 0);

  assert.equal(host.stream.history.can_replay(baseRev, host.stream.headRev), true);
  const later = host.recovery.plan(request_for(host, baseRev));
  assert.equal(later.outcome, "replay");
  later.complete();
}

process.stdout.write("LiveHost recovery acceptance checks passed.\n");
