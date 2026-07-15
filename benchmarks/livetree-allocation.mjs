import { performance } from "node:perf_hooks";
import { LiveTree } from "../dist/index.js";
import { _CREATE_NODE } from "../dist/diagnostics/index.js";

const count = Number(process.argv[2] ?? 1000);
const mode = process.argv[3] ?? "bare";

function collect() {
  for (let index = 0; index < 6; index += 1) globalThis.gc?.();
}

function census(roots) {
  const seen = new Set();
  const stack = [...roots];
  let functions = 0;
  let objects = 0;

  while (stack.length > 0) {
    const value = stack.pop();
    if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) continue;
    seen.add(value);
    if (typeof value === "function") functions += 1;
    else objects += 1;

    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) stack.push(descriptor.value);
      else {
        if (descriptor?.get) stack.push(descriptor.get);
        if (descriptor?.set) stack.push(descriptor.set);
      }
    }
  }

  return { functions, objects };
}

collect();
const before = process.memoryUsage().heapUsed;
const started = performance.now();
const trees = Array.from({ length: count }, () => new LiveTree(_CREATE_NODE({ $_tag: "div" })));
const constructionMs = performance.now() - started;
const surfaces = [];

if (mode === "find") trees.forEach((tree) => surfaces.push(tree.find));
if (mode === "findAll") trees.forEach((tree) => surfaces.push(tree.findAll));
if (mode === "listen") trees.forEach((tree) => surfaces.push(tree.listen));
if (mode === "listenTouch") trees.forEach((tree) => void tree.listen);
if (mode === "css") trees.forEach((tree) => surfaces.push(tree.css));

collect();
const after = process.memoryUsage().heapUsed;
const first = trees[0];
const ownValues = Object.values(Object.getOwnPropertyDescriptors(first))
  .flatMap((descriptor) => "value" in descriptor ? [descriptor.value] : []);

console.log(JSON.stringify({
  count,
  mode,
  constructionMs,
  retainedHeapBytes: after - before,
  ownProperties: Object.keys(first).length,
  ownFunctionProperties: ownValues.filter((value) => typeof value === "function").length,
  ...census([...trees, ...surfaces]),
}));
