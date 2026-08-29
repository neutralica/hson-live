import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

type Category = "A" | "B" | "C" | "D" | "E";
type CensusEntry = Readonly<{ file: string; line: number; category: Category }>;
const root = new URL("..", import.meta.url).pathname;
const testRoot = join(root, "tests");
const files = walk(testRoot).filter(file => /\.(?:mts|ts)$/.test(file) && !file.includes("canonical-schema-"));
const entries: CensusEntry[] = [];
const constrainIntents: Record<string, number> = { numericBound: 0, integer: 0, stringLength: 0, stringPattern: 0, collectionLength: 0, uniqueness: 0, arbitraryBusiness: 0, sideEffectOrThrow: 0, other: 0 };

for (const file of files) {
  const sourceText = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, file.endsWith(".mts") ? ts.ScriptKind.TS : ts.ScriptKind.TS);
  const aliases = new Set<string>();
  source.forEachChild(function collectAliases(node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && isSchemaDefineExpression(node.initializer, source)) aliases.add(node.name.text);
    ts.forEachChild(node, collectAliases);
  });
  source.forEachChild(function visit(node): void {
    if (ts.isCallExpression(node) && (isSchemaDefineExpression(node.expression, source) || (ts.isIdentifier(node.expression) && aliases.has(node.expression.text)))) {
      const argument = node.arguments[0];
      let category: Category;
      if (argument === undefined) category = "E";
      else {
        const executable = subtreeFlags(argument);
        if (executable.constrain) {
          category = "B";
          constrainIntents[classifyConstrainIntent(argument.getText(source))] += 1;
        }
        else if (executable.recurse) category = "C";
        else if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) category = "D";
        else if (hasFunctionAncestor(node) || executable.dynamicFrontend) category = "D";
        else category = "A";
      }
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      entries.push(Object.freeze({ file: relative(root, file), line: position.line + 1, category }));
    }
    ts.forEachChild(node, visit);
  });
}

const counts: Record<Category, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
for (const entry of entries) counts[entry.category] += 1;
assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), entries.length);
assert.ok(counts.A > 0, "expected declarative static corpus");
assert.ok(counts.B > 0, "expected constrain blockers");
assert.ok(counts.C > 0, "expected recurse blockers");
assert.ok(counts.D > 0, "expected acquisition-only dynamic definitions");
assert.equal(counts.E, 0, `unexpected blockers: ${JSON.stringify(entries.filter(entry => entry.category === "E"))}`);
console.log(`# canonical Schema corpus census ${JSON.stringify({ total: entries.length, ...counts })}`);
console.log(`# constrain intent census ${JSON.stringify(constrainIntents)}`);
let checks = 0;
for (const [name, run] of [
  ["all discovered callsites are classified", () => assert.ok(entries.length > 0)],
  ["fully declarative/static category is populated", () => assert.ok(counts.A > 0)],
  ["constrain blocker category is populated", () => assert.ok(counts.B > 0)],
  ["executable recurse blocker category is populated", () => assert.ok(counts.C > 0)],
  ["dynamic frontend/acquisition-only category is populated", () => assert.ok(counts.D > 0)],
  ["no unexpected blocker remains", () => assert.equal(counts.E, 0)],
  ["every constrain-bearing callsite has an intent classification", () => assert.equal(Object.values(constrainIntents).reduce((sum, count) => sum + count, 0), counts.B)],
] as const) { run(); console.log(`ok ${++checks} - ${name}`); }
emit_hson_live_test_completion("canonical-schema-corpus-census", checks, checks, 0);

function walk(directory: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(path)); else result.push(path);
  }
  return result;
}

function isSchemaDefineExpression(node: ts.Expression, source: ts.SourceFile): boolean {
  return ts.isPropertyAccessExpression(node) && node.name.text === "define" && /(?:^|\.)schema$/.test(node.expression.getText(source));
}

function subtreeFlags(node: ts.Node): { constrain: boolean; recurse: boolean; dynamicFrontend: boolean } {
  const result = { constrain: false, recurse: false, dynamicFrontend: false };
  const visit = (child: ts.Node): void => {
    if (ts.isPropertyAccessExpression(child)) {
      if (child.name.text === "constrain") result.constrain = true;
      if (child.name.text === "recurse") result.recurse = true;
    }
    if (ts.isElementAccessExpression(child) && !ts.isStringLiteral(child.argumentExpression)) result.dynamicFrontend = true;
    if (ts.isSpreadAssignment(child) || ts.isSpreadElement(child)) result.dynamicFrontend = true;
    ts.forEachChild(child, visit);
  };
  visit(node); return result;
}

function hasFunctionAncestor(node: ts.Node): boolean {
  let parent = node.parent;
  while (parent !== undefined) {
    if (ts.isFunctionLike(parent)) return true;
    parent = parent.parent;
  }
  return false;
}

function classifyConstrainIntent(text: string): keyof typeof constrainIntents {
  if (/\bthrow\b|\+\+|--|\+=|-=|\.push\s*\(|\.add\s*\(/.test(text)) return "sideEffectOrThrow";
  if (/Number\.isInteger\s*\(/.test(text)) return "integer";
  if (/new\s+Set\b|\.every\s*\([^)]*(?:indexOf|findIndex)/.test(text)) return "uniqueness";
  if (/\.length\b/.test(text)) return /(?:s|schema)\.string/.test(text) ? "stringLength" : "collectionLength";
  if (/\.test\s*\(|\.match\s*\(|\.startsWith\s*\(|\.endsWith\s*\(|\.includes\s*\(/.test(text)) return "stringPattern";
  if (/(?:=>|return)[^;{}]*(?:>=|<=|>|<)\s*-?\d/.test(text)) return "numericBound";
  if (/constrain\s*\(\s*(?:["'`][^"'`]*["'`]\s*,\s*)?[^)]*=>/.test(text)) return "arbitraryBusiness";
  return "other";
}
