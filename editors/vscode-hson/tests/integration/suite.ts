import assert from "node:assert/strict";
import { join } from "node:path";

import * as vscode from "vscode";
const completionCommandTimes: number[] = [];

async function schemaCompletions(document: vscode.TextDocument, offset: number): Promise<vscode.CompletionItem[]> {
  const started = performance.now();
  const result = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(offset));
  const items = result?.items.filter(item => item.detail?.startsWith('HSON Schema:')) ?? [];
  if (items.length) completionCommandTimes.push(performance.now()-started);
  return items;
}

async function diagnosticsFor(
  uri: vscode.Uri,
  count: number,
): Promise<readonly vscode.Diagnostic[]> {
  const timeout = Date.now() + 5_000;
  while (Date.now() < timeout) {
    const diagnostics = vscode.languages.getDiagnostics(uri)
      .filter((diagnostic) => diagnostic.source === "HSON");
    if (diagnostics.length === count) return diagnostics;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return vscode.languages.getDiagnostics(uri)
    .filter((diagnostic) => diagnostic.source === "HSON");
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("terminal-gothic.hson-language");
  assert.ok(extension, "HSON extension was not discovered by the extension host");
  await extension.activate();

  if (process.env.HSON_D4_RESTRICTED === "1") {
    assert.equal(vscode.workspace.isTrusted, false, "restricted integration workspace must remain untrusted");
    const workspace = process.env.HSON_D2_TEST_WORKSPACE;
    assert.ok(workspace);
    const source = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "static-syntax.ts")));
    await vscode.window.showTextDocument(source);
    const diagnostics = await diagnosticsFor(source.uri, 1);
    assert.equal(source.getText(diagnostics[0]?.range), "\\x2b");
    process.stdout.write("ok - real VS Code D4 Restricted Mode: secure static fromHson syntax diagnostics remain active without trust\n");
    const marker = vscode.Uri.file(join(workspace,"provider-count.txt"));
    const before = Buffer.from(await vscode.workspace.fs.readFile(marker)).toString();
    const interpolated = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace,"interpolated.ts")));
    await vscode.window.showTextDocument(interpolated);
    await new Promise(resolve=>setTimeout(resolve,700));
    assert.equal(vscode.languages.getDiagnostics(interpolated.uri).filter(d=>d.source?.startsWith("HSON")).length,0);
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(marker)).toString(),before);
    const completion = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, 'completion-user.ts')));
    assert.deepEqual(await schemaCompletions(completion, completion.getText().indexOf('< >')+2), []);
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(marker)).toString(),before);
    process.stdout.write('ok - real VS Code D6 Restricted Mode: no Schema completion and no provider execution\n');
    process.stdout.write("ok - real VS Code D5 Restricted Mode executes no provider and makes no runtime validity claim\n");
    return;
  }

  const standalone = await vscode.workspace.openTextDocument({ language: "hson", content: "+1" });
  await vscode.window.showTextDocument(standalone);
  const standaloneDiagnostics = await diagnosticsFor(standalone.uri, 1);
  assert.equal(standaloneDiagnostics.length, 1);
  assert.equal(standaloneDiagnostics[0]?.source, "HSON");
  assert.equal(standaloneDiagnostics[0]?.range.start.character, 0);

  const fixturePath = join(__dirname, "..", "tests", "fixtures", "diagnostics-alias.ts");
  const alias = await vscode.workspace.openTextDocument(vscode.Uri.file(fixturePath));
  await vscode.window.showTextDocument(alias);
  const aliasDiagnostics = await diagnosticsFor(alias.uri, 1);
  assert.equal(aliasDiagnostics.length, 1);
  assert.equal(alias.getText(aliasDiagnostics[0]?.range), "+");

  const smokePath = join(__dirname, "..", "tests", "fixtures", "diagnostics-smoke.ts");
  const smoke = await vscode.workspace.openTextDocument(vscode.Uri.file(smokePath));
  assert.equal(smoke.languageId, "typescript");
  assert.equal(smoke.uri.scheme, "file");
  assert.equal(smoke.fileName, smokePath);
  await vscode.window.showTextDocument(smoke);
  const smokeDiagnostics = await diagnosticsFor(smoke.uri, 1);
  assert.equal(smokeDiagnostics.length, 1);
  assert.ok(smokeDiagnostics[0]
    && smokeDiagnostics[0].range.start.line >= 8
    && smokeDiagnostics[0].range.end.line <= 10);

  const workspace = process.env.HSON_D2_TEST_WORKSPACE;
  const hsonModule = process.env.HSON_D2_TEST_HSON;
  assert.ok(workspace && hsonModule);
  const user = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "user.ts")));
  await vscode.window.showTextDocument(user);
  const schemaDiagnostics = () => vscode.languages.getDiagnostics(user.uri).filter(d => d.source === "HSON Schema");
  assert.equal(schemaDiagnostics().length, 0, "trusted diagnostics default off");
  assert.equal(vscode.workspace.isTrusted, true);
  const config = vscode.workspace.getConfiguration("hson.trustedSchemaDiagnostics", user.uri);
  await config.update("module", "trusted-schema.mjs", vscode.ConfigurationTarget.Workspace);
  await config.update("hsonModule", hsonModule, vscode.ConfigurationTarget.Workspace);
  await config.update("enabled", true, vscode.ConfigurationTarget.Workspace);
  const waitSchema = async (count: number): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (schemaDiagnostics().length !== count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(schemaDiagnostics().length, count, "D2 Schema diagnostic count");
  };
  await waitSchema(1);
  const diagnostic = schemaDiagnostics()[0]!;
  assert.equal(user.getText(diagnostic.range), '"37"');
  assert.match(diagnostic.message, /Expected `age` to be a number, but this value is an HSON string/);
  assert.match(user.getText(diagnostic.relatedInformation?.[0]?.location.range), /validate/);
  const edits = new vscode.WorkspaceEdit(); edits.replace(user.uri, diagnostic.range, "37");
  await vscode.workspace.applyEdit(edits);
  assert.equal(user.isDirty, true, "candidate remains unsaved");
  await waitSchema(0);
  // Restore invalid candidate, prove revalidation, then disable and clear.
  const index = user.getText().indexOf("age 37") + 4;
  const restore = new vscode.WorkspaceEdit(); restore.replace(user.uri, new vscode.Range(user.positionAt(index), user.positionAt(index + 2)), '"37"');
  await vscode.workspace.applyEdit(restore);
  await waitSchema(1);
  await config.update("enabled", false, vscode.ConfigurationTarget.Workspace);
  await waitSchema(0);
  process.stdout.write("ok - real VS Code D2: default off, enabled exact diagnostic, unsaved correction, revalidation, disable clearing\n");
  const mapUser = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "map-user.ts")));
  await vscode.window.showTextDocument(mapUser);
  const mapDiagnostics = () => vscode.languages.getDiagnostics(mapUser.uri).filter(d => d.source === "HSON Schema");
  const waitMap = async (count: number): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (mapDiagnostics().length !== count && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(mapDiagnostics().length, count, "D3 Schema diagnostic count");
  };
  assert.equal(mapDiagnostics().length, 0);
  await config.update("enabled", true, vscode.ConfigurationTarget.Workspace);
  await waitMap(1);
  assert.doesNotMatch(mapUser.getText(), /schema\.validate/);
  const mapDiagnostic = mapDiagnostics()[0]!;
  assert.equal(mapUser.getText(mapDiagnostic.range), '"37"');
  assert.match(mapUser.getText(mapDiagnostic.relatedInformation?.[0]?.location.range), /map.schema.use/);
  const correction = new vscode.WorkspaceEdit(); correction.replace(mapUser.uri, mapDiagnostic.range, "37");
  await vscode.workspace.applyEdit(correction);
  await waitMap(0);
  const original = mapUser.getText();
  const bad = new vscode.WorkspaceEdit(); bad.replace(mapUser.uri, new vscode.Range(mapUser.positionAt(0), mapUser.positionAt(original.length)), original.replace('age 37', 'age "37"'));
  await vscode.workspace.applyEdit(bad);
  await waitMap(1);
  await config.update("enabled", false, vscode.ConfigurationTarget.Workspace);
  await waitMap(0);
  process.stdout.write("ok - real VS Code D3: dedicated facade, rejected attachment exact diagnostic, related use site, unsaved correction, revalidation, disable clearing\n");

  const staticSyntax = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "static-syntax.ts")));
  await vscode.window.showTextDocument(staticSyntax);
  const staticSyntaxDiagnostics = await diagnosticsFor(staticSyntax.uri, 1);
  assert.equal(staticSyntax.getText(staticSyntaxDiagnostics[0]?.range), "\\x2b");
  const syntaxBodyStart = staticSyntax.getText().indexOf("\\x2b1");
  const syntaxFix = new vscode.WorkspaceEdit(); syntaxFix.replace(staticSyntax.uri,
    new vscode.Range(staticSyntax.positionAt(syntaxBodyStart), staticSyntax.positionAt(syntaxBodyStart + "\\x2b1".length)), "<a/>");
  await vscode.workspace.applyEdit(syntaxFix);
  assert.equal((await diagnosticsFor(staticSyntax.uri, 0)).length, 0);
  process.stdout.write("ok - real VS Code D4 secure syntax: escaped Transform literal exact range and unsaved correction clearing\n");

  const staticMap = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "static-map-user.ts")));
  await vscode.window.showTextDocument(staticMap);
  const staticSchemaDiagnostics = () => vscode.languages.getDiagnostics(staticMap.uri).filter(d => d.source === "HSON Schema");
  await config.update("enabled", true, vscode.ConfigurationTarget.Workspace);
  const staticDeadline = Date.now() + 10_000;
  while (staticSchemaDiagnostics().length !== 1 && Date.now() < staticDeadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(staticSchemaDiagnostics().length, 1);
  assert.equal(staticMap.getText(staticSchemaDiagnostics()[0]!.range), "\\x2237\\x22");
  const staticMutated = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, "static-mutated.ts")));
  await vscode.window.showTextDocument(staticMutated);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(vscode.languages.getDiagnostics(staticMutated.uri).filter(d => d.source === "HSON Schema").length, 0);
  await config.update("enabled", false, vscode.ConfigurationTarget.Workspace);
  process.stdout.write("ok - real VS Code D4 trusted Schema: static escaped literal exact diagnostic and mutation suppression\n");

  const d5 = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace,"interpolated.ts")));
  await vscode.window.showTextDocument(d5);
  const runtimeDiagnostics=(doc:vscode.TextDocument)=>vscode.languages.getDiagnostics(doc.uri).filter(d=>d.source==='HSON Schema'||d.source==='HSON');
  const waitRuntime=async(doc:vscode.TextDocument,count:number)=>{
    const deadline=Date.now()+15_000;
    while(runtimeDiagnostics(doc).length!==count && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(runtimeDiagnostics(doc).length,count,`D5 ${doc.fileName}`);
    return runtimeDiagnostics(doc);
  };
  const marker = vscode.Uri.file(join(workspace,'provider-count.txt'));
  const before=Buffer.from(await vscode.workspace.fs.readFile(marker)).toString();
  await new Promise(resolve=>setTimeout(resolve,400));
  assert.equal(runtimeDiagnostics(d5).length,0);
  assert.equal(Buffer.from(await vscode.workspace.fs.readFile(marker)).toString(),before,'explicit-disable executes nothing');
  await config.update('enabled',true,vscode.ConfigurationTarget.Workspace);
  const first=(await waitRuntime(d5,1))[0]!;
  assert.equal(d5.getText(first.range),'age');
  assert.match(first.message,/expression evaluated to an HSON string/);
  const exprEdit=new vscode.WorkspaceEdit(); exprEdit.replace(d5.uri,first.range,'getAge()');
  await vscode.workspace.applyEdit(exprEdit);
  assert.equal(runtimeDiagnostics(d5).length,0,'expression edit synchronously retires runtime diagnostics');
  await new Promise(resolve=>setTimeout(resolve,700));
  assert.equal(runtimeDiagnostics(d5).length,0,'unsaved edited expression cannot reuse previous values');
  await d5.save();
  await config.update('enabled',false,vscode.ConfigurationTarget.Workspace);
  await config.update('enabled',true,vscode.ConfigurationTarget.Workspace);
  assert.equal(d5.getText((await waitRuntime(d5,1))[0]!.range),'getAge()');
  await config.update('enabled',false,vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(join(workspace,'runtime-age.json')),Buffer.from('37'));
  await config.update('enabled',true,vscode.ConfigurationTarget.Workspace);
  await waitRuntime(d5,0);
  await new Promise(resolve=>setTimeout(resolve,1000));
  assert.equal(runtimeDiagnostics(d5).length,0,'fresh runtime number clears mismatch');
  const journal=Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(join(workspace,'evaluated-values.jsonl')))).toString().trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(journal.includes('37') && journal.at(-1)===37,'provider actually evaluated old string and fresh number');
  await config.update('enabled',false,vscode.ConfigurationTarget.Workspace);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(join(workspace,'runtime-age.json')),Buffer.from('"37"'));
  await config.update('enabled',true,vscode.ConfigurationTarget.Workspace);
  assert.equal(d5.getText((await waitRuntime(d5,1))[0]!.range),'getAge()','fresh invalid value restores expression diagnostic');
  for(const [name,origin] of [['interpolated-map.ts','age'],['interpolated-literal-error.ts','+'],['interpolated-value-error.ts','value']] as const){
    const doc: vscode.TextDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace,name)));
    await vscode.window.showTextDocument(doc);
    const diagnostic=(await waitRuntime(doc,1))[0]!;
    assert.equal(doc.getText(diagnostic.range),origin);
  }
  const repeated=await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace,'interpolated-repeated.ts')));
  await vscode.window.showTextDocument(repeated);
  await new Promise(resolve=>setTimeout(resolve,700));
  assert.equal(runtimeDiagnostics(repeated).length,0,'repeated equal evaluations fail closed');
  await config.update('enabled',false,vscode.ConfigurationTarget.Workspace);
  process.stdout.write('ok - real VS Code D5: actual interpolation, expression mismatch, edit retirement, fresh runtime value, trust off, literal/admission errors, D3 flow, repeated ambiguity\n');

  const completion = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace, 'completion-user.ts')));
  await vscode.window.showTextDocument(completion);
  assert.deepEqual(await schemaCompletions(completion, completion.getText().indexOf('< >')+2), []);
  await config.update('enabled', true, vscode.ConfigurationTarget.Workspace);
  const waitCompletion = async (doc: vscode.TextDocument, offset: number, label: string) => {
    const deadline = Date.now()+10_000;
    let items: vscode.CompletionItem[] = [];
    while (Date.now()<deadline) { items = await schemaCompletions(doc,offset); if(items.some(i=>i.label===label)) return items; await new Promise(resolve=>setTimeout(resolve,50)); }
    assert.fail(`Missing D6 ${label}: ${JSON.stringify(items)}`);
  };
  let entries = await waitCompletion(completion, completion.getText().indexOf('< >')+2, 'name');
  const name = entries.find(i=>i.label==='name')!;
  assert.ok(name.insertText instanceof vscode.SnippetString);
  assert.equal(name.insertText.value, 'name ${1}');
  assert.ok(name.sortText! < entries.find(i=>i.label==='enabled')!.sortText!);
  const editBody = async (doc: vscode.TextDocument, marked: string) => {
    const text = doc.getText(), start = text.indexOf('HSON`')+5, end = text.indexOf('`',start);
    const edit = new vscode.WorkspaceEdit(); edit.replace(doc.uri,new vscode.Range(doc.positionAt(start),doc.positionAt(end)),marked.replace('|',''));
    await vscode.workspace.applyEdit(edit);
    return start+marked.indexOf('|');
  };
  let cursor = await editBody(completion, '<role |>');
  entries = await waitCompletion(completion,cursor,'"user"');
  assert.deepEqual(entries.map(i=>i.label).sort(), ['"admin"','"user"']);
  cursor = await editBody(completion, '<name "Ada" |>');
  entries = await waitCompletion(completion,cursor,'role');
  assert.ok(!entries.some(i=>i.label==='name'));
  cursor = await editBody(completion, '<name ${val|ue} role "user">');
  assert.deepEqual(await schemaCompletions(completion,cursor), []);
  const elementCompletion = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace,'completion-element.ts')));
  await vscode.window.showTextDocument(elementCompletion);
  entries = await waitCompletion(elementCompletion,elementCompletion.getText().indexOf(' />')+1,'hidden');
  assert.equal(entries.find(i=>i.label==='hidden')?.insertText, 'hidden');
  assert.ok(entries.some(i=>i.label==='id'));
  cursor = await editBody(elementCompletion,'<div < |/>/>');
  entries = await waitCompletion(elementCompletion,cursor,'button');
  assert.equal(entries.find(i=>i.label==='button')?.insertText,'button');
  const natural = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace,'map-user.ts')));
  cursor = await editBody(natural,'<user < |>>');
  entries = await waitCompletion(natural,cursor,'age');
  assert.ok(!natural.getText().includes('HSON.validate'));
  assert.ok(entries.some(i=>i.label==='age'));
  const slow = await vscode.workspace.openTextDocument(vscode.Uri.file(join(workspace,'completion-slow.ts')));
  const pending = schemaCompletions(slow,slow.getText().indexOf('< >')+2);
  const entered = vscode.Uri.file(join(workspace,'completion-entered.txt'));
  const deadline = Date.now()+3000;
  let observed = false;
  while (Date.now()<deadline) { try { await vscode.workspace.fs.stat(entered); observed=true; break; } catch { await new Promise(resolve=>setTimeout(resolve,10)); } }
  assert.ok(observed,'actual trusted recurse entered before generation retirement');
  await config.update('enabled',false,vscode.ConfigurationTarget.Workspace);
  assert.deepEqual(await pending, [], 'retired generation never publishes delayed completion');
  assert.deepEqual(await schemaCompletions(elementCompletion,cursor), []);
  process.stdout.write('ok - real VS Code D6: manual member/snippet/order, finite literals, attrs/flags, child tags, incomplete edit, source filtering update, expression exclusion, disablement, delayed-generation retirement, natural D3 completion\n');
  completionCommandTimes.sort((a,b)=>a-b);
  process.stdout.write('# D6 real VS Code completion command ms '+JSON.stringify({samples:completionCommandTimes.length,p50:completionCommandTimes[Math.floor(completionCommandTimes.length/2)],max:completionCommandTimes.at(-1)})+'\n');

}
