import assert from "node:assert/strict";

import { discover_static_from_hson_sources } from "../src/internal/embedded-hson/discover-static-from-hson-sources.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const run = (text: string) => discover_static_from_hson_sources("/project/source.ts", text).sources;
function check(name: string, text: string, count: number, boundary?: string): void {
  const found = run(text); assert.equal(found.length, count, name); if (boundary !== undefined) assert.equal(found[0]?.boundary, boundary);
  console.log(`ok ${++checks} - ${name}`);
}
const root = 'import { hson, hsonTransform, hsonLiveMap, hsonLiveTree } from "hson-live";\n';

check("aggregate Transform shortcut", root + 'hson.fromHson("<a/>");', 1, "transform");
check("aggregate Transform namespace", root + 'hson.transform.fromHson("<a/>");', 1, "transform");
check("root narrow Transform facade", root + 'hsonTransform.fromHson("<a/>");', 1, "transform");
check("Transform subpath renamed import", 'import { hsonTransform as convert } from "hson-live/transform"; convert.fromHson("<a/>");', 1, "transform");
check("aggregate LiveMap facade", root + 'hson.liveMap.fromHson("<a/>");', 1, "livemap");
check("root narrow LiveMap facade", root + 'hsonLiveMap.fromHson("<a/>");', 1, "livemap");
check("LiveMap subpath renamed import", 'import { hsonLiveMap as maps } from "hson-live/livemap"; maps.fromHson("<a/>");', 1, "livemap");
check("aggregate LiveTree facade", root + 'hson.liveTree.fromHson("<a/>");', 1, "livetree");
check("root narrow LiveTree facade", root + 'hsonLiveTree.fromHson("<a/>");', 1, "livetree");
check("LiveTree subpath renamed import", 'import { hsonLiveTree as trees } from "hson-live/livetree"; trees.fromHson("<a/>");', 1, "livetree");
check("direct single quoted literal", root + "hson.fromHson('<a/>');", 1);
check("ordinary template literal", root + 'hson.fromHson(`<a/>`);', 1);
check("parentheses", root + 'hson.fromHson(((`<a/>`)));', 1);
check("immutable const source", root + 'const source = `<a/>`; hson.fromHson(source);', 1);
check("finite immutable alias chain", root + 'const authored = `<a/>`; const source = authored; hson.fromHson(source);', 1);
check("wrong package rejected", 'import { hsonTransform } from "other"; hsonTransform.fromHson("+1");', 0);
check("local lookalike rejected", 'const fake = { fromHson(value: string) { return value; } }; fake.fromHson("+1");', 0);
check("shadowed aggregate rejected", root + 'function f(hson: any) { hson.fromHson("+1"); }', 0);
check("mutable let source rejected", root + 'let source = `<a/>`; hson.fromHson(source);', 0);
check("mutable var source rejected", root + 'var source = `<a/>`; hson.fromHson(source);', 0);
check("interpolated ordinary template deferred", root + 'hson.fromHson(`<a ${value}>`);', 0);
check("concatenation deferred", root + 'hson.fromHson("<a" + "/>");', 0);
check("helper return deferred", root + 'hson.fromHson(makeSource());', 0);
check("imported source deferred", root + 'import { source } from "./data.js"; hson.fromHson(source);', 0);
check("two identical occurrences remain distinct", root + 'hson.fromHson("<a/>"); hson.fromHson("<a/>");', 2);
const identical = run(root + 'hson.fromHson("<a/>"); hson.fromHson("<a/>");');
assert.notEqual(identical[0]?.literalRange.start, identical[1]?.literalRange.start);

emit_hson_live_test_completion("from-hson-static-discovery", checks, checks, 0);
