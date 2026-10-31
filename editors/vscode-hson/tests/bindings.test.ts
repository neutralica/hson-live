import assert from "node:assert/strict";
import { resolve } from "node:path";
import { HsonBindingCache, binding_definition_at, binding_highlights, overlay_binding_highlights } from "../src/binding-intelligence.js";
import { hson_highlights, load_hson_grammar } from "../src/highlighting.js";
import { hsonTokenDefinitions } from "../src/appearance-internals.js";

import { canonical } from "./fixtures/bindings.js";
export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "editor.part-bindings", title: "Shared Part binding intelligence", category: "Tooling", runtime: "node", tags: Object.freeze(["parts", "editor", "navigation", "highlighting", "provenance"]) });

async function run() {
const cache = new HsonBindingCache();
let checks = 0;
function check(name: string, run: () => void) { run(); console.log(`ok ${++checks} - ${name}`); }
function snapshot(text: string, languageId = "hson", version = 1, uri = "untitled:binding-fixture") {
  const ext = languageId === "typescript" ? "ts" : languageId === "typescriptreact" ? "tsx" : languageId === "markdown" ? "md" : "hson";
  return cache.get({ uri, fileName: `/workspace/binding.${ext}`, languageId, version, text });
}
const wrap = (body: string) => 'import { Hson } from "hson-live/hson";\nconst doc = Hson.document`' + body + '`;';
const grammar = await load_hson_grammar(resolve(__dirname, ".."));
for (const language of ["hson", "markdown", "typescript", "typescriptreact"]) {
  const text = language === "hson" ? canonical : language === "markdown" ? '# Heading\n```hson\n' + canonical + '\n```\nOrdinary Markdown ^{blocks}' : wrap(canonical);
  const result = snapshot(text, language);
  check(`${language}: complete canonical references, origins, source URI and root ranges`, () => {
    assert.equal(result.sources.length, 1);
    const { declarations, references } = result.sources[0]!;
    assert.deepEqual(declarations.map(d => [d.name, d.origin]), [["blocks", "receiving"], ["each", "iteration-value"]]);
    assert.deepEqual(references.map(r => [r.reference.name, r.resolution]), [["someBlocks", "unavailable"], ["blocks", "resolved"], ["each", "resolved"], ["each", "resolved"]]);
    for (const ref of references) {
      assert.equal(text.slice(ref.root.start, ref.root.end), ref.reference.name);
      assert.equal(text.slice(ref.location.start, ref.location.end), (ref.reference.namespace === "local" ? "^" : "%") + '{' + ref.reference.reference + '}');
      const definition = binding_definition_at(result, ref.root.start);
      if (ref.reference.namespace === "incoming") { assert.equal(definition, undefined); continue; }
      assert.equal(definition?.uri, 'untitled:binding-fixture');
      assert.equal(text.slice(definition!.target.start, definition!.target.end), ref.reference.name);
      assert.equal(definition!.target.start, (ref.reference.name === "blocks" ? text.indexOf('data:blocks') + 5 : text.indexOf('each=')) );
      assert.ok(ref.scope && ref.scope.start <= ref.root.start && ref.root.end <= ref.scope.end);
    }
    const member = references.find(r => r.reference.path.length)!;
    assert.deepEqual(member.reference.path, ['kind']);
    assert.equal(binding_definition_at(result, text.indexOf('kind')), undefined);
    assert.equal(member.declaration?.elementOf?.declaration, declarations[0], 'iteration origin retains the receiving identity for future Schema work');
  });
  check(`${language}: semantic receiving/iteration parity and member independence`, () => {
    const roots = binding_highlights(result);
    for (const ref of result.sources[0]!.references.filter(r => r.declaration)) {
      const use = roots.find(t => t.range.start === ref.root.start)!;
      const declaration = roots.find(t => t.range.start === ref.declaration!.location.start)!;
      assert.equal(use.type, declaration.type);
      assert.deepEqual(use.modifiers, declaration.modifiers);
    }
    assert.ok(roots.every(token => ['blocks', 'each'].includes(text.slice(token.range.start, token.range.end))));
    if (language.startsWith('typescript')) {
      const tokens = overlay_binding_highlights(hson_highlights(grammar, result.document.fileName, text, result), roots);
      assert.equal(tokens.find(t => t.range.start === text.indexOf('someBlocks'))?.type, 'hsonIncomingReference');
      assert.equal(tokens.find(t => t.range.start === text.indexOf('kind'))?.type, 'hsonReference');
      assert.deepEqual(tokens.find(t => t.range.start === text.indexOf('kind'))?.modifiers, ['hsonMember']);
      assert.equal(tokens.find(t => t.range.start === text.indexOf('block:data'))?.type, 'hsonSending');
      assert.ok(tokens.some(t => t.type === 'hsonLocalReferenceSigil'));
      assert.ok(tokens.some(t => t.type === 'hsonIncomingReferenceSigil'));
      assert.ok(tokens.every((t, i) => !i || tokens[i - 1]!.range.end <= t.range.start));
    }
  });
}
check('shadowing follows identities, including source reads before the iterator aliases', () => {
  for (const name of ['row', 'renamed']) {
    const text = `<main hson:part data:${name}=%{input} <section for:${name}:index=^{${name}} <i per:key:${name}=^{${name}.children} title=^{${name}.kind} data-i=^{index} data-k=^{key}/> <b title=^{${name}}/>/> <p title=^{${name}}/>/>`;
    const result = snapshot(text), refs = result.sources[0]!.references.filter(r => r.reference.namespace === 'local');
    const declarations = result.sources[0]!.declarations;
    const receiving = declarations.find(d => d.origin === 'receiving')!;
    const outer = declarations.find(d => d.origin === 'iteration-value' && d.elementOf?.declaration === receiving)!;
    const inner = declarations.find(d => d.origin === 'iteration-value' && d.elementOf?.declaration === outer)!;
    assert.equal(refs[0]!.declaration, receiving);
    assert.equal(refs[1]!.declaration, outer);
    assert.equal(refs[2]!.declaration, inner);
    assert.equal(refs[3]!.declaration?.origin, 'iteration-index');
    assert.equal(refs[4]!.declaration?.origin, 'iteration-key');
    assert.equal(refs[5]!.declaration, outer);
    assert.equal(refs[6]!.declaration, receiving);
    for (const ref of refs) assert.equal(binding_definition_at(result, ref.root.start)?.target, ref.declaration!.location);
  }
});
check('bare/quoted operands, optional references, escaped roots, quoted keys and CRLF offsets', () => {
  for (const value of ['^{item.kind?}', '"^{item.kind?}"', '^{item["odd}key"][0]?}', String.raw`"^{item[\"odd}key\"][0]?}"`, String.raw`"^{\u0069tem.kind}"`]) {
    const text = '<main hson:part data:item="%{input}"\r\n <p title=' + value + '/>/>';
    const result = snapshot(text), use = result.sources[0]!.references.find(r => r.reference.namespace === 'local')!;
    assert.ok(use, value); assert.equal(use.resolution, 'resolved');
    assert.equal(binding_definition_at(result, use.root.start)?.target.start, text.indexOf('data:item') + 5);
    assert.ok(use.location.start > text.indexOf('\r\n'));
  }
});
check('separate Part authoring regions and invalid nested declarations cannot leak bindings', () => {
  const other = '<main hson:part <p title=^{each}/>/>';
  for (const text of ['```hson\n' + canonical + '\n```\n```hson\n' + other + '\n```', wrap(canonical) + '\nconst other = Hson.document`'+other+'`;']) {
    const result = snapshot(text, text.startsWith('```') ? 'markdown' : 'typescript');
    assert.equal(binding_definition_at(result, text.lastIndexOf('each')), undefined);
    assert.equal(result.sources.at(-1)?.references[0]?.resolution, 'unresolved');
  }
  assert.equal(snapshot('<main hson:part data:d=%{x} <p hson:part title=^{d}/>/>' ).sources[0]?.references.length, 0, 'nested Part definitions are rejected by the authoritative rules');
});
check('version/text/language changes invalidate snapshots; unresolved names remain lexical', () => {
  const first = snapshot(canonical);
  assert.equal(snapshot(canonical), first);
  assert.notEqual(snapshot(canonical, 'hson', 2), first);
  const changed = snapshot(canonical.replace('data:blocks', 'data:renamed'));
  assert.notEqual(changed, first);
  assert.equal(changed.sources[0]!.references.find(r => r.reference.name === 'blocks')?.resolution, 'unresolved');
  assert.equal(binding_definition_at(changed, changed.document.text.indexOf('^{blocks}') + 2), undefined);
  cache.forget(first.document.uri);
  assert.notEqual(snapshot(canonical), first);
  cache.clear();
});
check('TypeScript substitutions and ordinary host identifiers stay outside binding navigation', () => {
  const text = wrap(canonical.replace('class="column"', 'class="${hostValue}"'));
  const result = snapshot(text, 'typescript');
  assert.equal(result.sources[0]!.declarations.length, 2);
  assert.equal(binding_definition_at(result, text.indexOf('hostValue')), undefined);
  assert.ok(binding_highlights(result).every(t => t.range.end <= text.indexOf('${') || t.range.start > text.indexOf('}') ));
  const unavailable = snapshot(wrap(canonical.replace('class="column"', '${attributes}')), 'typescript');
  assert.equal(binding_highlights(unavailable).length, 0);
});
check('text, structural Document references and nested templates retain their own provenance', () => {
  const body = '<main hson:part data:model=%{payload} doc:control=%{content} "^{model.title}" <hson-part ^{control}/>/>';
  for (const language of ['hson', 'markdown', 'typescript', 'typescriptreact']) {
    const text = language === 'hson' ? body : language === 'markdown' ? '```hson\n' + body + '\n```' : wrap(body);
    const result = snapshot(text, language);
    for (const name of ['model', 'control']) {
      const use = result.sources[0]!.references.find(ref => ref.reference.namespace === 'local' && ref.reference.name === name)!;
      assert.equal(use.resolution, 'resolved');
      assert.equal(binding_definition_at(result, use.root.start)?.target.start, text.indexOf(':' + name + '=') + 1);
    }
  }
  const inner = '<p hson:part data:inner=%{payload} title=^{inner.title}/>';
  const nested = wrap('<main hson:part data:outer=%{payload} ${Hson.document`' + inner + '`} title=^{outer.title}/>');
  const result = snapshot(nested, 'typescript');
  assert.equal(binding_definition_at(result, nested.indexOf('^{inner.title}') + 2)?.target.start, nested.indexOf('data:inner') + 5);
  assert.equal(binding_definition_at(result, nested.indexOf('^{outer.title}') + 2), undefined, 'opaque structural substitution withholds outer proof');
});
check('static fromHson strings compose both JavaScript and Hson source correspondence', () => {
  const text = 'import {hson} from "hson-live"; const p=hson.fromHson(' + JSON.stringify(canonical) + ');';
  const result = snapshot(text, 'typescript');
  const each = result.sources[0]!.references.find(r => r.reference.path.length)!;
  assert.equal(each.resolution, 'resolved');
  assert.equal(text.slice(each.root.start, each.root.end), 'each');
  assert.equal(text.slice(each.declaration!.location.start, each.declaration!.location.end), 'each');
});
check('iterator suffix names preserve receiving navigation and iteration semantic identities', () => {
  for (const form of ['for:data', 'for:doc', 'per:doc']) for (const language of ['hson', 'typescript']) {
    const alias = form.slice(4);
    const body = `<main hson:part data:rows=%{payload} <hson-part ${form}=^{rows} at=leaf value=^{${alias}}/>/>`;
    const text = language === 'hson' ? body : wrap(body), result = snapshot(text, language);
    const receiving = result.sources[0]!.declarations.find(declaration => declaration.origin === 'receiving')!;
    const iterator = result.sources[0]!.declarations.find(declaration => declaration.name === alias)!;
    assert.equal(receiving.location.start, text.indexOf('data:rows') + 5);
    assert.equal(iterator.location.start, text.indexOf(form) + 4);
    assert.equal(binding_definition_at(result, text.indexOf('^{rows}') + 2)?.target.start, receiving.location.start);
    assert.equal(binding_definition_at(result, text.indexOf(`^{${alias}}`) + 2)?.target.start, iterator.location.start);
    const highlights = overlay_binding_highlights(hson_highlights(grammar, result.document.fileName, text, result), binding_highlights(result));
    assert.equal(highlights.find(token => token.range.start === receiving.location.start)?.type, 'hsonReceiving');
    assert.equal(highlights.find(token => token.range.start === iterator.location.start)?.type, 'hsonIteration');
  }
});
check('active themes receive standard categories without a House palette override', () => {
  assert.equal(hsonTokenDefinitions.hsonReceiving.superType, 'parameter');
  assert.equal(hsonTokenDefinitions.hsonIteration.superType, 'variable');
  assert.equal(hsonTokenDefinitions.hsonIncomingReference.superType, 'parameter');
});
console.log(`# ${checks} binding intelligence checks passed`);

}
void run().catch(error => { console.error(error); process.exitCode = 1; });
