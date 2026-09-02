import { Worker, type WorkerOptions } from "node:worker_threads";

const TYPESCRIPT_WORKER_REGISTER = new URL("./repository-typescript-worker-register.mjs", import.meta.url).href;

/** Launch repository TypeScript with the same TSX source resolution as the parent test process. */
export function repository_typescript_worker(entry: URL, options: WorkerOptions = {}): Worker {
  return new Worker(entry, {
    ...options,
    execArgv: [...process.execArgv, "--import", TYPESCRIPT_WORKER_REGISTER],
  });
}
