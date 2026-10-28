import assert from "node:assert/strict";
import { Hson } from "../../src/hson-authoring.ts";
import { hsonLiveMap } from "../../src/api/livemap/livemap.public.ts";
import { hsonTransform } from "../../src/api/transform/transform.facade.ts";
import { tokenize_hson } from "../../src/api/transform/parsers/tokenize-hson.ts";
import { parse_hson } from "../../src/api/transform/parsers/parse-hson.ts";
import { read_transform_error_details } from "../../src/core/errors.ts";
import { parse_hson_with_provenance } from "../../src/internal/hson-source-provenance/parse-hson-with-provenance.ts";

/** The same public/source contract runs in Node and a Worker. */
export function run_attribute_quoting_cases(): number {
  let checks = 0;
  const documentTokens = (source: string) => tokenize_hson(source, 0, undefined, [], undefined, [], "document");
  const reject = (source: string, code: string, value?: string, scan: (source: string) => unknown = parse_hson): void => {
    assert.throws(() => scan(source), error => {
      const details = read_transform_error_details(error);
      assert.equal(details?.code, code, source);
      if (value !== undefined) {
        const start = source.indexOf(value);
        assert.equal(details?.source?.index, start, source);
        assert.equal(details?.related?.find(item => item.role === "value-end")?.source.index, start + value.length, source);
      }
      return true;
    });
    checks++;
  };
  for (const value of ["column", "/slides", "2", "true", "null", "雪", String.raw`literal\n`]) {
    reject(`<p title=${value}/>`, "HSON_ATTRIBUTE_QUOTES_REQUIRED", value);
    const quoted = hsonTransform.fromHson(`<p title=${JSON.stringify(value)}/>`).toHson().serialize();
    assert.equal(quoted, `<p title=${JSON.stringify(value)}/>`);
    checks++;
  }
  for (const tag of ["div", "hson-partial"]) for (const name of ["lib", "at"]) {
    reject(`<${tag} ${name}=components/>`, "HSON_ATTRIBUTE_QUOTES_REQUIRED", "components");
    assert.doesNotThrow(() => parse_hson(`<${tag} ${name}="not/a/selector"/>`));
    assert.doesNotThrow(() => parse_hson(`<${tag} ${name}=%{parameter}/>`));
    checks++;
  }
  for (const tag of ["hson-part", "HSON-PART", "'hson-part'"]) {
    assert.deepEqual(parse_hson(`<${tag} lib=components at=slide/>`), parse_hson(`<${tag} lib="components" at="slide"/>`));
    assert.deepEqual(parse_hson(`<${tag} at=components/slide/>`), parse_hson(`<${tag} at="components/slide"/>`));
    checks++;
  }
  for (const [name, value] of [["lib", "a/b"], ["at", "/b"], ["at", "a/"], ["at", "a/b/c"], ["at", String.raw`a\b`], ["at", "${literal}"]]) {
    reject(`<hson-part ${name}=${value}/>`, "HSON_PART_SELECTOR_INVALID", value);
  }
  reject('<hson-part Lib=components/>', "HSON_ATTRIBUTE_QUOTES_REQUIRED", "components");
  for (const value of ["pre%{bar}", "%{bar}post", "%{bar}%{other}", "components/^{item.kind}"]) {
    for (const [tag, name] of [["p", "title"], ["hson-part", "at"], ["hson-part", "data:payload"]]) {
      reject(`<${tag} ${name}=${value} next="kept"/>`, "HSON_ATTRIBUTE_QUOTES_REQUIRED", value);
      assert.doesNotThrow(() => parse_hson(`<${tag} ${name}=${JSON.stringify(value)}/>`));
      checks++;
    }
  }
  const references = ["%{bar}", "%{bar?}", "^{slide.title}", "^{slide.items[0].label?}",
    ...["a b", "/>[]<", "brace}key", 'quote"key', "slash\\key", "equals=key", "#{key}", "雪", "line\nkey", ""]
      .map(key => `^{slide[${JSON.stringify(key)}][0]?}`)];
  for (const value of references) {
    const source = `<main <p title=${value} id="after"/>/>`;
    assert.deepEqual(parse_hson(source), parse_hson(`<main <p title=${JSON.stringify(value)} id="after"/>/>`));
    const token = tokenize_hson(source).find(token => token.kind === "OPEN" && token.tag === "p");
    assert.equal(token?.kind, "OPEN");
    if (token?.kind !== "OPEN") throw new Error("Missing element token");
    const attr = token.rawAttrs[0]!;
    assert.deepEqual(attr.value, { text: value, quoted: false });
    assert.equal(source.slice(attr.start.index, attr.end.index + 1), `title=${value}`);
    checks++;
  }
  const boundaryKeys = ["a b", "a>b", "a<b", "a/>b", 'quote" > key', String.raw`slash\ > key`];
  const boundaryReferences = boundaryKeys.map(key => `^{slide[${JSON.stringify(key)}]}`);
  for (const value of ["%{name}", "%{name?}", ...boundaryReferences]) {
    for (const content of ['"Hello"', '<b/>']) {
      const source = `<p title=${value}${content}/>`;
      assert.deepEqual(parse_hson(source), parse_hson(`<p title=${JSON.stringify(value)} ${content}/>`));
      const tokens = tokenize_hson(source);
      assert.deepEqual(documentTokens(source), tokens);
      const token = tokens[0];
      if (token?.kind !== "OPEN") throw new Error("Missing compact element token");
      assert.deepEqual(token.rawAttrs[0]?.value, { text: value, quoted: false });
      assert.equal(token.rawAttrs[0]?.end.index, source.indexOf(value) + value.length - 1);
      assert.deepEqual(parse_hson_with_provenance(source).provenance.range({
        kind: "attribute", owner: [0], name: "title", role: "value",
      }), { start: 9, end: 9 + value.length });
      checks++;
    }
  }
  for (const value of ["%{name}suffix", "%{a}%{b}"]) for (const content of ["", '"Hello"', '<b/>']) {
    for (const scan of [parse_hson, documentTokens]) {
      reject(`<p title=${value}${content}/>`, "HSON_ATTRIBUTE_QUOTES_REQUIRED", value, scan);
    }
  }
  const malformedReferences = [...boundaryReferences.map(value => value.slice(0, -1) + ".}"),
    '^{slide["a b"}', String.raw`^{slide["bad\q>b"]}`];
  for (const value of malformedReferences) {
    for (const source of [`<p title=${value} next="ok"/>`, `<main\r\n <p title=${value} next="ok"/>/>`,
      `<p title=${value}"Hello"/>`, `<p title=${value}`]) {
      for (const scan of [parse_hson, documentTokens]) {
        reject(source, "HSON_PART_REFERENCE_INVALID", value, scan);
      }
    }
  }
  for (const value of ["%{}", "%{bar", "^{bar..x}", "^{bar[01]}", "^{bar[-1]}", "^{bar[9007199254740992]}",
    '^{bar["bad\\q"]}', "^{bar?x}", "#{bar}"]) {
    reject(`<p title=${value}/>`, "HSON_PART_REFERENCE_INVALID", value);
  }
  reject('<p title=%{bar', "HSON_PART_REFERENCE_INVALID", "%{bar");
  reject('<p title=/>', "HSON_ELEMENT_ATTRIBUTE_VALUE_INVALID");
  reject("<p title='one'/>", "HSON_QUOTE_KIND_UNSUPPORTED");
  reject(String.raw`<p title="bad\q"/>`, "invalid-json-escape");
  reject('<p title="unfinished/>', "HSON_STRING_UNTERMINATED");
  reject('<p title=%{bar}id="next"/>', "HSON_ATTRIBUTE_QUOTES_REQUIRED", "%{bar}id=");
  assert.throws(() => parse_hson('<main\r\n <p title=雪/>/>'), error => {
    assert.deepEqual(read_transform_error_details(error)?.source, { index: 17, line: 2, column: 11 });
    return true;
  });
  assert.doesNotThrow(() => parse_hson('<p title="" id="a"class="b" disabled/>'));
  assert.equal(Hson.document`<p part:optional="part:optional"/>`, '<p part:optional/>');
  reject('<p hson:part="hson:part"/>', "HSON_PART_DECLARATION_INVALID");
  assert.throws(() => parse_hson('<hson-part ^{body} at=leaf/>'), /Structural hson-part/);
  checks += 4;

  for (const run of [() => Hson.document`<p title=${"x"}/>`, () => Hson.document`<p title=pre${"x"}/>`,
    () => Hson.document`<p title=%{${"bar"}}/>`, () => Hson.document`<p title=^{data["${"key"}"]}/>`,
    () => Hson.document`<hson-part at=components/${"leaf"}/>`]) {
    assert.throws(run, error => read_transform_error_details(error)?.code === "HSON_INTERPOLATION_POSITION_INVALID");
    checks++;
  }
  assert.equal(Hson.document`<p title="${false}"/>`, '<p title="false"/>');
  assert.equal(Hson.document`<p title="pre${null}${2}post"/>`, '<p title="prenull2post"/>');
  assert.throws(() => Hson.document`<p title="${undefined}"/>`, error => read_transform_error_details(error)?.code === "HSON_QUOTED_INTERPOLATION_STRING_REQUIRED");
  assert.deepEqual(Hson.data.materialize(Hson.data`<n 2 enabled true items «null, -0»>`), { n: 2, enabled: true, items: [null, -0] });
  const node = hsonTransform.fromHson('<p title="literal\\\\n"/>').toNode();
  assert.deepEqual(hsonTransform.fromBinary(hsonTransform.fromNode(node).toBinary().serialize()).toNode(), node);
  assert.equal(hsonTransform.fromNode(node).toHson().serialize(), '<p title="literal\\\\n"/>');
  checks += 6;

  const part = (document: string): { kind: "document"; document: string } => ({ kind: "document", document });
  for (const quoted of [false, true]) {
    const operand = (value: string) => quoted ? JSON.stringify(value) : value;
    const map = hsonLiveMap.fromLibraries({ components: { parts: {
      outer: part(`<section hson:part rows:data=${operand('%{items}')} content:doc=${operand('%{body}')} title=${operand('%{title}')}
        <b for:item:index=${operand('^{rows}')} data-index=${operand('^{index}')} "^{item.label}"/>
        <hson-part at=${operand('leaf')} title=${operand('^{rows[0].label}')} data:info=${operand('^{rows[0]}')}/>
        <hson-part ^{content}/>
        <i part:optional title=${operand('%{absent?}')}/>
        <aside lib="unresolvable/a/b" at="anything/a/b"/>/>`),
      leaf: part(`<p hson:part info:data=${operand('%{info}')} title=${operand('%{title}')} "^{info.label}"/>`),
    } }, page: { document: `<hson-part lib=${operand('components')} at=${operand('outer')} title="Heading"
      data:items=${JSON.stringify('«<label "item">»')} doc:body=${JSON.stringify('<i "body"/>')}/>` } });
    assert.equal(map.doc.must('page').render(), '<section title="Heading"><b data-index="0">item</b><p title="item">item</p><i>body</i><aside at="anything/a/b" lib="unresolvable/a/b"></aside></section>');
    const qualified = hsonLiveMap.fromLibraries({ components: { parts: { leaf: part('<p hson:part title=%{bar}/>' ) } },
      page: { document: `<hson-part at=${operand('components/leaf')} bar="whole"/>` } });
    assert.equal(qualified.doc.must('page').render(), '<p title="whole"></p>');
    checks += 2;
  }
  const library = 'part 雪', member = 'na "& 雪';
  const unusual = hsonLiveMap.fromLibraries({ [library]: { parts: { [member]: part('<p hson:part "kept"/>') } },
    page: { document: `<hson-part lib=${JSON.stringify(library)} at=${JSON.stringify(member)}/>` } });
  assert.equal(unusual.doc.must('page').render(), '<p>kept</p>');
  return checks + 1;
}
