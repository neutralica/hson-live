import { writeFile } from "node:fs/promises";
import { deterministic_livemap_operators } from "./all-operators.mts";
import { render_operator_artifact } from "./operator-catalog.mts";

const output = process.argv[2];
if (output === undefined) throw new Error("Expected an output path.");
await writeFile(output, render_operator_artifact(deterministic_livemap_operators), "utf8");
process.stdout.write(`${output}\n`);
