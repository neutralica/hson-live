import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { Hson as publicHson } from "hson-live/hson";
import { Hson as rootHson } from "hson-live";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "core.hson-partial-quoted-package", title: "Partial quoted interpolation package consumers",
  category: "Core", runtime: "node", tags: Object.freeze(["hson", "interpolation", "worker", "built-package"]),
});
const events = create_test_event_emitter(HSON_LIVE_TEST_METADATA.id);
const { build } = createRequire(new URL("../editors/vscode-hson/package.json", import.meta.url))("esbuild");
const root = fileURLToPath(new URL("..", import.meta.url));
let checks = 0;
function check(name, run) {
  events.case_begin(name, name);
  try { run(); events.case_end(name, "pass"); }
  catch (error) { events.case_end(name, "fail"); events.terminal("fail"); throw error; }
  console.log(`ok ${++checks} - ${name}`);
}
check("root and narrow public authoring entrypoints share interpolation and identity", () => {
  assert.equal(publicHson, rootHson);
  assert.equal(publicHson.document`<a href="/slides/${2}"/>`, '<a href="/slides/2"/>');
  assert.equal(rootHson.data`"pre${true}${null}${-0}post"`, '"pretruenull-0post"');
  assert.equal(publicHson.data.materialize(publicHson.data`"${""}
  tail
"`), "\n  tail\n");
});
const source = `import { Hson, ANY_DOCUMENT } from "hson-live/hson";
    const hostile = '\\"/><script src=\\"/evil.js\\"/>';
    const schema = Hson.schema\`<type "document" tag "a" attrs <props <href <exact "/slides/2"> title "string"> closed true> content "empty">\`;
    const value = Hson.document\`<a href="/slides/\${2}" title="pre\${hostile}\${null}\${-0}post"/>\`;
    const attrs = Hson.document.toNode(schema.certify(value)).$_content[0].$_attrs;
    let rejects = false; try { schema.certify(Hson.document\`<a href="/slides/\${3}" title="ok"/>\`); } catch { rejects = true; }
    export const parity = { href: attrs.href, exactText: attrs.title === 'pre' + hostile + 'null-0post',
      oneNode: Hson.document.toNode(ANY_DOCUMENT.certify(value)).$_content.length === 1, rejects,
      data: Hson.data.materialize(Hson.data\`<label "pre\${true}\${null}\${-0}post">\`).label,
      empty: Hson.data.materialize(Hson.data\`"\${""}
  tail
"\`) };`;
const partialExpected = { href: "/slides/2", exactText: true, oneNode: true, rejects: true, data: "pretruenull-0post", empty: "\n  tail\n" };
for (const platform of ["browser", "neutral"]) {
  const result = await build({ stdin: { contents: source, resolveDir: root, sourcefile: "partial.js" },
    bundle: true, write: false, format: "esm", platform, target: "es2022", treeShaking: true, minify: true, metafile: true });
  check(`${platform} authoring adds no editor, host, or evaluation machinery`, () => {
    assert.deepEqual(Object.keys(result.metafile.inputs).filter(path => /vscode-hson|typescript|node:|trusted-schema-diagnostics|embedded-hson|\/api\/(?:livehost|locus|livetree)\//.test(path)), []);
  });
  const url = 'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64');
  const execution = await import(url);
  check(`${platform} package preserves quoted strings, injection boundaries, and Schema`, () => assert.deepEqual(execution.parity, partialExpected));
  const workerResult = await new Promise((resolve, reject) => {
    const worker = new Worker(`const { parentPort } = require("node:worker_threads"); import(${JSON.stringify(url)}).then(({ parity }) => parentPort.postMessage(parity), (error) => { throw error; });`, { eval: true });
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", code => { if (code !== 0) reject(new Error(`interpolation Worker exited with code ${code}`)); });
  });
  check(`${platform} bundle executes the same interpolation in a Worker`, () => assert.deepEqual(workerResult, partialExpected));
}
console.log(`# ${checks} partial quoted package checks passed`);
events.terminal("pass");
