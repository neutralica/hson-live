import assert from "node:assert/strict";
import { discover_hson_tagged_templates as tags } from "../src/internal/embedded-hson/discover-hson-tagged-templates.ts";
import { discover_schema_validation_sources as associations } from "../src/internal/trusted-schema-diagnostics/discover-validation-sources.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
function check(name: string, run: () => void): void { run(); console.log(`ok ${++checks} - ${name}`); }
const file = "/project/user.ts";
const source = 'const source = Hson`<age "37">`;';
const schema = 'import { Schema } from "./schema.js";';
const author = 'import { Hson } from "hson-live/hson";';
const validate = 'Hson.certify(Schema, source);';
for (const entry of ["hson-live", "hson-live/hson"]) {
  check(`official uppercase authoring from ${entry}`, () => assert.equal(tags(file, `import { Hson } from "${entry}";` + source).sources.length, 1));
  check(`uppercase validation from ${entry}`, () => assert.equal(associations(file, `import { Hson } from "${entry}";` + schema + source + validate).length, 1));
}
check("renamed uppercase authoring and validation", () => assert.equal(associations(file, (author + schema + source + validate).replaceAll("Hson", "markup").replace("{ markup }", "{ Hson as markup }")).length, 1));
check("lowercase aggregate tag is retired", () => assert.equal(tags(file, 'import { hson } from "hson-live"; const source = hson`<age 1>`;').sources.length, 0));
check("retired lowercase authoring subpath import", () => assert.equal(tags(file, 'import { hson } from "hson-live/hson"; const source = hson`<age 1>`;').sources.length, 0));
check("local uppercase lookalike is unavailable", () => assert.equal(associations(file, 'const Hson = anything;' + schema + source + validate).length, 0));
check("wrong authoring package is unavailable", () => assert.equal(associations(file, author.replace('"hson-live/hson"', '"other"') + schema + source + validate).length, 0));
check("shadowed uppercase tag is unavailable", () => assert.equal(tags(file, author + 'function f(Hson: any) {' + source + '}').sources.length, 0));
check("shadowed uppercase validator is unavailable", () => assert.equal(associations(file, author + schema + 'function f(Hson: any) {' + source + validate + '}').length, 0));
check("uppercase facade has no map construction identity", () => assert.equal(associations(file, author + schema + source + 'const map = Hson.liveMap.fromHson(source); map.schema.use(Schema);').length, 0));
for (const entry of ["hson-live", "hson-live/livemap"]) {
  const mapImport = `import { hsonLiveMap as maps } from "${entry}";`;
  check(`retained dedicated validation at ${entry}`, () => assert.equal(associations(file, author + mapImport + schema + source + 'maps.schema.validate(Schema, source);').length, 1));
  check(`natural dedicated construction at ${entry}`, () => assert.equal(associations(file, author + mapImport + schema + source + 'const map = maps.fromHson(source); map.schema.use(Schema);').length, 1));
}
check("retained aggregate standalone validation", () => assert.equal(associations(file, author + 'import { hson } from "hson-live";' + schema + source + 'hson.liveMap.schema.validate(Schema, source);').length, 1));
check("authoring subpath does not identify retired subsystem export", () => assert.equal(associations(file, author + 'import { hsonLiveMap } from "hson-live/hson";' + schema + source + 'hsonLiveMap.schema.validate(Schema, source);').length, 0));
check("authoring subpath does not identify retired aggregate export", () => assert.equal(associations(file, author + 'import { hson } from "hson-live/hson";' + schema + source + 'hson.liveMap.schema.validate(Schema, source);').length, 0));
check("all validation entrances and natural governance stay independent", () => {
  const found = associations(file, author + 'import { hson, hsonLiveMap } from "hson-live";' + schema + source + validate
    + 'hson.liveMap.schema.validate(Schema, source); hsonLiveMap.schema.validate(Schema, source); const map = hsonLiveMap.fromHson(source); map.schema.use(Schema);');
  assert.equal(found.length, 4);
  assert.equal(new Set(found.map(item => item.callId)).size, 4);
  assert.equal(new Set(found.map(item => item.source.bodyRange.start)).size, 1);
});
emit_hson_live_test_completion("hson-authoring-discovery", checks, checks, 0);
