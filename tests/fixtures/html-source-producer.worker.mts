import { parentPort } from "node:worker_threads";
import { hsonTransform } from "../../src/api/transform/transform.facade.ts";
import { scalarHtmlFixtures, memberHtmlFixtures, arrayHtmlFixtures, mixedSvgFixtures, invalidSvgFixtures, invalidHtmlFixtures, svgSourceFixtures } from "./html-source-producer-fixtures.mts";
import assert from 'node:assert/strict';
import { TransformError } from '../../src/core/errors.ts';

for (const source of [...invalidSvgFixtures, ...invalidHtmlFixtures, '<svg/><p hson:quid="000000001"/>']) {
  assert.throws(() => hsonTransform.fromTrustedHtml(source), TransformError);
}

parentPort?.postMessage([...scalarHtmlFixtures, ...memberHtmlFixtures, ...arrayHtmlFixtures, ...mixedSvgFixtures, ...svgSourceFixtures].map(fixture => {
  const source = hsonTransform.fromTrustedHtml(fixture.source);
  source.toHson().serialize(); source.toBinary().serialize();
  return source.toNode();
}));
