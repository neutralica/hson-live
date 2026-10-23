// Loaded only for children of an instrumented validation run. Never a cache.
import childProcess from "node:child_process";
import { errorMonitor } from "node:events";
import { appendFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { isMainThread, threadId } from "node:worker_threads";

const eventFile = process.env.HSON_VALIDATION_EVENTS;
if (eventFile) {
  let sequence = 0;
  const started = performance.now();
  const root = process.env.HSON_VALIDATION_ROOT;
  const safe = value => String(value).replaceAll(root, "<repo>")
    .replaceAll(process.env.HOME ?? "\0", "<home>")
    .replace(/\/(?:private\/)?(?:var\/folders|tmp)\/[^\s"']+/g, "<temporary-path>");
  const emit = data => appendFileSync(eventFile, JSON.stringify({ time: new Date().toISOString(), pid: process.pid,
    threadId, stage: process.env.HSON_VALIDATION_STAGE, ...data }) + "\n");
  const args = process.argv.slice(2);
  const prefix = args.indexOf("--prefix");
  const rootBuild = isMainThread && /^(?:npm|npm-cli\.js)$/.test(basename(process.argv[1] ?? ""))
    && args.some((arg, index) => arg === "run" && args[index + 1] === "build")
    && resolve(prefix < 0 ? process.cwd() : args[prefix + 1]) === root;
  emit({ type: "process-start", entrypoint: safe(process.argv[1] ?? ""), rootBuild });
  process.once("exit", code => emit({ type: "process-end", exitStatus: code, wallMs: performance.now() - started, rootBuild }));
  for (const method of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"]) {
    const original = childProcess[method];
    childProcess[method] = function (...parameters) {
      const id = `${process.pid}:${threadId}:${++sequence}`;
      const begin = performance.now();
      emit({ type: "command-start", id, method, command: safe(parameters[0]),
        arguments: Array.isArray(parameters[1]) ? parameters[1].map(safe) : [] });
      let finished = false;
      const end = data => { if (!finished) { finished = true; emit({ type: "command-end", id, wallMs: performance.now() - begin, ...data }); } };
      try {
        const result = Reflect.apply(original, this, parameters);
        if (method.endsWith("Sync")) end({ exitStatus: method === "spawnSync" ? result.status : 0, signal: result?.signal ?? null,
          error: result?.error ? safe(result.error.message) : null });
        else {
          // errorMonitor observes without handling 'error': Node still throws
          // when the original caller has not installed its own error listener.
          result.once(errorMonitor, error => end({ exitStatus: null, error: safe(error.message) }));
          result.once("close", (code, signal) => end({ exitStatus: code, signal }));
        }
        return result;
      } catch (error) { end({ exitStatus: error.status ?? null, error: safe(error.message) }); throw error; }
    };
  }
  syncBuiltinESMExports();
}
