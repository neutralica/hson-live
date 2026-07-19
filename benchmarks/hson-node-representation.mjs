import { _CREATE_NODE } from "../dist/diagnostics/index.js";
import { hson } from "../dist/index.js";

const count = Number(process.argv[2] ?? 1000);
const mode = process.argv[3] ?? "simple";
const collect = () => {
  if (typeof globalThis.gc !== "function") throw new Error("Run with node --expose-gc");
  for (let index = 0; index < 6; index += 1) globalThis.gc();
};
const fixture = Object.fromEntries(Array.from(
  { length: 50 },
  (_, index) => [`key${index}`, { id: index, label: `item-${index}`, active: index % 2 === 0 }],
));

collect();
const before = process.memoryUsage().heapUsed;
const started = performance.now();
let retained;

switch (mode) {
  case "simple":
    retained = Array.from({ length: count }, () => _CREATE_NODE({ $_tag: "div" }));
    break;
  case "attrs":
    retained = Array.from({ length: count }, (_, index) => _CREATE_NODE({ $_tag: "div", $_attrs: { id: `n-${index}` } }));
    break;
  case "meta":
    retained = Array.from({ length: count }, (_, index) => _CREATE_NODE({ $_tag: "div", $_meta: { note: `n-${index}` } }));
    break;
  case "both":
    retained = Array.from({ length: count }, (_, index) => _CREATE_NODE({
      $_tag: "div",
      $_attrs: { id: `n-${index}` },
      $_meta: { note: `n-${index}` },
    }));
    break;
  case "parse":
    retained = Array.from({ length: count }, () => hson.fromJson(fixture).toNode());
    break;
  default:
    throw new Error(`Unknown representation benchmark mode: ${mode}`);
}

const constructionMs = performance.now() - started;
collect();
const retainedHeapBytes = process.memoryUsage().heapUsed - before;
const sample = retained[0];
const serializedSize = mode === "parse"
  ? hson.fromNode(sample).toHson().serialize().length
  : JSON.stringify(sample).length;

console.log(JSON.stringify({
  count,
  mode,
  constructionMs,
  retainedHeapBytes,
  ownProperties: Object.keys(sample).length,
  serializedSize,
}));
