import { hsonLiveMap } from "hson-live/livemap";

/** Run unchanged in Node, actual Workers, and Chromium. */
export function representation_markup_cases() {
  const equal = (actual: unknown, expected: unknown) => {
    if (actual !== expected) throw new Error(`Markup mismatch: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  };
  const cases: readonly (readonly [string, readonly number[] | undefined, string])[] = [
    ['<main/>', undefined, '<main></main>'],
    ['<html <head/> <body/>/>', undefined, '<html><head></head><body></body></html>'],
    ['<main/> <aside/>', undefined, '<main></main><aside></aside>'],
    ['"a&<b" "" "c"', undefined, 'a&amp;&lt;bc'],
    ['<main title="a&\\"b<" "a&<b"/>', undefined, '<main title="a&amp;&quot;b<">a&amp;&lt;b</main>'],
    ['<table <tr <td "cell"/>/>/>', [0], '<tr><td>cell</td></tr>'],
    ['<table <tr <td "cell"/>/>/>', [0, 0], '<td>cell</td>'],
    ['<table <tr <td "cell"/>/>/>', undefined, '<table><tr><td>cell</td></tr></table>'],
    ['<style "p::before { content: \'a&b\'; }"/>', undefined, '<style>p::before { content: \'a&b\'; }</style>'],
    ['<style "p::before { content: \'a&b\'; }"/>', [0], 'p::before { content: \'a&b\'; }'],
    ['<script src="a&b.js"/>', undefined, '<script src="a&amp;b.js"></script>'],
    ['<xmp "a&<b"/>', undefined, '<xmp>a&<b</xmp>'],
    ['<textarea "\\nA&<B"/>', undefined, '<textarea>\n&#10;A&amp;&lt;B</textarea>'],
    ['<textarea "\\nA&<B"/>', [0], '&#10;A&amp;&lt;B'],
    ['<textarea ""/>', undefined, '<textarea></textarea>'],
    ['<textarea ""/>', [0], ''],
    ['<textarea "a" "" "b"/>', undefined, '<textarea>ab</textarea>'],
    ['<title "a&<b"/>', undefined, '<title>a&amp;&lt;b</title>'],
    ['<pre "\\nA"/>', undefined, '<pre>\n\nA</pre>'],
    ['<svg viewBox="0 0 10 10" <linearGradient id="g"/>/>', [0], '<linearGradient id="g"></linearGradient>'],
    ['<svg <title "\\nA&b"/>/>', [0], '<title>\nA&amp;b</title>'],
    ['<svg <title "\\nA&b"/>/>', [0, 0], '\nA&amp;b'],
    ['<svg <foreignObject <DIV "a&b"/>/>/>', [0, 0], '<div>a&amp;b</div>'],
    ['<main @:subject "a" "" "b"/>', undefined, '<main>ab</main>'],
  ];
  for (const [document, path, expected] of cases) {
    const map = hsonLiveMap.fromLibraries({ page: { document } });
    const page = map.doc.must("page"), before = JSON.stringify(map.capture());
    equal(path === undefined ? page.snap() : page.at(path).snap(), expected);
    equal(path === undefined ? page.must.snap() : page.at(path).must.snap(), expected);
    equal(JSON.stringify(map.capture()), before);
    equal(map.rev, 0);
  }
  return cases.length;
}
