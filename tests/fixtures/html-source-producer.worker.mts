import { parentPort } from "node:worker_threads";
import { hsonTransform } from "../../src/api/transform/transform.facade.ts";
import { htmlQuotingFixtures, invalidHtmlQuotingFixtures, scalarHtmlFixtures, memberHtmlFixtures, arrayHtmlFixtures, mixedSvgFixtures, invalidSvgFixtures, invalidHtmlFixtures, svgSourceFixtures } from "./html-source-producer-fixtures.mts";
import assert from 'node:assert/strict';
import { TransformError } from '../../src/core/errors.ts';
import { canonical_hson_graph_equal } from '../../src/core/canonical-hson-equal.ts';
import { detach_hson_root_value } from '../../src/api/transform/utils/node-utils/detach-hson-root-value.ts';

for (const source of [...invalidHtmlQuotingFixtures, ...invalidSvgFixtures, ...invalidHtmlFixtures, '<svg/><p hson:quid="000000001"/>']) {
  assert.throws(() => hsonTransform.fromTrustedHtml(source), TransformError);
}

assert.equal(typeof globalThis.document, 'undefined');
for (const fixture of htmlQuotingFixtures) {
  const canonical = hsonTransform.fromNode(detach_hson_root_value(fixture.graph)).toHson().noBreak().serialize();
  for (const input of [fixture.source, fixture.quoted]) {
    const outputs = [hsonTransform.fromTrustedHtml(input)];
    if (fixture.untrusted) outputs.push(hsonTransform.fromUntrustedHtml(input));
    for (const output of outputs) {
      assert.equal(canonical_hson_graph_equal(output.toNode(), fixture.graph), true, fixture.id);
      assert.equal(output.toHson().noBreak().serialize(), canonical, fixture.id);
    }
  }
}
assert.throws(() => hsonTransform.fromHson('<div class=column/>').toNode(), error =>
  error instanceof TransformError && error.code === 'HSON_ATTRIBUTE_QUOTES_REQUIRED');

parentPort?.postMessage([...scalarHtmlFixtures, ...memberHtmlFixtures, ...arrayHtmlFixtures, ...mixedSvgFixtures, ...svgSourceFixtures].map(fixture => {
  const source = hsonTransform.fromTrustedHtml(fixture.source);
  source.toHson().serialize(); source.toBinary().serialize();
  return source.toNode();
}));
