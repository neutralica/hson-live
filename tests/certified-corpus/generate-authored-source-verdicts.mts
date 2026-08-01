import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  AUTHORED_VERDICT_DOCUMENT,
  renderAuthoredSourceVerdictTemplate,
} from "./authored-source-verdicts.mts";

function argumentValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const initialize = process.argv.includes("--initialize");
const requestedOutput = argumentValue("--output");
const canonicalPath = resolve(AUTHORED_VERDICT_DOCUMENT);

if (initialize === (requestedOutput !== undefined)) {
  throw new Error("Use exactly one of --initialize or --output <temporary-path>.");
}

const outputPath = initialize ? canonicalPath : resolve(requestedOutput!);

if (initialize) {
  if (existsSync(canonicalPath)) {
    throw new Error(`Refusing to overwrite the human-owned checklist: ${AUTHORED_VERDICT_DOCUMENT}`);
  }
} else {
  if (outputPath === canonicalPath) {
    throw new Error("--output may not target the human-owned checklist; use a temporary comparison file.");
  }
  const allowedTemporaryRoots = [resolve("/tmp"), resolve("/private/tmp"), resolve(tmpdir())];
  if (!allowedTemporaryRoots.some((root) => outputPath.startsWith(root + "/"))) {
    throw new Error("Comparison generation is restricted to a temporary directory.");
  }
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, renderAuthoredSourceVerdictTemplate(), "utf8");
console.log(outputPath);
