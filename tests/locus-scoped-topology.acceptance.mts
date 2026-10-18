import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { topology_cases, topology_tail_fixture } from "./fixtures/locus-scoped-topology-cases.mts";
import { topology_contract_fixture } from "./fixtures/locus-scoped-topology-repair-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
import { create_test_event_emitter } from "./test-events.mjs";
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "locus.scoped-topology", title: "Scoped runtime Library topology H0b",
  category: "Locus", runtime: "node", tags: Object.freeze(["scope", "topology", "worker", "restart", "css", "authority"]) });
const events = create_test_event_emitter("locus.scoped-topology");
let count = 0;
await topology_cases(async (name, run) => {
  events.case_begin(name, name);
  try { await run(); count++; events.case_end(name, "pass"); console.log(`ok - ${name}`); }
  catch (error) { events.diagnostic(name, "assertion", String(error)); events.case_end(name, "fail"); events.terminal("fail"); throw error; }
});
const f = await topology_tail_fixture(), contract = await topology_contract_fixture();
const data = { state: f.state, expected: f.expected, sourceIds: f.sourceIds, chunks: [...f.adapter.chunks],
  contract: { state: contract.state, expected: contract.expected, sourceIds: contract.sourceIds, chunks: [...contract.adapter.chunks] } };
const entry = new URL("./fixtures/locus-scoped-topology.worker.mts", import.meta.url);
const worker = repository_typescript_worker(entry, { workerData: data });
try {
  const result = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); worker.once("exit", code => reject(Error(`Worker exited ${code}`))); });
  assert.equal(result, count);
} finally { await worker.terminate(); }
const child = spawn(process.execPath, ["--import=tsx", fileURLToPath(entry)], { stdio: ["pipe", "pipe", "pipe"] });
let stdout = "", stderr = "";
child.stdout.on("data", piece => { stdout += String(piece); }); child.stderr.on("data", piece => { stderr += String(piece); });
const exited = new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
child.stdin.end(JSON.stringify(data)); assert.equal(await exited, 0, stderr); assert.equal(stdout.trim(), "h0b-restart-ok");
events.terminal("pass"); console.log(`Scoped topology passed (${count} Node and ${count} Worker groups, cross-Worker and fresh-process restart).`);
