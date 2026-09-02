import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { create_test_event_emitter } from "./test-events.mjs";

export const HSON_LIVE_TEST_METADATA = Object.freeze({
  id: "hson-schema-analyzer",
  title: "Hson Schema analyzer",
  category: "LiveMap",
  runtime: "node",
  tags: Object.freeze(["hson-schema", "analyzer", "tooling"]),
});

const testEvents = create_test_event_emitter("hson-schema-analyzer");
let checks = 0;
const check = (name: string, run: () => void): void => {
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
  } console.log(`ok ${++checks} - ${name}`); };
const root = resolve(".");
const project = mkdtempSync(join(tmpdir(), "hson-schema-analyzer-"));
const producer = join(project, "producer.ts");
const consumer = join(project, "consumer.ts");
const aliasSchema = join(project, "alias-schema.ts");
const documentSchema = join(project, "document-schema.ts");
const documentConsumer = join(project, "document-consumer.ts");
const localStatic = join(project, "local-static.ts");
const config = join(project, "tsconfig.json");

writeFileSync(producer, `import { Hson, type HsonSchema } from "hson-live";\nexport const UserSchema: HsonSchema = Hson\`<type "data" content <name "string" age <number <int true min 0 under 130>> code <string <len 4 prefix "ID" suffix "7" contains "-">> values <array <content "number" unique true minlen 1 maxlen 2>>>>\`;\nexport const FiniteSchema: HsonSchema = Hson\`<type "data" content <phase <union [<exact "lobby">, <union [<exact "ready">, <union [<exact "playing">, <exact "finished">]>]>]> turn <union [<exact "player1">, <union [<exact "player2">, "null"]>]> signedZero <union [<exact 0>, <exact -0>]>>>\`;\nexport const TreeSchema: HsonSchema = Hson\`<type "data" defs <Age <number <int true min 0>> Leaf <content <value "string" age <ref "Age"> children <tuple []>>> Tree <content <value "string" age <ref "Age"> children <array <ref "Tree">>>>> content <ref "Tree">>\`;\nthrow new Error("the analyzer must never execute this module");\n`);
writeFileSync(consumer, `import { Hson } from "hson-live"; import { type FiniteSchemaHson, type FiniteSchemaType, type TreeSchemaHson, type TreeSchemaType, type UserSchemaHson, type UserSchemaType } from "./producer.js";\nconst user: UserSchemaHson = Hson\`<name "Ada" age 37 code "ID-7" values [0, -0]>\`; void user;\nconst finite: FiniteSchemaHson = Hson\`<phase "playing" turn null signedZero -0>\`; void finite;\ndeclare const finiteValue: FiniteSchemaType; const phase: "lobby" | "ready" | "playing" | "finished" = finiteValue.phase; const turn: "player1" | "player2" | null = finiteValue.turn; void phase; void turn;\nconst tree: TreeSchemaHson = Hson\`<value "root" age 2 children [<value "leaf" age 0 children []>]>\`; void tree;\ndeclare const recursive: TreeSchemaType; const child: TreeSchemaType | undefined = recursive.children[0]; const recursiveAge: TreeSchemaType["age"] = recursive.age; void child; void recursiveAge;\ndeclare const value: UserSchemaType; const age: UserSchemaType["age"] = value.age; const code: UserSchemaType["code"] = value.code; const values: UserSchemaType["values"] = value.values; void age; void code; void values;\n// @ts-expect-error arithmetic erases integer proof\nconst changedAge: UserSchemaType["age"] = value.age + 1;\n// @ts-expect-error string transforms erase constraint proof\nconst changedCode: UserSchemaType["code"] = value.code.slice(0);\n// @ts-expect-error spread erases uniqueness proof\nconst changedValues: UserSchemaType["values"] = [...value.values];\n// @ts-expect-error referenced refinement proof rejects plain numbers\nconst plainRecursiveAge: TreeSchemaType["age"] = value.age;\nvoid changedAge; void changedCode; void changedValues; void plainRecursiveAge;\n`);
writeFileSync(aliasSchema, `import { Hson as Author, type HsonSchema as Schema } from "hson-live";\nexport const AliasSchema: Schema = Author\`<type "data" content <ok "boolean">>\`;\n`);
writeFileSync(documentSchema, `import { Hson, type HsonSchema } from "hson-live";\nexport const PageSchema: HsonSchema = Hson\`<type "document" tag "main" attrs <props <id "string" hidden <optional "flag">> closed true> content <sequence [<tag "header" content "empty">, <tag "section" content "string">]>>\`;\nexport const RepeatSchema: HsonSchema = Hson\`<type "document" defs <Code <string <prefix "ok-">> Item <tag "item" attrs <props <code <ref "Code">>> content "empty">> tag "list" content <repeat <ref "Item"> count 2>>\`;\nexport const DocumentSequenceSchema: HsonSchema = Hson\`<type "document" defs <Item <tag "item" content "empty">> content <repeat <ref "Item"> count 2>>\`;\n`);
writeFileSync(documentConsumer, `import { Hson } from "hson-live"; import type { DocumentSequenceSchemaHson, PageSchemaHson, PageSchemaType, RepeatSchemaHson, RepeatSchemaType } from "./document-schema.js";\nconst page: PageSchemaHson = Hson\`<main id=hero <header/> <section "body"/>/>\`; void page;\nconst repeated: RepeatSchemaHson = Hson\`<list <item code=ok-one/> <item code=ok-two/>/>\`; void repeated;\nconst documentSequence: DocumentSequenceSchemaHson = Hson\`<item/><item/>\`; void documentSequence;\ndeclare const value: PageSchemaType; const rootTag: "_hson_root" = value.$_tag; const main = value.$_content[0]; const mainTag: "main" = main.$_tag; const child = main.$_content[0].$_content[1]; const childTag: "section" = child.$_tag; void rootTag; void mainTag; void childTag;\ndeclare const repeatValue: RepeatSchemaType; const list = repeatValue.$_content[0]; const repeatedChild = list.$_content[0].$_content[0]; const repeatedTag: "item" = repeatedChild.$_tag; void repeatedTag;\n// @ts-expect-error a plain array cannot impersonate certified repeated content\nconst plainRepeated: RepeatSchemaType["$_content"][0]["$_content"][0]["$_content"] = [repeatedChild, repeatedChild]; void plainRepeated;\n// @ts-expect-error private semantic proof prevents structural fabrication\nconst fake: PageSchemaType = { $_tag: "_hson_root", $_content: [] }; void fake;\n// @ts-expect-error object spread does not preserve private semantic proof\nconst rebuilt: PageSchemaType = { ...value }; void rebuilt;\n`);
writeFileSync(localStatic, `import { Hson, type HsonSchema } from "hson-live";\nconst SchemaTest: HsonSchema = Hson\`<type "data" content <name "string" score "number">>\`;\nconst testData: SchemaTestHson = Hson\`<name "Ada" score 37>\`;\ndeclare const typed: SchemaTestType; const score: number = typed.score; void SchemaTest; void testData; void score;\n`);
writeFileSync(config, JSON.stringify({ compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", declaration: true, outDir: "./out", baseUrl: ".", paths: { "hson-live": [resolve("dist/index.d.ts")], "hson-live/hson": [resolve("dist/hson-authoring.d.ts")] } }, include: ["./*.ts"] }, null, 2));

const run = (mode: "generate" | "verify" | "check" | "build") => spawnSync(process.execPath, ["--import=tsx", "scripts/hson-schema.mts", mode, "--project", config], { cwd: root, encoding: "utf8" });

check("generation and extension-independent authoritative check pass", () => { assert.equal(run("generate").status, 0); const result = run("check"); assert.equal(result.status, 0, result.stdout + result.stderr); });
check("plain local static form gains real Type and Hson symbols without certification", () => {
  const source = readFileSync(localStatic, "utf8");
  assert.match(source, /import type \{ SchemaTestType, SchemaTestHson \} from/);
  assert.doesNotMatch(source, /Hson\.certify|\.validate/);
  assert.equal(run("check").status, 0);
});
check("downstream parsing and HsonSchema semantic diagnostics remain distinct", () => {
  const original = readFileSync(localStatic, "utf8");
  writeFileSync(localStatic, original.replace('<type "data" content <name "string" score "number">>', '<type "data" type "data" content "number">'));
  const malformed = run("generate");
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stdout + malformed.stderr, /duplicate Hson object member/);
  writeFileSync(localStatic, original.replace('<type "data" content <name "string" score "number">>', '<type "data" thing 1 content "number">'));
  const invalidSchema = run("generate");
  assert.notEqual(invalidSchema.status, 0);
  assert.match(invalidSchema.stdout + invalidSchema.stderr, /Data Hson Schema root must contain/);
  writeFileSync(localStatic, original);
  assert.equal(run("generate").status, 0);
});
check("official symbol resolution accepts renamed direct imports", () => assert.match(readFileSync(aliasSchema, "utf8"), /AliasSchemaType/));
check("declaration emit preserves module reexport and private proof carrier", () => {
  const result = run("build");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(readFileSync(join(project, "out/producer.d.ts"), "utf8"), /export type \{ UserSchemaType, UserSchemaHson \}/);
  const generated = readFileSync(join(project, "out/producer.UserSchema.hson-schema.generated.d.ts"), "utf8");
  assert.match(generated, /private readonly __hsonSchemaProof/); assert.match(generated, /export type UserSchemaType/); assert.match(generated, /export type UserSchemaHson/); assert.doesNotMatch(generated, /UserSchemaValue/);
  const recursiveGenerated = readFileSync(join(project, "out/producer.TreeSchema.hson-schema.generated.d.ts"), "utf8");
  assert.match(recursiveGenerated, /type __TreeSchemaDefinition0/); assert.match(recursiveGenerated, /ReadonlyArray<__TreeSchemaDefinition0>/); assert.match(recursiveGenerated, /private readonly __hsonSchemaProof/);
  const finiteGenerated = readFileSync(join(project, "out/producer.FiniteSchema.hson-schema.generated.d.ts"), "utf8");
  assert.match(finiteGenerated, /"lobby"[^;]+"ready"[^;]+"playing"[^;]+"finished"/);
  assert.match(finiteGenerated, /"player1"[^;]+"player2"[^;]+null/);
  assert.match(finiteGenerated, /U0ZeroProof/); assert.match(finiteGenerated, /U1ZeroProof/);
  const documentGenerated = readFileSync(join(project, "out/document-schema.PageSchema.hson-schema.generated.d.ts"), "utf8");
  assert.match(documentGenerated, /readonly \$_tag: "main"/); assert.match(documentGenerated, /readonly \$_tag: "section"/); assert.match(documentGenerated, /readonly hidden\?: "hidden"/);
  const repeatGenerated = readFileSync(join(project, "out/document-schema.RepeatSchema.hson-schema.generated.d.ts"), "utf8");
  assert.match(repeatGenerated, /readonly \$_tag: "item"/); assert.match(repeatGenerated, /readonly \[[^\]]+, [^\]]+\]/); assert.match(repeatGenerated, /private readonly __hsonSchemaProof/);
  const documentSequenceGenerated = readFileSync(join(project, "out/document-schema.DocumentSequenceSchema.hson-schema.generated.d.ts"), "utf8");
  assert.match(documentSequenceGenerated, /readonly \$_tag: "_hson_root"/); assert.match(documentSequenceGenerated, /readonly \$_tag: "item"/);
});
check("retired generated Value evidence fails freshness", () => {
  const artifact = join(project, "producer.UserSchema.hson-schema.generated.ts"), original = readFileSync(artifact, "utf8");
  writeFileSync(artifact, original.replace("UserSchemaType", "UserSchemaValue"));
  assert.notEqual(run("verify").status, 0);
  writeFileSync(artifact, original);
});
check("edited generated declaration fails closed", () => {
  const artifact = join(project, "producer.UserSchema.hson-schema.generated.ts"), original = readFileSync(artifact, "utf8");
  writeFileSync(artifact, `${original}\n// stale edit\n`); assert.notEqual(run("verify").status, 0); writeFileSync(artifact, original);
});
check("missing generated evidence fails closed", () => {
  const artifact = join(project, "producer.UserSchema.hson-schema.generated.json"), original = readFileSync(artifact, "utf8");
  unlinkSync(artifact); assert.notEqual(run("verify").status, 0); writeFileSync(artifact, original);
});
check("Schema edit without regeneration fails closed", () => {
  const original = readFileSync(producer, "utf8"); writeFileSync(producer, original.replace('age <number <int true min 0 under 130>>', 'age "string"'));
  assert.notEqual(run("verify").status, 0); writeFileSync(producer, original);
});
check("invalid static Hson fails with no extension", () => {
  const original = readFileSync(consumer, "utf8"); writeFileSync(consumer, original.replace("age 37", 'age "37"'));
  const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /does not satisfy UserSchema/); writeFileSync(consumer, original);
});
check("finite exact-domain static Hson rejects outside literals", () => {
  const original = readFileSync(consumer, "utf8");
  for (const changed of [
    original.replace('phase "playing"', 'phase "paused"'),
    original.replace('turn null', 'turn "player3"'),
  ]) {
    writeFileSync(consumer, changed);
    const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /does not satisfy FiniteSchema/);
  }
  writeFileSync(consumer, original);
});
check("nested recursive and referenced-refinement failures map through the static analyzer", () => {
  const original = readFileSync(consumer, "utf8");
  for (const candidate of [
    '<value "root" age 2 children [<value 1 age 0 children []>]>',
    '<value "root" age 2 children [<value "leaf" age -1 children []>]>',
    '<value "root" age 2 children [<value "leaf" age "0" children []>]>',
  ]) {
    writeFileSync(consumer, original.replace('<value "root" age 2 children [<value "leaf" age 0 children []>]>', candidate));
    const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /does not satisfy TreeSchema/);
  }
  writeFileSync(consumer, original);
});
check("stale and renamed local refs fail immediately", () => {
  const original = readFileSync(producer, "utf8");
  writeFileSync(producer, original.replace('children <array <ref "Tree">>', 'children <array <ref "Missing">>'));
  const stale = run("verify"); assert.notEqual(stale.status, 0); assert.match(stale.stdout + stale.stderr, /Unknown local Schema definition/);
  writeFileSync(producer, original.replace('Tree <content', 'Branch <content'));
  const renamed = run("verify"); assert.notEqual(renamed.status, 0); assert.match(renamed.stdout + renamed.stderr, /Unknown local Schema definition/);
  writeFileSync(producer, original);
});
check("source freshness detects a definition rename even when all refs preserve graph semantics", () => {
  const original = readFileSync(producer, "utf8");
  writeFileSync(producer, original.replace(' Tree <content', ' Branch <content').replaceAll('ref "Tree"', 'ref "Branch"'));
  const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /Stale or edited/);
  writeFileSync(producer, original);
});
check("definition bodies, ref targets, recursion topology, and root refs all participate in freshness", () => {
  const original = readFileSync(producer, "utf8");
  for (const changed of [
    original.replace('Age <number <int true min 0>>', 'Age <number <int true min 1>>'),
    original.replace('children <array <ref "Tree">>', 'children <array <ref "Leaf">>'),
    original.replace('content <ref "Tree">>\`;', 'content <ref "Leaf">>\`;'),
  ]) {
    writeFileSync(producer, changed);
    const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /Stale or edited/);
  }
  writeFileSync(producer, original);
});
check("every refinement family fails invalid static authored Hson without the extension", () => {
  const original = readFileSync(consumer, "utf8");
  const valid = '<name "Ada" age 37 code "ID-7" values [0, -0]>';
  for (const candidate of [
    '<name "Ada" age 37.5 code "ID-7" values [0, -0]>',
    '<name "Ada" age -1 code "ID-7" values [0, -0]>',
    '<name "Ada" age 130 code "ID-7" values [0, -0]>',
    '<name "Ada" age 37 code "XX-7" values [0, -0]>',
    '<name "Ada" age 37 code "ID-X" values [0, -0]>',
    '<name "Ada" age 37 code "ID77" values [0, -0]>',
    '<name "Ada" age 37 code "ID--7" values [0, -0]>',
    '<name "Ada" age 37 code "ID-7" values []>',
    '<name "Ada" age 37 code "ID-7" values [1, 1]>',
    '<name "Ada" age 37 code "ID-7" values [1, 2, 3]>',
  ]) {
    writeFileSync(consumer, original.replace(valid, candidate));
    const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /does not satisfy UserSchema/);
  }
  writeFileSync(consumer, original);
});
check("document static Hson rejects wrong tag, attrs, content order, and cardinality with no extension", () => {
  const original = readFileSync(documentConsumer, "utf8");
  for (const [from, to] of [
    ['<main id=hero <header/> <section "body"/>/>', '<aside id=hero <header/> <section "body"/>/>'],
    ['<main id=hero <header/> <section "body"/>/>', '<main <header/> <section "body"/>/>'],
    ['<main id=hero <header/> <section "body"/>/>', '<main id=hero extra=yes <header/> <section "body"/>/>'],
    ['<main id=hero <header/> <section "body"/>/>', '<main id=hero <header/> <aside "body"/>/>'],
    ['<main id=hero <header/> <section "body"/>/>', '<main id=hero <section "body"/> <header/>/>'],
    ['<main id=hero <header/> <section "body"/>/>', '<main id=hero <header/> <section/>/>'],
    ['<main id=hero <header/> <section "body"/>/>', '<main id=hero/>'],
    ['<main id=hero <header/> <section "body"/>/>', '<main id=hero <header/> <section "body"/> <section "extra"/>/>'],
  ] as const) {
    writeFileSync(documentConsumer, original.replace(from, to));
    const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /does not satisfy PageSchema/);
  }
  writeFileSync(documentConsumer, original);
});
check("static repeated Hson enforces exact count, child shape, and referenced refinements", () => {
  const original = readFileSync(documentConsumer, "utf8");
  const valid = '<list <item code=ok-one/> <item code=ok-two/>/>';
  for (const candidate of [
    '<list/>',
    '<list <item code=ok-one/>/>',
    '<list <item code=ok-one/> <item code=ok-two/> <item code=ok-three/>/>',
    '<list <item code=ok-one/> <wrong code=ok-two/>/>',
    '<list <item code=bad/> <item code=ok-two/>/>',
    '<list <item/> <item code=ok-two/>/>',
  ]) {
    writeFileSync(documentConsumer, original.replace(valid, candidate));
    const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /does not satisfy RepeatSchema/);
  }
  writeFileSync(documentConsumer, original);
});
check("static document sequence Hson enforces multi-root cardinality and item shape", () => {
  const original = readFileSync(documentConsumer, "utf8");
  const valid = '<item/><item/>';
  for (const candidate of ['<item/>', '<item/><item/><item/>', '<item/><wrong/>']) {
    writeFileSync(documentConsumer, original.replace(valid, candidate));
    const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /does not satisfy DocumentSequenceSchema/);
  }
  writeFileSync(documentConsumer, original);
});
check("repeat body, count, and repeated ref target participate in freshness", () => {
  const original = readFileSync(documentSchema, "utf8");
  for (const changed of [
    original.replace('count 2', 'count 3'),
    original.replace('tag "item"', 'tag "entry"'),
    original.replace('ref "Item"', 'ref "Renamed"'),
  ]) {
    writeFileSync(documentSchema, changed);
    const result = run("verify"); assert.notEqual(result.status, 0);
  }
  writeFileSync(documentSchema, original);
});
check("document optional attr omission and default-open attrs pass authoritatively", () => {
  const originalSchema = readFileSync(documentSchema, "utf8"), originalConsumer = readFileSync(documentConsumer, "utf8");
  writeFileSync(documentSchema, originalSchema.replace(" closed true", ""));
  writeFileSync(documentConsumer, originalConsumer.replace("id=hero", "id=hero data-extra=yes"));
  assert.equal(run("generate").status, 0); const result = run("check"); assert.equal(result.status, 0, result.stdout + result.stderr);
  writeFileSync(documentSchema, originalSchema); writeFileSync(documentConsumer, originalConsumer); assert.equal(run("generate").status, 0);
});
check("retired attrs exact closure spelling fails closed", () => {
  const original = readFileSync(documentSchema, "utf8");
  writeFileSync(documentSchema, original.replace(" closed true", " exact true"));
  assert.notEqual(run("verify").status, 0);
  writeFileSync(documentSchema, original);
});
check("static interpolation fails closed", () => {
  const original = readFileSync(consumer, "utf8"); writeFileSync(consumer, original.replace('Hson`<name "Ada" age 37 code "ID-7" values [0, -0]>`', 'Hson`<name "Ada" age ${37} code "ID-7" values [0, -0]>`'));
  const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /substitution-free/); writeFileSync(consumer, original);
});
check("wrong Schema-bound validation association fails closed", () => {
  const original = readFileSync(consumer, "utf8");
  writeFileSync(consumer, `${original}\nimport { UserSchema } from "./producer.js"; import type { AliasSchemaHson } from "./alias-schema.js";\nconst wrong: AliasSchemaHson = Hson.certify(UserSchema, Hson\`<name "Ada" age 37 code "ID-7" values [1]>\`); void wrong;\n`);
  const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /association must use AliasSchema/); writeFileSync(consumer, original);
});
check("deletion and rename remove stale artifacts and managed bindings", () => {
  const original = readFileSync(localStatic, "utf8");
  const oldArtifact = join(project, "local-static.SchemaTest.hson-schema.generated.ts");
  writeFileSync(localStatic, 'import { Hson, type HsonSchema } from "hson-live"; void Hson; type Keep = HsonSchema; void (0 as unknown as Keep);\n');
  assert.notEqual(run("verify").status, 0);
  assert.equal(run("generate").status, 0);
  assert.equal(readFileSync(localStatic, "utf8").includes("@hson-schema"), false);
  assert.equal(existsSync(oldArtifact), false);
  writeFileSync(localStatic, original.replaceAll("SchemaTest", "RenamedSchema"));
  assert.equal(run("generate").status, 0);
  assert.equal(existsSync(oldArtifact), false);
  assert.equal(existsSync(join(project, "local-static.RenamedSchema.hson-schema.generated.ts")), true);
  writeFileSync(localStatic, original);
  assert.equal(run("generate").status, 0);
});
check("physical producer deletion, file rename, exclusion, and restoration reconcile only owned evidence", () => {
  const lifecycle = join(project, "lifecycle.ts"), renamedLifecycle = join(project, "lifecycle-renamed.ts");
  const authored = 'import { Hson, type HsonSchema } from "hson-live";\nexport const LifecycleSchema: HsonSchema = Hson`<type "data" content <ok "boolean">>`;\n';
  const artifact = join(project, "lifecycle.LifecycleSchema.hson-schema.generated.ts");
  const metadata = join(project, "lifecycle.LifecycleSchema.hson-schema.generated.json");
  writeFileSync(lifecycle, authored); assert.equal(run("generate").status, 0); assert.ok(existsSync(artifact) && existsSync(metadata));
  unlinkSync(lifecycle); assert.equal(run("generate").status, 0); assert.equal(existsSync(artifact), false); assert.equal(existsSync(metadata), false);
  writeFileSync(lifecycle, authored); assert.equal(run("generate").status, 0); assert.ok(existsSync(artifact));
  renameSync(lifecycle, renamedLifecycle); assert.equal(run("generate").status, 0);
  const renamedArtifact = join(project, "lifecycle-renamed.LifecycleSchema.hson-schema.generated.ts");
  assert.equal(existsSync(artifact), false); assert.ok(existsSync(renamedArtifact));
  const originalConfig = readFileSync(config, "utf8");
  writeFileSync(config, JSON.stringify({ ...JSON.parse(originalConfig), exclude: ["./lifecycle-renamed.ts"] }, null, 2));
  assert.equal(run("generate").status, 0); assert.equal(existsSync(renamedArtifact), false);
  writeFileSync(config, originalConfig); assert.equal(run("generate").status, 0); assert.ok(existsSync(renamedArtifact));
  unlinkSync(renamedLifecycle); assert.equal(run("generate").status, 0);
});

testEvents.terminal("pass");
