import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hsonLiveMap } from "hson-live/livemap";
import { FileCheckpointAdapter } from "./helpers/file-checkpoint-adapter.mts";
import { definition, page, document, receiver, caught } from "./fixtures/locus-scoped-hosted-cases.mts";
import assert from "node:assert/strict";
import { hosted_scoped_cases, hosted_scoped_rejection_cases } from "./fixtures/locus-scoped-hosted-cases.mts";
import { hosted_mixed_cases } from "./fixtures/locus-scoped-hosted-mixed-cases.mts";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "locus.scoped-hosted", title: "Public scoped state delivery H1",
  category: "Locus", runtime: "node", tags: Object.freeze(["public-api", "scope", "http", "websocket", "worker", "recovery", "security"]) });
const timeout = setTimeout(() => { console.error("H1 acceptance timed out"); process.exit(1); }, 60_000);
timeout.unref();
let count = 0;
await hosted_scoped_cases(async (name, run) => { await run(); count++; console.log(`ok - ${name}`); });
await hosted_scoped_rejection_cases(async (name, run) => { await run(); count++; console.log(`ok - ${name}`); });
await hosted_mixed_cases(async (name, run) => { await run(); count++; console.log(`ok - ${name}`); });
const worker = repository_typescript_worker(new URL("./fixtures/locus-scoped-hosted.worker.mts", import.meta.url));
try {
  assert.equal(await new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject); worker.once("exit", code => reject(Error(`Worker exited ${code}`)));
  }), count);
} finally { await worker.terminate(); }
const dir = await mkdtemp(join(tmpdir(), "hson-h1-"));
try {
  const file = join(dir, "state.json"), persistence = new FileCheckpointAdapter(file);
  const locus = await hsonLiveMap.locus.resume({ ...definition, logicalMapId: "h1-restart", persistence });
  const active = await receiver(locus, "websocket");
  let baseline: string;
  try {
    await locus.stage(w => {
      w.doc.must("page").at([]).asElement().attrs.set("title", "checkpoint");
      w.doc.must("flat").at([]).asElement().attrs.set("title", "checkpoint");
      w.doc.must("flat").css.sel("body").setProp("color", "navy");
      w.doc.must("bare").at([0]).delete();
    });
    await hsonLiveMap.locus.checkpoint(locus);
    await locus.addLibraries({ shared: [{ name: "later", definition: page }] });
    await locus.stage(w => {
      w.doc.must("page").at([0]).delete();
      w.doc.must("page").at([]).asElement().attrs.set("title", "durable-tail");
      w.doc.must("page").css.sel("main").setProp("color", "teal");
      w.doc.must("flat").at([]).asElement().attrs.set("title", "durable-tail");
      w.doc.must("flat").css.sel("body").setProp("color", "maroon");
      w.data.must("data").at(["n"]).set(7);
    });
    await caught(active.echo, locus);
    baseline = JSON.stringify({ rev: locus.rev, css: document(active.echo).css.snapshot(), incarnation: locus.incarnationId });
    const stored = await readFile(file, "utf8");
    assert.doesNotMatch(stored, /"identityEpoch"|"issued"|"quid"/);
  } finally { active.dispose(); locus.dispose(); }
  const child = spawn(process.execPath, ["--import=tsx", fileURLToPath(new URL("./fixtures/locus-scoped-hosted.restart.mts", import.meta.url)), file, baseline],
    { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", part => { stdout += String(part); }); child.stderr.on("data", part => { stderr += String(part); });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  assert.equal(code, 0, stderr); assert.equal(stdout.trim(), "h1-restart-ok");
  console.log("ok - public fresh-process checkpoint and durable scoped tail restart");
} finally { await rm(dir, { recursive: true, force: true }); }
clearTimeout(timeout);
console.log(`H1 passed (${count} Node and ${count} Worker groups).`);
