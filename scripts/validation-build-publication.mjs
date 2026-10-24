// Root-build-only observation of the two existing dist writers. Record the
// producer's intended bytes, never an inventory/digest of surviving disk files.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative, sep } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { isMainThread } from "node:worker_threads";

const digest = text => createHash("sha256").update(text).digest("hex");
const root = process.env.HSON_VALIDATION_ROOT;
const evidence = process.env.HSON_VALIDATION_BUILD_PUBLICATION;
const entry = resolve(process.argv[1] ?? "");
const args = process.argv.slice(2);
const producer = root && process.cwd() === root && (entry === resolve(root, "scripts/hson-schema.mts")
  && args.join(" ") === "build --project tsconfig.json" ? "compiler"
  : entry === resolve(root, "scripts/build-hson-schema-cli.mjs") && args.length === 0 ? "cli" : null);
if (isMainThread && evidence && producer) {
  const outputs = new Map();
  const write = fs.writeFileSync;
  fs.writeFileSync = function (path, text, options) {
    if (typeof path !== "string") throw new Error("Unsupported root build publication path");
    const absolute = resolve(path);
    if (!absolute.startsWith(resolve(root, "dist") + sep)) return write(path, text, options);
    // Both reviewed producers publish their prepared strings with default UTF-8
    // writes. A changed write form requires review rather than unproved reuse.
    if (typeof text !== "string" || options !== undefined) throw new Error("Unsupported root build publication write");
    const expected = digest(text);
    const result = write(path, text);
    outputs.set(relative(root, absolute), expected);
    return result;
  };
  syncBuiltinESMExports();
  process.once("exit", exitStatus => fs.appendFileSync(evidence,
    JSON.stringify({ producer, exitStatus, outputs: [...outputs] }) + "\n"));
}

export function assertRootBuildPublication(root, evidence) {
  const publications = fs.readFileSync(evidence, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  if (publications.length !== 2 || publications[0].producer !== "compiler" || publications[1].producer !== "cli"
    || publications.some(record => record.exitStatus !== 0 || !record.outputs.length)) {
    throw new Error("Missing successful root build publication evidence");
  }
  // The CLI is a later legitimate writer. Final generation owns .hson, whose
  // manifest and publication are checked by the existing Schema verifier.
  const expected = new Map(publications.flatMap(record => record.outputs));
  for (const [path, content] of expected) {
    const absolute = resolve(root, path);
    if (!absolute.startsWith(resolve(root, "dist") + sep)) throw new Error("Invalid root build publication path");
    if (!fs.existsSync(absolute)) throw new Error(`Missing published root build output: ${path}`);
    if (digest(fs.readFileSync(absolute)) !== content) throw new Error(`Modified published root build output: ${path}`);
  }
}
