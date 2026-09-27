import assert from "node:assert/strict";
import { completion_context } from "../src/internal/schema-completion/context.ts";
import { create_test_event_emitter } from "./test-events.mjs";
export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson-completion-context",
  title: "D6 authoritative cursor context",
  category: "Transform",
  runtime: "node",
  tags: Object.freeze(["hson", "authoring", "internal"]),
});

const testEvents = create_test_event_emitter("hson-completion-context");
let checks = 0;
const check = (name: string, f: () => void) => {
  testEvents.case_begin(name, name);
  try {
    f();
    testEvents.case_end(name, "pass");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Check failed.";
    testEvents.diagnostic(name, "assertion", message.slice(0, 1_000));
    testEvents.case_end(name, "fail");
    testEvents.terminal("fail");
    throw error;
  } console.log(`ok ${++checks} - ${name}`); };
const context = (marked: string) => completion_context(marked.replace("|", ""), marked.indexOf("|"));
const slot = (source: string, kind: string, path: readonly (string | number)[]) => { const result = context(source); assert.equal(result?.kind, kind); assert.deepEqual(result?.path, path); };
check("empty data member slot", () => slot("<|>", "member", []));
check("member slot after existing member", () => { slot("<a true |>", "member", []); assert.deepEqual(context("<a true |>")?.existing, ["a"]); });
check("missing member value", () => slot("<a |>", "value", ["a"]));
check("complete literal replacement", () => { slot('<a "re|d">', "value", ["a"]); assert.deepEqual(context('<a "re|d">')?.range, { start: 3, end: 8 }); });
check("array initial slot", () => slot("[|]", "value", [0]));
check("tuple next slot after comma", () => slot("[true, |]", "value", [1]));
check("guillemet array", () => slot("«false, |»", "value", [1]));
check("nested object path", () => slot("<a <b < |>>>", "member", ["a", "b"]));
check("nested array object path", () => slot("<a [<b |>]>", "value", ["a", 0, "b"]));
check("document tag slot", () => slot("< |/>", "tag", []));
check("document nested tag", () => slot("<div < |/>/>", "tag", [0]));
check("partial document tag replacement", () => { slot("<di|v/>", "tag", []); assert.deepEqual(context("<di|v/>")?.range, { start: 1, end: 4 }); assert.equal(context("<di|v/>")?.replacing, true); });
check("tag replacement before attributes", () => { slot('<di|v role="button"/>', "tag", []); assert.deepEqual(context('<di|v role="button"/>')?.range, { start: 1, end: 4 }); });
check("nested partial tag replacement", () => slot("<div <sp|an/>/>", "tag", [0]));
check("top-level document sequence tag", () => slot("<span/><se|ction/>", "tag", [1]));
check("tag cursor immediately before element close", () => { slot("<div|/>", "tag", []); assert.deepEqual(context("<div|/>")?.range, { start: 1, end: 4 }); });
check("completed element has no tag slot", () => assert.equal(context("<div/>|"), undefined));
check("malformed element close has no tag slot", () => assert.equal(context("<div/|>"), undefined));
check("document child after element or text", () => { for (const body of ['<span/>', '"text"', '<span "text"/>']) slot(`<div ${body} |/>`, "child", [1]); });
check("header is honestly attr-or-child", () => { slot("<div |/>", "header", []); assert.equal(context("<div |/>")?.childIndex, 0); });
check("attribute value missing", () => { slot("<div role=|/>", "attribute-value", []); assert.equal(context("<div role=|/>")?.attribute, "role"); });
check("flag replacement", () => { slot("<div dis|abled/>", "header", []); assert.equal(context("<div dis|abled/>")?.replacing, true); });
check("existing attrs filtered from evidence", () => assert.deepEqual(context('<div role="button" disabled |/>')?.existing, ["role", "disabled"]));
check("comments are not completion slots", () => assert.equal(context("< // comm|ent\na true>"), undefined));
check("duplicate members fail probe parsing", () => assert.equal(context("<a true a false | >"), undefined));
check("duplicate attrs fail probe parsing", () => assert.equal(context('<div x="a" x="b" |/>'), undefined));
check("unclosed surrounding syntax is unavailable", () => assert.equal(context("<a < |"), undefined));
check("missing array comma does not guess append", () => assert.equal(context("[true |]"), undefined));
check("crossed structure is unavailable", () => assert.equal(context("<a <div |/>>"), undefined));
check("analysis never edits source", () => { const source = '<a >'; completion_context(source, 3); assert.equal(source, '<a >'); });
testEvents.terminal("pass");
