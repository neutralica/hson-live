import { emit_hson_live_test_completion } from "./launcher-completion.mjs";
// @hson-live-external-test
import assert from "node:assert/strict";
import {
  _create_livetree_for_runtime_test,
  _create_livetree_runtime_test_handle,
  _dispose_livetree_runtime_test_handle,
  _livetree_runtime_test_claim_count,
  _livetree_runtime_test_issued_count,
  _lookup_livetree_runtime_test_node,
  _set_livetree_runtime_test_quid_candidate_source,
} from "../src/diagnostics/index.ts";
import { assign_hson_node_quid } from "../src/core/hson-node-quid.ts";
import type { HsonNode } from "../src/core/types.ts";

const Q1 = "0000000000000t01";
const Q2 = "0000000000000t02";
const Q3 = "0000000000000t03";

let checks = 0;
function check(name: string, run: () => void): void {
  run();
  checks += 1;
  process.stdout.write(`ok ${checks} - ${name}\n`);
}

function node(tag = "main", quid?: string, children: HsonNode[] = []): HsonNode {
  const value: HsonNode = { $_tag: tag, $_content: children };
  if (quid !== undefined) assign_hson_node_quid(value, quid);
  return value;
}

function reuse(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && Reflect.get(error, "code") === "LIVETREE_QUID_REUSE";
}

check("fresh runtime has Q=0 and I=0", () => {
  const runtime = _create_livetree_runtime_test_handle();
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 0);
});

check("first supplied QUID enters active and issued state", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1));
  assert.equal(_livetree_runtime_test_claim_count(runtime), 1);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 1);
});

check("first minted QUID enters active and issued state", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _set_livetree_runtime_test_quid_candidate_source(runtime, () => Q1);
  const tree = _create_livetree_for_runtime_test(runtime, node());
  assert.equal(tree.quid, Q1);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 1);
});

check("active claims are always a subset of issued claims", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("a", Q1));
  _create_livetree_for_runtime_test(runtime, node("b", Q2));
  assert.ok(_livetree_runtime_test_claim_count(runtime) <= _livetree_runtime_test_issued_count(runtime));
});

check("terminal destruction removes Q and retains I", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const tree = _create_livetree_for_runtime_test(runtime, node("main", Q1));
  tree.remove();
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 1);
});

check("raw lookup is absent after terminal destruction", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1)).remove();
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), undefined);
});

check("ordinary supplied re-admission rejects retired identity", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1)).remove();
  assert.throws(() => _create_livetree_for_runtime_test(runtime, node("main", Q1)), reuse);
});

check("issued-reuse rejection changes no runtime accounting", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1)).remove();
  assert.throws(() => _create_livetree_for_runtime_test(runtime, node("aside", Q1)), reuse);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 1);
});

check("active collision remains distinct from issued reuse", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1));
  assert.throws(
    () => _create_livetree_for_runtime_test(runtime, node("aside", Q1)),
    (error: unknown) => error instanceof Error
      && error.message.includes("already registered")
      && !reuse(error),
  );
});

check("multiple retirements grow I monotonically", () => {
  const runtime = _create_livetree_runtime_test_handle();
  for (const quid of [Q1, Q2, Q3]) {
    _create_livetree_for_runtime_test(runtime, node("main", quid)).remove();
  }
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 3);
});

check("allocator retries a retired candidate", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1)).remove();
  let calls = 0;
  _set_livetree_runtime_test_quid_candidate_source(runtime, () => ++calls === 1 ? Q1 : Q2);
  const tree = _create_livetree_for_runtime_test(runtime, node());
  assert.equal(tree.quid, Q2);
  assert.equal(calls, 2);
});

check("allocator exhaustion on a retired candidate is atomic", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1)).remove();
  _set_livetree_runtime_test_quid_candidate_source(runtime, () => Q1);
  assert.throws(() => _create_livetree_for_runtime_test(runtime, node()), /32 secure attempts/);
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 1);
});

check("malformed allocator candidates never enter I", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _set_livetree_runtime_test_quid_candidate_source(runtime, () => "bad");
  assert.throws(() => _create_livetree_for_runtime_test(runtime, node()), /32 secure attempts/);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 0);
});

check("fresh runtime may admit equal bytes", () => {
  const oldRuntime = _create_livetree_runtime_test_handle();
  const freshRuntime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(oldRuntime, node("main", Q1)).remove();
  assert.equal(_create_livetree_for_runtime_test(freshRuntime, node("aside", Q1)).quid, Q1);
});

check("runtime disposal discards its issued ledger", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("main", Q1)).remove();
  _dispose_livetree_runtime_test_handle(runtime);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 0);
});

check("disposed runtime rejects later construction", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _dispose_livetree_runtime_test_handle(runtime);
  assert.throws(() => _create_livetree_for_runtime_test(runtime, node("main", Q1)), /disposed/);
});

check("duplicate incoming graph changes no issued state", () => {
  const runtime = _create_livetree_runtime_test_handle();
  assert.throws(
    () => _create_livetree_for_runtime_test(runtime, node("main", Q1, [node("span", Q1)])),
    /Duplicate QUID/,
  );
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 0);
});

check("retired descendant rejects a complete incoming graph atomically", () => {
  const runtime = _create_livetree_runtime_test_handle();
  _create_livetree_for_runtime_test(runtime, node("old", Q1)).remove();
  assert.throws(
    () => _create_livetree_for_runtime_test(runtime, node("main", Q2, [node("span", Q1)])),
    reuse,
  );
  assert.equal(_livetree_runtime_test_claim_count(runtime), 0);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 1);
});

check("detach preserves active and issued identity", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const tree = _create_livetree_for_runtime_test(runtime, node("main", Q1));
  tree.detach();
  assert.equal(_lookup_livetree_runtime_test_node(runtime, Q1), tree.node);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 1);
});

check("clone mints a new issued lineage", () => {
  const runtime = _create_livetree_runtime_test_handle();
  const source = _create_livetree_for_runtime_test(runtime, node("main", Q1));
  _set_livetree_runtime_test_quid_candidate_source(runtime, () => Q2);
  const clone = source.cloneBranch();
  assert.equal(clone.quid, Q2);
  assert.equal(_livetree_runtime_test_issued_count(runtime), 2);
});

emit_hson_live_test_completion("livetree.issued-quid-lifecycle", checks, checks, 0);
