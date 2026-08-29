import assert from "node:assert/strict";
import ts from "typescript";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
const sourceText = `
const Name = schema.length(schema.string, { minimum: 1 });
const User = schema.object.exact({ name: Name, role: schema.pick("admin", "user") });
const Attrs = schema.attrs.exact({ id: schema.string, hidden: schema.flag.optional });
const Page = schema.main(Attrs, schema.div(schema.a()));
const TreeRef = schema.reference("Tree");
const { Tree } = schema.declarations({ Tree: schema.object.exact({ name: Name, children: schema.optional(schema.array(TreeRef)) }) });
`;
const source = ts.createSourceFile("direct-schema.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const calls: ts.CallExpression[] = [];
let functionLike = 0;
let dynamicAccess = 0;
let spread = 0;
source.forEachChild(function visit(node): void {
  if (ts.isCallExpression(node)) calls.push(node);
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) functionLike += 1;
  if (ts.isElementAccessExpression(node)) dynamicAccess += 1;
  if (ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) spread += 1;
  ts.forEachChild(node, visit);
});

check("direct declaration corpus contains fixed constructor calls", () => assert.ok(calls.length >= 10));
check("every constructor callee is a static property access", () => assert.equal(calls.every((call) => ts.isPropertyAccessExpression(call.expression)), true));
check("direct declarations contain no callbacks", () => assert.equal(functionLike, 0));
check("direct declarations contain no dynamic property access", () => assert.equal(dynamicAccess, 0));
check("direct declarations contain no spreads", () => assert.equal(spread, 0));
check("object and element structure remain syntactically distinct fixed constructors", () => assert.match(sourceText, /schema\.object\.exact[\s\S]*schema\.main/));
check("symbolic recursion is statically named data", () => assert.match(sourceText, /schema\.reference\("Tree"\)[\s\S]*schema\.declarations/));

emit_hson_live_test_completion("canonical-schema-static-authoring", checks, checks, 0);
