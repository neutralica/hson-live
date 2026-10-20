import assert from "node:assert/strict";
import { scoped_ssr_cases, definition, page } from "./fixtures/locus-scoped-ssr-cases.mts";
import { scoped_ssr_http } from "./fixtures/locus-scoped-ssr-http.mts";
import { library_render_scoped_cases } from "./fixtures/library-render-scoped-cases.mts";
import { hsonLiveMap } from "hson-live/livemap";
import { FileCheckpointAdapter } from "./helpers/file-checkpoint-adapter.mts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "locus.scoped-ssr", title: "Public scoped SSR H2",
  category: "Locus", runtime: "node", tags: Object.freeze(["public-api", "scope", "ssr", "worker", "security", "http", "http2", "recovery"]) });
let count = 0;
await scoped_ssr_cases(async (name, run) => { await run(); count++; console.log(`ok - ${name}`); });
await library_render_scoped_cases(async (name, run) => { await run(); count++; console.log(`ok - ${name}`); });
const worker = repository_typescript_worker(new URL("./fixtures/locus-scoped-ssr.worker.mts", import.meta.url));
try {
  assert.equal(await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject); worker.once("exit", code => reject(Error(`Worker exited ${code}`)));
  }), count);
} finally { await worker.terminate(); }
console.log(`H2 SSR passed (${count} Node and ${count} Worker groups).`);

await scoped_ssr_http();
const dir = await mkdtemp(join(tmpdir(), "hson-h2-"));
try {
  const file = join(dir, "state.json");
  const locus = await hsonLiveMap.locus.resume({ ...definition[0] }, { ...definition[1], logicalMapId: "h2-restart", persistence: new FileCheckpointAdapter(file) });
  let revision: number;
  try {
    await locus.stage(w => { w.doc.must("flat").at([]).asElement().attrs.set("title", "checkpoint"); w.doc.must("bare").at([0]).delete(); });
    await hsonLiveMap.locus.checkpoint(locus);
    await locus.admit({ "later": { ...page, access: "shared" } });
    await locus.stage(w => { w.doc.must("page").at([1,0]).delete(); w.doc.must("page").at([]).asElement().attrs.set("title", "tail"); w.doc.must("page").css.sel("body").setProp("color", "purple"); });
    revision = locus.rev;
  } finally { locus.dispose(); }
  const child = spawn(process.execPath, ["--import=tsx", fileURLToPath(new URL("./fixtures/locus-scoped-ssr.restart.mts", import.meta.url)), file, String(revision)], { stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  assert.equal(code, 0, output); assert.match(output, /h2-restart-ok/);
  console.log("H2 checkpoint/tail fresh-process SSR passed.");
} finally { await rm(dir, { recursive: true, force: true }); }
