import assert from "node:assert/strict";
import { isMainThread, parentPort } from "node:worker_threads";
import { Hson, hsonLiveMap } from "../src/index.js";
import { analyze_part_definition } from "../src/internal/part-definition.js";
import { parse_authored_document_library } from "../src/api/livemap/livemap.document.quad.js";
import { internal_livemap_aggregate_authority } from "../src/api/livemap/livemap.internal.js";
import { enumerate_livemap_issued_quids } from "../src/api/livemap/livemap.identity-epoch.js";
import { repository_typescript_worker } from "./helpers/repository-typescript-worker.mts";

export const HSON_LIVE_TEST_METADATA = Object.freeze({ id: "part-optional-parameters", title: "Explicit optional Part inputs and write completeness",
  category: "LiveMap", runtime: "node", tags: Object.freeze(["parts", "authoring", "worker", "identity", "atomicity"]) });
const part = (document: string, stylesheet?: string) => ({ kind: "document" as const, document, ...(stylesheet === undefined ? {} : { stylesheet }) });
const fixture = (document: string) => hsonLiveMap.fromLibraries({ components: { parts: { x: part(document) } } });
const signature = (document: string) => analyze_part_definition(parse_authored_document_library(document).root);
let groups = 0;
function check(_name: string, run: () => void) { run(); groups++; }

check("write completeness uses incoming names and the current definition", () => {
  for (const [body, kind] of [
    ['<p hson:part <b "%{content}"/>/>', 'scalar'],
    ['<p hson:part local:data="%{slide}" "^{local.title}"/>', 'Data'],
    ['<main hson:part local:doc="%{slide}" <hson-part ^{local}/>/>' , 'Document'],
  ]) {
    const map = fixture(body!), name = kind === 'scalar' ? 'content' : 'slide';
    assert.throws(() => map.parts.components.x.write(), { name: 'TypeError',
      message: `Part components/x is missing ${kind} input ${name}. Expected: ${name}: ${kind}.` });
    assert.throws(() => map.parts.components.x.write({}), /is missing/);
  }
  const map = fixture('<p hson:part "%{content?}"/>'), retained = map.parts.components.x;
  const write = retained.write;
  assert.doesNotThrow(() => write());
  retained.replace(part('<p hson:part "%{next}"/>'));
  assert.throws(() => write(), /missing scalar input next/);
  assert.throws(() => write({ content: 'stale' }), /unexpected scalar input content/);
  assert.doesNotThrow(() => write({ next: 'current' }));
  retained.replace(part('<p hson:part "%{next?}"/>'));
  assert.doesNotThrow(() => write());
  assert.throws(() => fixture('<p hson:part "%{x?}" <b "%{x}"/>/>').parts.components.x.write(), /missing scalar input x/);
});

check("optional scalar attributes and complete content positions omit without coercion", () => {
  const map = fixture('<p hson:part title="prefix%{value?}suffix" "left%{value?}right" <b "kept"/>/>');
  map.addLibraries({ absent: { document: map.parts.components.x.write() } });
  assert.equal(map.doc.must('absent').render(), '<p><b>kept</b></p>');
  for (const value of [false, 0, '', null]) {
    const key = `v${String(value) || 'empty'}`;
    map.addLibraries({ [key]: { document: map.parts.components.x.write({ value }) } });
    const doc = map.doc.must(key);
    assert.equal(doc.document.attrs.get({ kind: 'path', path: [0] }, 'title'), `prefix${value}suffix`);
    assert.equal(doc.render(), `<p title="prefix${value}suffix">left${value}right<b>kept</b></p>`);
  }
});

check("optional local paths preserve missing versus invalid and present primitive values", () => {
  const map = fixture('<p hson:part model:data="%{payload}" title="^{model.missing.deep?}" "^{model.missing?}" <i "^{model.value?}"/>/>');
  for (const value of [false, 0, '', null]) {
    const key = `v${String(value) || 'empty'}`;
    map.addLibraries({ [key]: { document: map.parts.components.x.write({ payload: Hson.data.from({ value }) }) } });
    assert.equal(map.doc.must(key).document.attrs.get({ kind: 'path', path: [0] }, 'title'), undefined);
    if (value === '') assert.match(map.doc.must(key).render(), /^<p><i><!--hson-boundary:[a-f0-9]+:empty:0--><\/i><\/p>$/);
    else assert.equal(map.doc.must(key).render(), `<p><i>${value}</i></p>`);
  }
  map.addLibraries({ absent: { document: map.parts.components.x.write({ payload: Hson.data.from({}) }) } });
  assert.equal(map.doc.must('absent').render(), '<p><i></i></p>');
  assert.throws(() => fixture('<p hson:part model:data="%{payload}" "^{model.null.x?}"/>').addLibraries({
    page: { document: '<hson-part at="components/x" data:payload="<null null>"/>' },
  }), /Invalid Part path/);
  assert.throws(() => fixture('<p hson:part "^{undeclared?}"/>').parts.components.x.write(), /local declaration/);
});

check("tagged authoring keeps optional markers inside quoted and unquoted references", () => {
  const document = Hson.document`<p hson:part d:data="%{payload}" title=^{d.missing?} "%{content?}" "^{d[\"question?\"]?}"/>`;
  const map = hsonLiveMap.fromLibraries({ components: { parts: { x: part(document) } } });
  map.addLibraries({ page: { document: map.parts.components.x.write({ payload: Hson.data.from({ 'question?': false }) }) } });
  assert.equal(map.doc.must('page').render(), '<p>false</p>');
  assert.doesNotMatch(map.doc.must('page').hson(), /[%^]\{|undefined/);
});

check("optional Data and Document receiving roots carry absence into local uses", () => {
  const map = fixture('<main hson:part model:data="%{payload?}" control:doc="%{content?}" title="^{model.title}" "^{model.label}" <hson-part ^{control}/>/>' );
  map.addLibraries({ absent: { document: map.parts.components.x.write() } });
  assert.equal(map.doc.must('absent').render(), '<main></main>');
  map.addLibraries({ present: { document: map.parts.components.x.write({ payload: Hson.data.from({ title: 'T', label: false }), content: '<b @:inside "Body"/>' }) } });
  assert.equal(map.doc.must('present').render(), '<main title="T">false<b>Body</b></main>');
  assert.throws(() => map.addLibraries({ bad: { document: map.parts.components.x.write({ payload: Hson.data.from({}) }) } }), /Missing Part path/);
  // Local optionality does not relax the receiving declaration itself.
  assert.throws(() => fixture('<main hson:part c:doc="%{content}" <hson-part ^{c?}/>/>' ).parts.components.x.write(), /missing Document input content/);
});

check("required references and unrelated errors stay strict beside optional absence", () => {
  for (const body of [
    '<p hson:part d:data="%{data}" "%{optional?}:^{d.missing}"/>',
    '<p hson:part d:data="%{data}" title="%{optional?}:^{d.missing}"/>',
  ]) {
    const map = fixture(body);
    assert.throws(() => map.addLibraries({ bad: { document: map.parts.components.x.write({ data: '<>' }) } }), /Missing Part path/);
    assert.equal(map.doc('bad'), undefined);
  }
  for (const ref of ['%{x??}', '%{x?bad}', '^{d?.x}', '#{x?}', '%{x.path?}']) {
    assert.throws(() => fixture(`<p hson:part "${ref}"/>`).parts.components.x.write());
  }
});

check("conditional Data demand defers empty iterators under optional roots", () => {
  const body = '<main hson:part part:optional rows:data="%{rows}" model:data="%{payload}" <i for:row="^{rows}" "^{model.title}"/>/>';
  const evidence = signature(body);
  assert.equal(evidence.requiredness.get('rows'), 'required');
  assert.equal(evidence.requiredness.get('payload'), 'conditional');
  const map = fixture(body);
  const empty = map.parts.components.x.write({ rows: Hson.data.from([]) });
  map.addLibraries({ empty: { document: empty } });
  assert.deepEqual(map.doc.must('empty').root().$_content, []);
  const nonempty = map.parts.components.x.write({ rows: Hson.data.from([1]) });
  assert.throws(() => map.addLibraries({ bad: { document: nonempty } }), /missing Data input payload/);
  assert.doesNotThrow(() => map.parts.components.x.write({ rows: Hson.data.from([1]), payload: '<title "yes">' }));
  const requiredRoot = fixture(body.replace(' part:optional', ''));
  assert.throws(() => requiredRoot.parts.components.x.write({ rows: Hson.data.from([]) }), /missing Data input payload/);
  for (const suffix of ['"%{scalar}"', '<hson-part ^{control}/>']) {
    const declarations = suffix.includes('control') ? ' control:doc="%{doc}"' : '';
    assert.throws(() => fixture(`<main hson:part part:optional rows:data="%{rows}"${declarations} <i for:item="^{rows}" ${suffix}/>/>`)
      .parts.components.x.write({ rows: Hson.data.from([]) }), /missing (scalar|Document) input/);
  }
});

check("nested for and per ancestry and shadowed aliases retain lexical demand", () => {
  const body = '<main hson:part part:optional rows:data="%{rows}" model:data="%{payload}" <section for:model="^{rows}" <b per:key:value="^{model}" "^{value}"/>/> <aside for:item="^{rows}" part:optional "^{model.missing?}"/>/>';
  assert.equal(signature(body).requiredness.get('payload'), 'conditional');
  const map = fixture(body);
  map.addLibraries({ empty: { document: map.parts.components.x.write({ rows: Hson.data.from([]) }) } });
  assert.deepEqual(map.doc.must('empty').root().$_content, []);
  // The root model declaration is shadowed; the inner value is the row's value.
  map.addLibraries({ live: { document: map.parts.components.x.write({ rows: Hson.data.from([{ a: false }]), payload: '<unused 0>' }) } });
  assert.equal(map.doc.must('live').render(), '<main><section><b>false</b></section></main>');
  const nested = '<main hson:part part:optional rows:data="%{rows}" model:data="%{payload}" <section for:row="^{rows}" <b per:key:value="^{model}" "^{value}"/>/>/>';
  const other = fixture(nested);
  other.addLibraries({ empty: { document: other.parts.components.x.write({ rows: Hson.data.from([]) }) } });
  assert.throws(() => other.addLibraries({ bad: { document: other.parts.components.x.write({ rows: Hson.data.from([1]) }) } }), /missing Data input payload/);
  const optionalIterator = fixture('<main hson:part rows:data="%{rows?}" <b for:row="^{rows}" "^{row}"/>/>');
  optionalIterator.addLibraries({ page: { document: optionalIterator.parts.components.x.write() } });
  assert.equal(optionalIterator.doc.must('page').render(), '<main></main>');
});

check("omitted arguments still prove names and representations", () => {
  for (const argument of ['extra="%{value?}"', 'data:block="^{d.missing?}"', 'doc:content="^{d?}"']) {
    const map = hsonLiveMap.fromLibraries({ components: { parts: {
      x: part(`<main hson:part d:data="%{payload?}" <hson-part at="heading" ${argument}/>/>`),
      heading: part('<h1 hson:part "%{content?}"/>'),
    } } });
    assert.throws(() => map.addLibraries({ bad: { document: map.parts.components.x.write() } }));
    assert.equal(map.doc('bad'), undefined);
  }
  const map = fixture('<main hson:part d:data="%{payload?}" c:doc="%{content?}" "^{d?}" <hson-part ^{c?}/>/>' );
  const malformed: readonly Readonly<Record<string, string>>[] = [{ payload: '<broken' }, { content: '<broken' }, { content: '' }];
  for (const input of malformed) {
    const authored = map.parts.components.x.write(input);
    assert.throws(() => map.addLibraries({ bad: { document: authored } }));
  }
  let reads = 0;
  assert.throws(() => map.parts.components.x.write({ get payload() { reads++; return '<>'; } }));
  assert.equal(reads, 0);
  assert.throws(() => map.parts.components.x.write(Object.defineProperty({}, 'payload', { value: '<>' })));
  assert.throws(() => map.parts.components.x.write({ payload: false }));
  assert.throws(() => Reflect.apply(map.parts.components.x.write, undefined, [{ 'data:payload': '<>' }]));
});

check("optional structured forwarding omits inputs and preserves independent Document occurrences", () => {
  const map = hsonLiveMap.fromLibraries({ components: { parts: {
    host: part('<main hson:part d:data="%{payload?}" c:doc="%{content?}" <hson-part at="leaf" data:model="^{d?}" doc:body="^{c?}"/> <hson-part at="leaf" data:model="^{d?}" doc:body="^{c?}"/>/>'),
    leaf: part('<article hson:part d:data="%{model?}" c:doc="%{body?}" "^{d?}" <hson-part ^{c?}/>/>' ),
  } } });
  map.addLibraries({ absent: { document: map.parts.components.host.write() } });
  assert.equal(map.doc.must('absent').render(), '<main><article></article><article></article></main>');
  map.addLibraries({ present: { document: map.parts.components.host.write({ payload: Hson.data.from(false), content: '<b @:inside "Body"/>' }) } });
  assert.equal(map.doc.must('present').render(), '<main><article>false<b>Body</b></article><article>false<b>Body</b></article></main>');
  const authority = internal_livemap_aggregate_authority(map);
  const state = authority.documentScopes(authority.libraries()[2]!)!;
  const bodies = state.occurrences.filter(occurrence => occurrence.bindings.some(binding => binding.name === 'inside'));
  assert.equal(bodies.length, 2);
  assert.notEqual(bodies[0]!.rootQuid, bodies[1]!.rootQuid);
});

check("absent structural Document positions retire their local CSS subjects", () => {
  const map = hsonLiveMap.fromLibraries({ components: { parts: {
    x: { ...part('<main hson:part @:root c:doc="%{content?}" <h1 "Keep"/> <hson-part @:slot ^{c?}/>/>' ),
      css: { color: 'red', '@:slot': { color: 'blue' } } },
  } } });
  map.addLibraries({ absent: { document: map.parts.components.x.write() } });
  assert.match(map.doc.must('absent').css.snapshot(), /color.*red/);
  assert.match(map.doc.must('absent').css.snapshot(), /:nth-child\(0\)/);
  const authority = internal_livemap_aggregate_authority(map), absent = authority.documentScopes(authority.libraries()[1]!)!;
  assert.ok(absent.occurrences.every(occurrence => occurrence.bindings.every(binding => binding.name !== 'slot')));
  assert.doesNotMatch(map.doc.must('absent').hson(), /hson-part|\^\{/);
  map.addLibraries({ present: { document: map.parts.components.x.write({ content: '<b "Body"/>' }) } });
  assert.match(map.doc.must('present').css.snapshot(), /color.*blue/);
  assert.doesNotMatch(map.doc.must('present').css.snapshot(), /:nth-child\(0\)/);
});

check("optional omission preserves atomicity, CSS ownership and identity lifecycle", () => {
  const map = hsonLiveMap.fromLibraries({ components: { parts: {
    x: part('<main hson:part @:root part:optional c:doc="%{content?}" <hson-part ^{c?}/>/>' , ':scope{color:red}'),
  } } });
  const owner = internal_livemap_aggregate_authority(map), before = owner.captureSemanticCheckpoint();
  const issued = enumerate_livemap_issued_quids(owner.identityEpoch().issued());
  let commits = 0, watches = 0;
  const off = map.commits.observe(() => commits++), unwatch = map.parts.components.x.watch(() => watches++);
  const authored = map.parts.components.x.write();
  assert.equal(commits, 0); assert.equal(watches, 0);
  assert.deepEqual(owner.captureSemanticCheckpoint(), before);
  assert.deepEqual(enumerate_livemap_issued_quids(owner.identityEpoch().issued()), issued);
  const bad = map.parts.components.x.write({ content: '<i @000000001/>' });
  assert.throws(() => map.addLibraries({ bad: { document: bad } }));
  assert.deepEqual(owner.captureSemanticCheckpoint(), before);
  assert.deepEqual(enumerate_livemap_issued_quids(owner.identityEpoch().issued()), issued);
  map.addLibraries({ absent: { document: authored } });
  assert.deepEqual(map.doc.must('absent').root().$_content, []);
  assert.equal(map.doc.must('absent').css.snapshot(), '');
  assert.deepEqual(enumerate_livemap_issued_quids(owner.identityEpoch().issued()), issued);
  map.addLibraries({ present: { document: map.parts.components.x.write({ content: '<b @:inside "Body"/>' }) } });
  assert.match(map.doc.must('present').hson(), /"Body"/);
  assert.match(map.doc.must('present').css.snapshot(), /color.*red/);
  off(); unwatch();
});

if (isMainThread) {
  const worker = repository_typescript_worker(new URL(import.meta.url));
  try {
    assert.deepEqual(await new Promise((resolve, reject) => {
      worker.once('message', resolve); worker.once('error', reject);
      worker.once('exit', code => reject(Error(`Optional Part Worker exited ${code}`)));
    }), { groups, worker: true, hasDocument: false });
  } finally { await worker.terminate(); }
  console.log(`Optional Part parameters: ${groups} Node and ${groups} Worker groups passed.`);
} else parentPort!.postMessage({ groups, worker: true, hasDocument: typeof document !== 'undefined' });
