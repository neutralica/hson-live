import { performance } from "node:perf_hooks";

import { produce_document_diagnostics } from "../src/document-diagnostics.js";

function hsonDocument(memberCount: number): string {
  return `<root "${"value ".repeat(memberCount * 10)}">`;
}

function typeScriptDocument(templateCount: number): string {
  const templates = Array.from(
    { length: templateCount },
    (_, index) => `const value${index} = hson\`<item${index} "value ${index}">\`;`,
  );
  return ['import { hson } from "hson-live";', ...templates].join("\n");
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measure(
  languageId: string,
  fileName: string,
  text: string,
  iterations = 12,
): Readonly<{ bytes: number; medianMilliseconds: number }> {
  const input = { languageId, fileName, text };
  for (let index = 0; index < 3; index += 1) produce_document_diagnostics(input);
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    const diagnostics = produce_document_diagnostics(input);
    const end = performance.now();
    if (diagnostics.length !== 0) throw new Error(`${fileName} benchmark fixture is invalid`);
    samples.push(end - start);
  }
  return Object.freeze({
    bytes: Buffer.byteLength(text),
    medianMilliseconds: Number(median(samples).toFixed(3)),
  });
}

const results = {
  hson: measure("hson", "/fixtures/typical.hson", hsonDocument(100)),
  typescript: {
    small: measure("typescript", "/fixtures/small.ts", typeScriptDocument(1)),
    medium: measure("typescript", "/fixtures/medium.ts", typeScriptDocument(40)),
    large: measure("typescript", "/fixtures/large.ts", typeScriptDocument(200)),
  },
};

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
