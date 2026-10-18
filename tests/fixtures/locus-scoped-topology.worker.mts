import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { topology_cases, verify_topology_restart, type topology_tail_fixture } from "./locus-scoped-topology-cases.mts";
import { verify_topology_contract_restart, type topology_contract_fixture } from "./locus-scoped-topology-repair-cases.mts";
import { MemoryCheckpointAdapter } from "../helpers/memory-checkpoint-adapter.mts";
import type { CheckpointChunk } from "../../src/api/locus/locus.checkpoint-chunks.ts";
let raw = "";
if (isMainThread) for await (const part of process.stdin) raw += String(part);
type RestartInput<T> = Omit<T, "adapter"> & { chunks: [string, CheckpointChunk][] };
const input: RestartInput<Awaited<ReturnType<typeof topology_tail_fixture>>> & {
  contract: RestartInput<Awaited<ReturnType<typeof topology_contract_fixture>>>;
} = isMainThread ? JSON.parse(raw) : workerData;
const adapter = new MemoryCheckpointAdapter();
for (const [id, chunk] of input.chunks) adapter.chunks.set(id, chunk);
adapter.seed(input.state.checkpoint.logicalMapId, input.state);
await verify_topology_restart({ ...input, adapter });
const contractAdapter = new MemoryCheckpointAdapter();
for (const [id, chunk] of input.contract.chunks) contractAdapter.chunks.set(id, chunk);
contractAdapter.seed(input.contract.state.checkpoint.logicalMapId, input.contract.state);
await verify_topology_contract_restart({ ...input.contract, adapter: contractAdapter });
if (isMainThread) process.stdout.write("h0b-restart-ok\n");
else { let count = 0; await topology_cases(async (_name, run) => { await run(); count++; }); parentPort!.postMessage(count); }
