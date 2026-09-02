import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "core.hson-authoring-package",
  title: "Hson authoring package boundary",
  category: "Core",
  runtime: "node",
  tags: Object.freeze(["hson", "authoring", "bundling", "built-package"]),
});

// Use the editor's established bundler; no new library runtime dependency.
const { build } = createRequire(new URL("../editors/vscode-hson/package.json", import.meta.url))("esbuild");
const root = fileURLToPath(new URL("..", import.meta.url));
const sources = {
  tag: 'import { Hson } from "hson-live/hson"; export const value = Hson`<foo/>`;',
  validation: 'import { Hson } from "hson-live/hson"; export const value = Hson.certify(globalThis.schema, Hson`<foo/>`);',
  aggregate: 'import { hson } from "hson-live"; console.log(hson.liveMap);',
  transform: 'import { hsonTransform } from "hson-live/transform"; console.log(hsonTransform);',
  livemap: 'import { hsonLiveMap } from "hson-live/livemap"; console.log(hsonLiveMap);',
};
const results = {};
for (const [name, contents] of Object.entries(sources)) {
  const options = { stdin: { contents, resolveDir: root, sourcefile: `${name}.js` }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", treeShaking: true, legalComments: "none", metafile: true };
  const raw = await build(options);
  const min = await build({ ...options, minify: true });
  const inputs = Object.values(min.metafile.outputs).flatMap(output => Object.entries(output.inputs)).filter(([, input]) => input.bytesInOutput > 0).map(([path]) => path);
  results[name] = { raw: raw.outputFiles[0].contents.length, min: min.outputFiles[0].contents.length, gzip: gzipSync(min.outputFiles[0].contents, { level: 9 }).length, inputs, parsed: Object.keys(min.metafile.inputs), code: min.outputFiles[0].text };
}
let checks = 0;
const testEvents = create_test_event_emitter("core.hson-authoring-package");
function check(name, run) {
  testEvents.case_begin(name, name);
  try {
    run();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  }
  console.log(`ok ${++checks} - ${name}`);
}
const narrow = results.tag;
check("actual /hson export resolves to the narrow authoring module", () => assert.ok(narrow.inputs.some(path => path.endsWith("dist/hson-authoring.js"))));
check("authoring does not traverse aggregate or full LiveMap core", () => assert.ok(narrow.parsed.every(path => !/(?:dist\/hson\.js|livemap\.core\.js|\/livetree\/|\/livehost\/|\/locus\/|\/reflect\/|\/inspect\/)/.test(path))));
check("authoring has no browser or external parser dependencies", () => assert.ok(narrow.parsed.every(path => !/(?:node_modules|transform\.browser|\/safety\/)/.test(path))));
check("tree-shaken authoring retains no mutation history or session machinery", () => assert.ok(narrow.inputs.every(path => !/livemap\.(?:mutation|replay|history|session|store|install)/.test(path))));
// The Hson Schema compiler uses source provenance for exact authored diagnostics,
// and the validators use issue-presentation's semantic sidecar. No capture,
// provider, lifecycle, protocol, or generated source-map module may join them.
check("D5 tooling never enters the ordinary authoring graph", () => assert.ok(narrow.parsed.every(path =>
  !/trusted-schema-diagnostics|embedded-hson|source-provenance/.test(path)
  || path.endsWith("trusted-schema-diagnostics/issue-presentation.js")
  || path.endsWith("hson-source-provenance/hson-source-provenance.js")
  || path.endsWith("hson-source-provenance/parse-hson-with-provenance.js"))));
check("D6 completion query/provider machinery never enters production Hson", () => assert.ok(narrow.parsed.every(path => !/schema-completion|completion-source|vscode-hson/.test(path))));
check("same-object certify retains real Schema validators in tag-only bundle", () => {
  assert.ok(narrow.inputs.some(path => path.endsWith("internal/canonical-schema/verify.js")));
  assert.ok(narrow.inputs.some(path => path.endsWith("internal/schema-hson-validation/validate-canonical-hson.js")));
});
check("narrow authoring stays within the approved practical size boundary", () => { assert.ok(narrow.gzip < 45_000, `gzip=${narrow.gzip}`); assert.ok(narrow.gzip < results.aggregate.gzip / 4); });
check("referencing certify does not unexpectedly import another subsystem", () => assert.deepEqual(results.validation.inputs.filter(path => path.startsWith("dist/")), narrow.inputs.filter(path => path.startsWith("dist/"))));
const execution = await import('data:text/javascript;base64,' + Buffer.from(narrow.code).toString('base64'));
check("production authoring bundle executes without a browser", () => assert.equal(execution.value, "<foo/>"));
for (const [name, { raw, min, gzip, inputs }] of Object.entries(results)) console.log(`# ${name}: ${JSON.stringify({ raw, min, gzip, retainedModules: inputs.length })}`);
console.log(`# ${checks} Hson authoring package checks passed`);
testEvents.terminal("pass");
