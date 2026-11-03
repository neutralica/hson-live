import assert from "node:assert/strict";
import ts from "typescript";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { collect_part_source_facts } from "../../src/internal/hson-schema/part-source.ts";
import { part_data_contexts, part_data_hover } from "../../src/internal/editor-introspection/part-data-evidence.ts";
import { query_hson_editor_context } from "../../src/internal/editor-introspection/query.ts";
import { part_definition_targets } from "../../src/internal/editor-introspection/part-definition-target.ts";
import { static_part_reference_diagnostics } from "../../src/internal/hson-schema/candidate-diagnostics.ts";

/** Current-syntax A → B fixture shared by source facts, editor and diagnostic tests. */
export const forwarding_shape = '<title "string" note <optional "number"> kind <exact "heading"> nested <content <title "number" kind <exact "quote">>>>';
export const forwarding_value = '<title "root" kind "heading" nested <title 7 kind "quote">>';
export function forwarding_fixture({ shape = forwarding_shape, value = forwarding_value, forward = '^{outer}',
  body = '<p hson:part data:record="%{payload}" "^{record.title}"/>',
  intermediate = '<section hson:part data:outer="%{incoming}" <hson-part at="B" payload:data="' + forward + '"/>/>'
}: { shape?: string; value?: string; forward?: string; body?: string; intermediate?: string } = {}): string {
  return 'import {Hson,hsonLiveMap as maps,type HsonData} from "hson-live";\ndeclare const dynamic:any;\n'
    + 'const S=Hson.schema`<type "data" content ' + shape + '>`;\nconst input:HsonData<typeof S>=Hson.data`' + value + '`;\n'
    + 'const A=Hson.document`' + intermediate + '`;\nconst B=Hson.document`' + body + '`;\n'
    + 'const page=Hson.document`<hson-part at="components/A" incoming:data="${input}"/>`;\n'
    + 'const map=maps.fromLibraries({components:{parts:{A:{kind:"document",document:A},B:{kind:"document",document:B}}},page:{document:page}});';
}

/** Shared analysis assertions execute unchanged in Node and Worker. */
export function run_forwarding_editor_cases(): void {
  const directory = mkdtempSync(join(tmpdir(), 'part-forwarding-parity-')), file = join(directory, 'index.ts');
  const markedBody = '<section hson:part data:record="%{payload}" <b "^{record.ti|tle}"/> <hson-part at="^{record.kind}"/>/>';
  const body = markedBody.replace('|', '');
  const source = forwarding_fixture({ forward: '^{outer.nested}', body })
    .replace('const page=', 'const T=Hson.schema`<type "data" content <nested <content <title "boolean" kind <exact "heading">>>>>`;const other:HsonData<typeof T>=Hson.data`<nested <title true kind "heading">>`;const page=')
    .replace('<hson-part at="components/A" incoming:data="${input}"/>', '<main <hson-part at="components/A" incoming:data="${input}"/> <hson-part at="components/A" incoming:data="${other}"/>/>')
    .replace('B:{kind:"document",document:B}', 'B:{kind:"document",document:B},quote:{kind:"document",document:"<p hson:part/>"},heading:{kind:"document",document:"<h1 hson:part/>"}');
  try {
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}'); writeFileSync(file, source);
    const program = ts.createProgram([file], { strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, baseUrl: resolve(import.meta.dirname, '../..'), paths: { 'hson-live': ['src/index.ts'] } });
    assert.deepEqual(program.getSyntacticDiagnostics(), []);
    const facts = collect_part_source_facts(ts, program), offset = source.indexOf(body) + markedBody.indexOf('|');
    const child = facts.documents.find(document => ts.isVariableDeclaration(document.producer.parent) && document.producer.parent.name.getText() === 'B')!;
    const contexts = part_data_contexts(facts, child, 'payload');
    assert.equal(contexts.length, 2); assert.notEqual(contexts[0]!.root, contexts[1]!.root);
    assert.ok(contexts.every(context => context.parent !== undefined && context.evidence?.strength === 'validated' && !context.executionCertain));
    assert.deepEqual(contexts.map(context => context.path), [['nested'], ['nested']]);
    const completion = query_hson_editor_context({ mode: 'document', source: body, cursor: markedBody.indexOf('|'), parts: { facts, file, offset } });
    const title = completion.candidates.find(candidate => candidate.label === 'record.title')!;
    assert.ok(title); assert.match(title.detail, /number \(required\); validated/); assert.match(title.detail, /boolean \(required\); validated/);
    const hover = part_data_hover(facts, file, offset)!.text;
    assert.match(hover, /2 recognized invocation contexts/); assert.match(hover, /forwarded via/); assert.match(hover, /number/); assert.match(hover, /boolean/);
    const selection = source.indexOf('record.kind') + 'record.kind'.length - 1;
    assert.deepEqual(part_definition_targets(facts, file, selection).map(target => target.name), ['quote', 'heading']);
    assert.deepEqual(static_part_reference_diagnostics(facts), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
