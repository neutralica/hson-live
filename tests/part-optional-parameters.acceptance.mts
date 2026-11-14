import { complete_html } from "./helpers/document-library.mts";
import assert from "node:assert/strict";
import { isMainThread, parentPort } from "node:worker_threads";
import { Hson, hsonLiveMap } from "../src/index.js";
import { document_composition_options, expand_document_composition } from "../src/api/livemap/livemap.document.composition.js";
import { parse_part_event } from "../src/internal/part-events.js";
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

check("write completeness uses incoming names and the immutable admitted definition", () => {
  for (const [body, kind] of [
    ['<p hson:part <b "%{content}"/>/>', 'scalar'],
    ['<p hson:part data:local="%{slide}" "^{local.title}"/>', 'Data'],
    ['<main hson:part doc:local="%{slide}" <hson-part ^{local}/>/>' , 'Document'],
  ]) {
    const map = fixture(body!), name = kind === 'scalar' ? 'content' : 'slide';
    assert.throws(() => map.parts.components.x.write(), { name: 'TypeError',
      message: `Part components/x is missing ${kind} input ${name}. Expected: ${name}: ${kind}.` });
    assert.throws(() => map.parts.components.x.write({}), /is missing/);
  }
  const map = fixture('<p hson:part "%{content?}"/>'), retained = map.parts.components.x;
  const write = retained.write;
  assert.doesNotThrow(() => write());
  assert.throws(() => retained.replace(part('<p hson:part "%{next}"/>')), /Immutable Part/);
  assert.doesNotThrow(() => write());
  assert.throws(() => write({ next: 'unexpected' }), /unexpected scalar input next/);
  assert.doesNotThrow(() => write({ content: 'original' }));
  const required = fixture('<p hson:part "%{next}"/>');
  assert.throws(() => required.parts.components.x.write(), /missing scalar input next/);
  assert.doesNotThrow(() => required.parts.components.x.write({ next: 'required' }));
  assert.throws(() => fixture('<p hson:part "%{x?}" <b "%{x}"/>/>').parts.components.x.write(), /missing scalar input x/);
});

check("explicit scalar receivers distinguish absence, type mismatches, and present empty values", () => {
  const map = fixture('<p hson:part str:label=%{label?} num:value=%{value?} title=^{label} <b "^{value}"/>/>');
  const write = map.parts.components.x.write;
  map.addLibraries({ absent: { document: write() }, zero: { document: write({ label: '', value: 0 }) } });
  assert.equal(map.doc.must('absent').render(), complete_html('<p><b></b></p>'));
  assert.equal(map.doc.must('zero').document.attrs.get({ kind: 'path', path: [0,0,1,0,0] }, 'title'), '');
  assert.match(map.doc.must('zero').render(), /<b>0<\/b>/);
  for (const value of ['5', true, null, undefined, Infinity, -Infinity, NaN, { n: 1 }, new Number(5)]) {
    assert.throws(() => Reflect.apply(write, undefined, [{ value }]), /num argument "value" requires a finite number/);
  }
  for (const label of [5, false, null, undefined, [], new String('text')]) {
    assert.throws(() => Reflect.apply(write, undefined, [{ label }]), /str argument "label" requires a string/);
  }
  assert.throws(() => map.addLibraries({ invalid: { document: '<hson-part at=components/x value:num="NaN"/>' } }), /finite JSON number/);
  assert.throws(() => map.addLibraries({ invalid: { document: '<hson-part at=components/x value:str="5"/>' } }), /does not match the receiving interface/);
});

check("typed scalar literals preserve exact strings and finite JSON numbers across authored transport", () => {
  const map = fixture('<p hson:part str:label=%{label} num:n=%{value} title=^{label} "^{n}"/>');
  for (const [lexeme, display] of [['-0', '0'], ['1.25', '1.25'], ['-4.5E+2', '-450'], ['2e-3', '0.002']]) {
    map.addLibraries({ [lexeme!]: { document: `<hson-part at=components/x label:str="A &amp; B" value:num="${lexeme}"/>` } });
    assert.equal(map.doc.must(lexeme!).document.attrs.get({ kind: 'path', path: [0,0,1,0,0] }, 'title'), 'A &amp; B');
    assert.match(map.doc.must(lexeme!).render(), new RegExp('>' + display + '</p>'));
  }
  const write = map.parts.components.x.write;
  assert.match(write({ label: 'a', value: -0 }), /value:num="-0"/);
  for (const [i, label] of ['label:str', ' "%{literal}"\n^{literal} #{literal}\u2028 ', '\\u0025{raw}'].entries()) {
    const invocation = write({ label, value: 1 });
    map.addLibraries({ ['written' + i]: { document: Hson.document`<div ${invocation}/>` } });
    assert.equal(map.doc.must('written' + i).document.attrs.get({ kind: 'path', path: [0,0,1,0,0,0,0] }, 'title'), label);
  }
  const raw = '%{literal}';
  const tagged = Hson.document`<hson-part at=components/x label:str="before ${raw} ${true}" value:num="1"/>`;
  map.addLibraries({ tagged: { document: tagged } });
  assert.match(map.doc.must('tagged').render(), /title="before %\{literal\} true"/);
  for (const number of ['', '+5', '01', '.5', '2.', '1e', '1e309', '0x12', ' 5', '5\n']) {
    assert.throws(() => map.addLibraries({ invalid: { document: '<hson-part at=components/x label:str="x" value:num=' + JSON.stringify(number) + '/>' } }), /finite JSON number/);
  }
  assert.throws(() => Hson.document`<hson-part at=components/x value:num="${5}"/>`, /does not accept quoted template interpolation/);
  assert.throws(() => Hson.document`<hson-part at=components/x value:num=5/>`, /Literal attribute values require double quotes/);
  assert.throws(() => Hson.document`<p value=5/>`, /Literal attribute values require double quotes/);
  assert.throws(() => Hson.document`<hson-part at=components/x label:str/>`, /requires a quoted literal/);
  assert.throws(() => map.addLibraries({ invalid: { document: '<hson-part at=components/x label:bool="true"/>' } }), /Unknown Part argument qualifier "bool"/);
  assert.throws(() => fixture('<p hson:part str:label="literal" "ok"/>'), /requires one whole incoming argument reference/);
  const ordinary = fixture('<p hson:part hx:label=%{language} xml:lang=%{language} hx:num=%{language} "ok"/>');
  ordinary.addLibraries({ page: { document: ordinary.parts.components.x.write({ language: 'en' }) }, other: { document: '<p str:name="plain" name:num="5"/>' } });
  assert.match(ordinary.doc.must('page').render(), /hx:label="en" hx:num="en" xml:lang="en"/);
  assert.match(ordinary.doc.must('other').render(), /name:num="5" str:name="plain"/);
});

check("Part Event flags retain precedence over qualifier spellings", () => {
  for (const name of ['str', 'num', 'data', 'doc']) {
    for (const document of [
      Hson.document`<button hson:part />`,
    ]) {}
    for (const document of ['<button hson:part event:' + name + '/>',
      '<main hson:part <button event:' + name + '/>/>']) {
      const event = '<hson:event on:click local:CHECK <> >';
      const map = hsonLiveMap.fromLibraries({ components: { parts: { x: { ...part(document), events: { [name]: event } } } } });
      const invocation = map.parts.components.x.write();
      map.addLibraries({ page: { document: invocation } });
      assert.match(map.doc.must('page').render(), /<button><\/button>/);
      const result = expand_document_composition('page', () => parse_authored_document_library(invocation),
        document_composition_options(undefined), () => ({
          ...parse_authored_document_library(document),
          events: new Map([[name, parse_part_event(event)]]),
        }));
      assert.deepEqual(result.interactions.map(({ key }) => key), ['CHECK']);
    }
  }
});

check("str template slots cannot manufacture Part references across source boundaries", () => {
  const map = fixture('<p hson:part str:label=%{label} title=^{label}/>');
  const cases = [
    [Hson.document`<hson-part at=components/x label:str="Rate: %${'{tax}'}"/>`, 'Rate: %{tax}'],
    [Hson.document`<hson-part at=components/x label:str="${'^'}{tax}"/>`, '^{tax}'],
    [Hson.document`<hson-part at=components/x label:str="#${''}{tax}"/>`, '#{tax}'],
    [Hson.document`<hson-part at=components/x label:str="^{${'tax'}}"/>`, '^{tax}'],
    [Hson.document`<hson-part at=components/x label:str="%{tax${'}'}"/>`, '%{tax}'],
    [Hson.document`<hson-part at=components/x label:str="%{tax${''}}"/>`, '%{tax}'],
    [Hson.document`<hson-part at=components/x label:str="^${'{'}tax} \u0025{escaped}"/>`, '^{tax} %{escaped}'],
  ] as const;
  for (const [index, [document, expected]] of cases.entries()) {
    const name = 'boundary' + index;
    map.addLibraries({ [name]: { document } });
    assert.equal(map.doc.must(name).document.attrs.get({ kind: 'path', path: [0,0,1,0,0] }, 'title'), expected);
  }
  const document = Hson.document`<main hson:part str:s=%{incoming}
    <hson-part at=leaf label:str="${'start'} %{incoming} ^{s} %${'{literal}'}"/>
    <hson-part at=leaf label:str="${''}^{s}${''}"/>
  />`;
  const nested = hsonLiveMap.fromLibraries({ components: { parts: {
    x: part(document), leaf: part('<p hson:part str:label=%{label} "^{label}"/>'),
  } } });
  nested.addLibraries({ page: { document: nested.parts.components.x.write({ incoming: 'kept' }) } });
  assert.equal(nested.doc.must('page').render(), complete_html('<main><p>start kept kept %{literal}</p><p>kept</p></main>'));
});

check("whole scalar operands retain type across nested Parts and iterator aliases", () => {
  const parts = {
    x: part('<main hson:part str:label=%{caption?} num:n=%{step} data:rows=%{rows} <hson-part at=leaf label:str=%{caption} value:num=^{n}/> <hson-part for:row:i=^{rows} at=leaf label:str="row ^{i}: ^{row.title} (%{step})" value:num=^{row.value}/>/>'),
    leaf: { ...part('<button hson:part str:title=%{label?} num:number=%{value} title=^{title} event:inspect "^{number}"/>'),
      events: { inspect: '<hson:event on:click local:CHECK input:data=^{number} <> >' } },
  };
  const map = hsonLiveMap.fromLibraries({ components: { parts } });
  map.addLibraries({ page: { document: map.parts.components.x.write({ caption: 'Title', step: -0, rows: [{ title: true, value: 1.25 }, { title: null, value: -2 }] }) } });
  assert.equal(map.doc.must('page').render(), complete_html('<main><button title="Title">0</button><button title="row 0: true (0)">1.25</button><button title="row 1: null (0)">-2</button></main>'));
  for (const value of ['5', true, null, {}, [5]]) {
    const invalid = map.parts.components.x.write({ step: 5, rows: [{ title: 'x', value }] });
    assert.throws(() => map.addLibraries({ invalid: { document: invalid } }), /"value:num" requires a num value/);
  }
  map.addLibraries({ absent: { document: map.parts.components.x.write({ step: 5, rows: [] }) } });
  assert.equal(map.doc.must('absent').render(), complete_html('<main><button>5</button></main>'));
  const composed = expand_document_composition('page', () => parse_authored_document_library(map.parts.components.x.write({ step: -0, rows: [{ title: 'x', value: -0 }] })),
    document_composition_options(undefined), (_collection, name) => ({
      ...parse_authored_document_library(parts[name === 'leaf' ? 'leaf' : 'x'].document),
      ...(name === 'leaf' ? { events: new Map([["inspect", parse_part_event(parts.leaf.events.inspect)]]) } : {}),
    }));
  assert.deepEqual(composed.interactions.map(interaction => interaction.data), [-0, -0]);
  const ordinal = hsonLiveMap.fromLibraries({ components: { parts: { leaf: parts.leaf,
    x: part('<main hson:part data:rows=%{rows} <hson-part for::i=^{rows} at=leaf value:num=^{i}/>/>') } } });
  ordinal.addLibraries({ page: { document: ordinal.parts.components.x.write({ rows: [null, null] }) } });
  assert.match(ordinal.doc.must('page').render(), /<button>0<\/button><button>1<\/button>/);
});

check("whole str references do not coerce, and num rejects partial interpolation", () => {
  const example = (args: string) => hsonLiveMap.fromLibraries({ components: { parts: {
    x: part(`<main hson:part data:d=%{payload} <hson-part at=leaf ${args}/> />`),
    leaf: part('<p hson:part str:text=%{text} num:n=%{n} "^{text}:^{n}"/>'),
  } } });
  const map = example('text:str="^{d.value}" n:num=^{d.zero}');
  for (const value of [5, true, null, { n: 5 }]) {
    assert.throws(() => map.addLibraries({ page: { document: map.parts.components.x.write({ payload: { value, zero: 0 } }) } }), /"text:str" requires a str value/);
  }
  map.addLibraries({ page: { document: map.parts.components.x.write({ payload: { value: '5', zero: 0 } }) } });
  assert.equal(map.doc.must('page').render(), complete_html('<main><p>5:0</p></main>'));
  for (const number of ['"0^{d.value}"', '"^{d.value}0"', '"^{d.value}^{d.value}"']) {
    assert.throws(() => example(`text:str="x" n:num=${number}`).parts.components.x.write({ payload: { value: 5 } }), /numeric interpolation is unsupported/);
  }
});

check("optional scalar attributes and complete content positions omit without coercion", () => {
  const map = fixture('<p hson:part title="prefix%{value?}suffix" "left%{value?}right" <b "kept"/>/>');
  map.addLibraries({ absent: { document: map.parts.components.x.write() } });
  assert.equal(map.doc.must('absent').render(), complete_html('<p><b>kept</b></p>'));
  for (const value of [false, 0, '', null]) {
    const key = `v${String(value) || 'empty'}`;
    map.addLibraries({ [key]: { document: map.parts.components.x.write({ value }) } });
    const doc = map.doc.must(key);
    assert.equal(doc.document.attrs.get({ kind: 'path', path: [0,0,1,0,0] }, 'title'), `prefix${value}suffix`);
    assert.equal(doc.render(), complete_html(`<p title="prefix${value}suffix">left${value}right<b>kept</b></p>`));
  }
});

check("optional local paths preserve missing versus invalid and present primitive values", () => {
  const map = fixture('<p hson:part data:model="%{payload}" title="^{model.missing.deep?}" "^{model.missing?}" <i "^{model.value?}"/>/>');
  for (const value of [false, 0, '', null]) {
    const key = `v${String(value) || 'empty'}`;
    map.addLibraries({ [key]: { document: map.parts.components.x.write({ payload: Hson.data.from({ value }) }) } });
    assert.equal(map.doc.must(key).document.attrs.get({ kind: 'path', path: [0,0,1,0,0] }, 'title'), undefined);
    if (value === '') assert.match(map.doc.must(key).render(), /<p><i><!--hson-boundary:[a-f0-9]+:empty:0--><\/i><\/p>/);
    else assert.equal(map.doc.must(key).render(), complete_html(`<p><i>${value}</i></p>`));
  }
  map.addLibraries({ absent: { document: map.parts.components.x.write({ payload: Hson.data.from({}) }) } });
  assert.equal(map.doc.must('absent').render(), complete_html('<p><i></i></p>'));
  assert.throws(() => fixture('<p hson:part data:model="%{payload}" "^{model.null.x?}"/>').addLibraries({
    page: { document: '<hson-part at="components/x" payload:data="<null null>"/>' },
  }), /Invalid Part path/);
  assert.throws(() => fixture('<p hson:part "^{undeclared?}"/>').parts.components.x.write(), /local declaration/);
});

check("tagged authoring keeps optional markers inside quoted and unquoted references", () => {
  const document = Hson.document`<p hson:part data:d="%{payload}" title=^{d.missing?} "%{content?}" "^{d[\"question?\"]?}"/>`;
  const map = hsonLiveMap.fromLibraries({ components: { parts: { x: part(document) } } });
  map.addLibraries({ page: { document: map.parts.components.x.write({ payload: Hson.data.from({ 'question?': false }) }) } });
  assert.equal(map.doc.must('page').render(), complete_html('<p>false</p>'));
  assert.doesNotMatch(map.doc.must('page').hson(), /[%^]\{|undefined/);
});

check("optional Data and Document receiving roots carry absence into local uses", () => {
  const map = fixture('<main hson:part data:model="%{payload?}" doc:control="%{content?}" title="^{model.title}" "^{model.label}" <hson-part ^{control}/>/>' );
  map.addLibraries({ absent: { document: map.parts.components.x.write() } });
  assert.equal(map.doc.must('absent').render(), complete_html('<main></main>'));
  map.addLibraries({ present: { document: map.parts.components.x.write({ payload: Hson.data.from({ title: 'T', label: false }), content: '<b @:inside "Body"/>' }) } });
  assert.equal(map.doc.must('present').render(), complete_html('<main title="T">false<b>Body</b></main>'));
  assert.throws(() => map.addLibraries({ bad: { document: map.parts.components.x.write({ payload: Hson.data.from({}) }) } }), /Missing Part path/);
  // Local optionality does not relax the receiving declaration itself.
  assert.throws(() => fixture('<main hson:part doc:c="%{content}" <hson-part ^{c?}/>/>' ).parts.components.x.write(), /missing Document input content/);
});

check("required references and unrelated errors stay strict beside optional absence", () => {
  for (const body of [
    '<p hson:part data:d="%{data}" "%{optional?}:^{d.missing}"/>',
    '<p hson:part data:d="%{data}" title="%{optional?}:^{d.missing}"/>',
  ]) {
    const map = fixture(body);
    assert.throws(() => map.addLibraries({ bad: { document: map.parts.components.x.write({ data: Hson.data.fromSource('<>') }) } }), /Missing Part path/);
    assert.equal(map.doc('bad'), undefined);
  }
  for (const ref of ['%{x??}', '%{x?bad}', '^{d?.x}', '#{x?}', '%{x.path?}']) {
    assert.throws(() => fixture(`<p hson:part "${ref}"/>`).parts.components.x.write());
  }
});

check("conditional Data demand defers empty iterators under optional roots", () => {
  const body = '<main hson:part part:optional data:rows="%{rows}" data:model="%{payload}" <i for:row="^{rows}" "^{model.title}"/>/>';
  const evidence = signature(body);
  assert.equal(evidence.requiredness.get('rows'), 'required');
  assert.equal(evidence.requiredness.get('payload'), 'conditional');
  const map = fixture(body);
  const empty = map.parts.components.x.write({ rows: Hson.data.from([]) });
  assert.throws(() => map.addLibraries({ empty: { document: empty } }), /exactly one/);
  const nonempty = map.parts.components.x.write({ rows: Hson.data.from([1]) });
  assert.throws(() => map.addLibraries({ bad: { document: nonempty } }), /missing Data input payload/);
  assert.doesNotThrow(() => map.parts.components.x.write({ rows: Hson.data.from([1]), payload: Hson.data.fromSource('<title "yes">') }));
  const requiredRoot = fixture(body.replace(' part:optional', ''));
  assert.throws(() => requiredRoot.parts.components.x.write({ rows: Hson.data.from([]) }), /missing Data input payload/);
  for (const suffix of ['"%{scalar}"', '<hson-part ^{control}/>']) {
    const declarations = suffix.includes('control') ? ' doc:control="%{doc}"' : '';
    assert.throws(() => fixture(`<main hson:part part:optional data:rows="%{rows}"${declarations} <i for:item="^{rows}" ${suffix}/>/>`)
      .parts.components.x.write({ rows: Hson.data.from([]) }), /missing (scalar|Document) input/);
  }
});

check("nested for and per ancestry and shadowed aliases retain lexical demand", () => {
  const body = '<main hson:part part:optional data:rows="%{rows}" data:model="%{payload}" <section for:model="^{rows}" <b per:key:value="^{model}" "^{value}"/>/> <aside for:item="^{rows}" part:optional "^{model.missing?}"/>/>';
  assert.equal(signature(body).requiredness.get('payload'), 'conditional');
  const map = fixture(body);
  assert.throws(() => map.addLibraries({ empty: { document: map.parts.components.x.write({ rows: Hson.data.from([]) }) } }), /exactly one/);
  // The root model declaration is shadowed; the inner value is the row's value.
  map.addLibraries({ live: { document: map.parts.components.x.write({ rows: Hson.data.from([{ a: false }]), payload: Hson.data.fromSource('<unused 0>') }) } });
  assert.equal(map.doc.must('live').render(), complete_html('<main><section><b>false</b></section></main>'));
  const nested = '<main hson:part part:optional data:rows="%{rows}" data:model="%{payload}" <section for:row="^{rows}" <b per:key:value="^{model}" "^{value}"/>/>/>';
  const other = fixture(nested);
  assert.throws(() => other.addLibraries({ empty: { document: other.parts.components.x.write({ rows: Hson.data.from([]) }) } }), /exactly one/);
  assert.throws(() => other.addLibraries({ bad: { document: other.parts.components.x.write({ rows: Hson.data.from([1]) }) } }), /missing Data input payload/);
  const optionalIterator = fixture('<main hson:part data:rows="%{rows?}" <b for:row="^{rows}" "^{row}"/>/>');
  optionalIterator.addLibraries({ page: { document: optionalIterator.parts.components.x.write() } });
  assert.equal(optionalIterator.doc.must('page').render(), complete_html('<main></main>'));
});

check("omitted arguments still prove names and representations", () => {
  for (const argument of ['extra="%{value?}"', 'block:data="^{d.missing?}"', 'content:doc="^{d?}"']) {
    const map = hsonLiveMap.fromLibraries({ components: { parts: {
      x: part(`<main hson:part data:d="%{payload?}" <hson-part at="heading" ${argument}/>/>`),
      heading: part('<h1 hson:part "%{content?}"/>'),
    } } });
    assert.throws(() => map.addLibraries({ bad: { document: map.parts.components.x.write() } }));
    assert.equal(map.doc('bad'), undefined);
  }
  const map = fixture('<main hson:part data:d="%{payload?}" doc:c="%{content?}" "^{d?}" <hson-part ^{c?}/>/>' );
  const malformed: readonly Readonly<Record<string, string>>[] = [{ content: '<broken' }, { content: '' }];
  for (const input of malformed) {
    const authored = map.parts.components.x.write(input);
    assert.throws(() => map.addLibraries({ bad: { document: authored } }));
  }
  assert.throws(() => map.parts.components.x.write({ payload: Hson.data.fromSource('<broken') }));
  const literal = map.parts.components.x.write({ payload: '<broken' });
  map.addLibraries({ literal: { document: literal } });
  assert.match(map.doc.must('literal').render(), /&lt;broken/);
  let reads = 0;
  assert.throws(() => map.parts.components.x.write({ get payload() { reads++; return '<>'; } }));
  assert.equal(reads, 0);
  assert.throws(() => map.parts.components.x.write(Object.defineProperty({}, 'payload', { value: '<>' })));
  const direct = map.parts.components.x.write({ payload: false });
  assert.equal(direct, map.parts.components.x.write({ payload: Hson.data.from(false) }));
  assert.throws(() => Reflect.apply(map.parts.components.x.write, undefined, [{ 'payload:data': '<>' }]));
});

check("optional structured forwarding omits inputs and preserves independent Document occurrences", () => {
  const map = hsonLiveMap.fromLibraries({ components: { parts: {
    host: part('<main hson:part data:d="%{payload?}" doc:c="%{content?}" <hson-part at="leaf" model:data="^{d?}" body:doc="^{c?}"/> <hson-part at="leaf" model:data="^{d?}" body:doc="^{c?}"/>/>'),
    leaf: part('<article hson:part data:d="%{model?}" doc:c="%{body?}" "^{d?}" <hson-part ^{c?}/>/>' ),
  } } });
  map.addLibraries({ absent: { document: map.parts.components.host.write() } });
  assert.equal(map.doc.must('absent').render(), complete_html('<main><article></article><article></article></main>'));
  map.addLibraries({ present: { document: map.parts.components.host.write({ payload: Hson.data.from(false), content: '<b @:inside "Body"/>' }) } });
  assert.equal(map.doc.must('present').render(), complete_html('<main><article>false<b>Body</b></article><article>false<b>Body</b></article></main>'));
  const authority = internal_livemap_aggregate_authority(map);
  const state = authority.documentScopes(authority.libraries()[2]!)!;
  const bodies = state.occurrences.filter(occurrence => occurrence.bindings.some(binding => binding.name === 'inside'));
  assert.equal(bodies.length, 2);
  assert.notEqual(bodies[0]!.rootQuid, bodies[1]!.rootQuid);
});

check("absent structural Document positions retire their local CSS subjects", () => {
  const map = hsonLiveMap.fromLibraries({ components: { parts: {
    x: { ...part('<main hson:part @:root doc:c="%{content?}" <h1 "Keep"/> <hson-part @:slot ^{c?}/>/>' ),
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
    x: part('<main hson:part @:root part:optional doc:c="%{content?}" <hson-part ^{c?}/>/>' , ':scope{color:red}'),
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
  assert.throws(() => map.addLibraries({ absent: { document: authored } }), /exactly one/);
  assert.deepEqual(owner.captureSemanticCheckpoint(), before);
  assert.equal(commits, 0); assert.equal(watches, 0);
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
