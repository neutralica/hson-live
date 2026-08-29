import assert from "node:assert/strict";
import { hson } from "../src/hson.ts";
import { read_graph_backed_schema } from "../src/api/livemap/livemap.schema.ts";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
const schema = hson.liveMap.schema;

const unresolvedFragment = schema.array(schema.reference("Later"));
check("unresolved reference composition is an inert finalizable fragment", () => assert.equal(read_graph_backed_schema(unresolvedFragment), undefined));
check("unresolved fragment validation fails closed without executing a resolver", () => assert.equal(unresolvedFragment.validateRoot([1]).issues[0]?.code, "INVALID_SCHEMA"));

type TreeValue = Readonly<{ value: string; children?: readonly TreeValue[] }>;
const trees = schema.declarations({
  Tree: schema.object.exact({
    value: schema.string,
    children: schema.optional(schema.array(schema.reference<TreeValue>("Tree"))),
  }),
});

check("self-recursive declaration finalizes complete graph", () => assert.ok(read_graph_backed_schema(trees.Tree)));
check("self-recursive declaration contains explicit graph ref", () => assert.equal(read_graph_backed_schema(trees.Tree)?.nodes.some((node) => node.kind === "projected-ref"), true));
check("self-recursive declaration accepts finite tree", () => assert.equal(trees.Tree.validateRoot({ value: "root", children: [{ value: "leaf" }] }).ok, true));
check("self-recursive declaration reports deep invalid value", () => assert.deepEqual(trees.Tree.validateRoot({ value: "root", children: [{ value: 2 }] }).issues[0]?.path, ["children", 0, "value"]));

type AValue = Readonly<{ kind: "a"; peer?: BValue }>;
type BValue = Readonly<{ kind: "b"; peer?: AValue }>;
const mutual = schema.declarations({
  A: schema.object.exact({ kind: schema.literal("a"), peer: schema.optional(schema.reference<BValue>("B")) }),
  B: schema.object.exact({ kind: schema.literal("b"), peer: schema.optional(schema.reference<AValue>("A")) }),
});
check("mutual recursion finalizes both declarations", () => assert.ok(read_graph_backed_schema(mutual.A) && read_graph_backed_schema(mutual.B)));
check("mutual recursion accepts alternating structure", () => assert.equal(mutual.A.validateRoot({ kind: "a", peer: { kind: "b", peer: { kind: "a" } } }).ok, true));
check("mutual recursion rejects wrong branch", () => assert.equal(mutual.A.validateRoot({ kind: "a", peer: { kind: "a" } }).ok, false));

check("missing symbolic target rejects during finalization", () => assert.throws(() => schema.declarations({ Root: schema.array(schema.reference("Missing")) }), /no matching declaration/));
check("ref-only self cycle rejects productivity", () => assert.throws(() => schema.declarations({ Bad: schema.reference("Bad") }), /no consuming validation progress/));
check("optional ref cycle rejects productivity", () => assert.throws(() => schema.declarations({ Bad: schema.optional(schema.reference("Bad")) }), /no consuming validation progress/));
check("nullable ref cycle rejects productivity", () => assert.throws(() => schema.declarations({ Bad: schema.nullable(schema.reference("Bad")) }), /no consuming validation progress/));
check("refinement ref cycle rejects productivity", () => assert.throws(() => schema.declarations({ Bad: schema.integer(schema.reference<number>("Bad")) }), /no consuming validation progress/));
check("array reference cycle is productive", () => assert.ok(schema.declarations({ Nested: schema.array(schema.reference("Nested")) }).Nested));
check("tuple reference cycle is productive", () => assert.ok(schema.declarations({ Nested: schema.tuple(schema.reference("Nested")) }).Nested));
check("record reference cycle is productive", () => assert.ok(schema.declarations({ Nested: schema.record(schema.reference("Nested")) }).Nested));

emit_hson_live_test_completion("canonical-schema-explicit-recursion", checks, checks, 0);
