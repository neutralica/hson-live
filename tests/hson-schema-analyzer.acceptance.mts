import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { emit_hson_live_test_completion } from "./launcher-completion.mjs";

let checks = 0;
const check = (name: string, run: () => void): void => { run(); console.log(`ok ${++checks} - ${name}`); };
const root = resolve(".");
const project = mkdtempSync(join(tmpdir(), "hson-schema-analyzer-"));
const producer = join(project, "producer.ts");
const consumer = join(project, "consumer.ts");
const aliasSchema = join(project, "alias-schema.ts");
const documentSchema = join(project, "document-schema.ts");
const documentConsumer = join(project, "document-consumer.ts");
const config = join(project, "tsconfig.json");

writeFileSync(producer, `import { Hson, type HsonSchema } from "hson-live";\nexport const UserSchema: HsonSchema = Hson\`<type "data" content <name "string" age "number">>\`;\nthrow new Error("the analyzer must never execute this module");\n`);
writeFileSync(consumer, `import { Hson } from "hson-live"; import { type UserSchemaHson } from "./producer.js";\nconst user: UserSchemaHson = Hson\`<name "Ada" age 37>\`; void user;\n`);
writeFileSync(aliasSchema, `import { Hson as Author, type HsonSchema as Schema } from "hson-live";\nexport const AliasSchema: Schema = Author\`<type "data" content <ok "boolean">>\`;\n`);
writeFileSync(documentSchema, `import { Hson, type HsonSchema } from "hson-live";\nexport const PageSchema: HsonSchema = Hson\`<type "document" tag "main" attrs <props <id "string" hidden <optional "flag">> exact true> content <sequence [<tag "header" content "empty">, <tag "section" content "string">]>>\`;\n`);
writeFileSync(documentConsumer, `import { Hson } from "hson-live"; import type { PageSchemaHson, PageSchemaValue } from "./document-schema.js";\nconst page: PageSchemaHson = Hson\`<main id=hero <header/> <section "body"/>/>\`; void page;\ndeclare const value: PageSchemaValue; const rootTag: "main" = value.$_tag; const child = value.$_content[0].$_content[1]; const childTag: "section" = child.$_tag; void rootTag; void childTag;\n// @ts-expect-error private semantic proof prevents structural fabrication\nconst fake: PageSchemaValue = { $_tag: "main", $_attrs: { id: "hero" }, $_content: [] }; void fake;\n// @ts-expect-error object spread does not preserve private semantic proof\nconst rebuilt: PageSchemaValue = { ...value }; void rebuilt;\n`);
writeFileSync(config, JSON.stringify({ compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", declaration: true, outDir: "./out", baseUrl: ".", paths: { "hson-live": [resolve("dist/index.d.ts")], "hson-live/hson": [resolve("dist/hson-authoring.d.ts")] } }, include: ["./*.ts"] }, null, 2));

const run = (mode: "generate" | "verify" | "check" | "build") => spawnSync(process.execPath, ["--loader", "ts-node/esm", "scripts/hson-schema.mts", mode, "--project", config], { cwd: root, encoding: "utf8", env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "true" } });

check("generation and extension-independent authoritative check pass", () => { assert.equal(run("generate").status, 0); const result = run("check"); assert.equal(result.status, 0, result.stdout + result.stderr); });
check("official symbol resolution accepts renamed direct imports", () => assert.match(readFileSync(aliasSchema, "utf8"), /AliasSchemaValue/));
check("declaration emit preserves module reexport and private proof carrier", () => {
  const result = run("build");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(readFileSync(join(project, "out/producer.d.ts"), "utf8"), /export type \{ UserSchemaValue, UserSchemaHson \}/);
  const generated = readFileSync(join(project, "out/producer.UserSchema.hson-schema.generated.d.ts"), "utf8");
  assert.match(generated, /private readonly __hsonSchemaProof/); assert.match(generated, /export type UserSchemaHson/);
  const documentGenerated = readFileSync(join(project, "out/document-schema.PageSchema.hson-schema.generated.d.ts"), "utf8");
  assert.match(documentGenerated, /readonly \$_tag: "main"/); assert.match(documentGenerated, /readonly \$_tag: "section"/); assert.match(documentGenerated, /readonly hidden\?: "hidden"/);
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
  const original = readFileSync(producer, "utf8"); writeFileSync(producer, original.replace('age "number"', 'age "string"'));
  assert.notEqual(run("verify").status, 0); writeFileSync(producer, original);
});
check("invalid static Hson fails with no extension", () => {
  const original = readFileSync(consumer, "utf8"); writeFileSync(consumer, original.replace("age 37", 'age "37"'));
  const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /does not satisfy UserSchema/); writeFileSync(consumer, original);
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
check("document optional attr omission and default-open attrs pass authoritatively", () => {
  const originalSchema = readFileSync(documentSchema, "utf8"), originalConsumer = readFileSync(documentConsumer, "utf8");
  writeFileSync(documentSchema, originalSchema.replace(" exact true", ""));
  writeFileSync(documentConsumer, originalConsumer.replace("id=hero", "id=hero data-extra=yes"));
  assert.equal(run("generate").status, 0); const result = run("check"); assert.equal(result.status, 0, result.stdout + result.stderr);
  writeFileSync(documentSchema, originalSchema); writeFileSync(documentConsumer, originalConsumer); assert.equal(run("generate").status, 0);
});
check("static interpolation fails closed", () => {
  const original = readFileSync(consumer, "utf8"); writeFileSync(consumer, original.replace('Hson`<name "Ada" age 37>`', 'Hson`<name "Ada" age ${37}>`'));
  const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /substitution-free/); writeFileSync(consumer, original);
});
check("wrong Schema-bound validation association fails closed", () => {
  const original = readFileSync(consumer, "utf8");
  writeFileSync(consumer, `${original}\nimport { UserSchema } from "./producer.js"; import type { AliasSchemaHson } from "./alias-schema.js";\nconst wrong: AliasSchemaHson = Hson.validate(UserSchema, Hson\`<name "Ada" age 37>\`); void wrong;\n`);
  const result = run("verify"); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /association must use AliasSchema/); writeFileSync(consumer, original);
});

emit_hson_live_test_completion("hson-schema-analyzer", checks, checks, 0);
