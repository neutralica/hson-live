import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";

/**
 * Strips all comments from a TypeScript source file and writes the result
 * to stdout.
 *
 * This script uses the TypeScript compiler API to parse the input file
 * into an AST and then re-print it with `removeComments: true`. The output
 * preserves valid TypeScript syntax, formatting, and line structure
 * (as determined by the printer), but removes:
 *
 * - Line comments (`// ...`)
 * - Block comments (`/* ... *\/`)
 * - JSDoc comments
 *
 * The script does NOT modify:
 * - Code semantics
 * - Identifiers, imports, or exports
 * - Type information
 *
 * Output is written to **stdout**, allowing shell redirection to a file.
 *
 * ---
 * CLI USAGE
 * ---
 *
 * This script expects **one positional argument**:
 *
 *   argv[2] — Path to the input TypeScript file
 *
 * The path may be:
 * - relative to the current working directory
 * - or absolute
 *
 * If the argument is missing, the script prints an error message and exits
 * with a non-zero status code.
 *
 * ---
 * EXAMPLES
 * ---
 *
 * Strip comments from a file and print to terminal:
 *
 *   node strip-comments.ts src/api/livetree/css-manager.ts
 *
 * Strip comments and write output to a new file:
 *
 *   node strip-comments.ts src/api/livetree/css-manager.ts > /tmp/css-manager.nocomments.ts
 *
 * Run via tsx (recommended for TypeScript scripts):
 *
 *   node --import tsx ./_scripts/strip-comments.ts src/api/livetree/css-manager.ts > ./_scripts/temp/css-manager.nocomments.ts
 *
 * ---
 * COPYABLE TEMPLATE
 * ---
 *
 * Replace the placeholder paths below with your actual locations.
 *
     node --import tsx 
      <* (INSERT PATH TO SCRIPT) *> 
     \
    <* (INSERT PATH TO INPUT .ts FILE) *> 
     \ > 
     <* (INSERT PATH TO OUTPUT FILE) *>
 *
 * 
 * 
  node --import tsx ./_scripts/strip-comments.ts \
   src/api/livetree/livetree-methods/animate.ts \
  > _scripts/temp/anim.nc.md
 * 
 * Example with concrete paths:
 *
 *   node --import tsx ./_scripts/strip-comments.ts \
 *       src/api/livetree/livetree-methods/css-manager.ts \
 *       > ./_scripts/temp/css-manager.nocomments.ts
 *
 * ---
 * NOTES
 * ---
 *
 * - The script does not overwrite files by itself; redirection (`>`) is
 *   handled by the shell.
 * - Formatting may differ slightly from the original source due to
 *   TypeScript printer normalization.
 * - This is intended for inspection, diffing, or analysis—not round-trip
 *   source preservation.
 */

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Missing input file path.");
  process.exit(1);
}

const absPath = resolve(process.cwd(), inputPath);
const text = readFileSync(absPath, "utf8");

const sf = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const printer = ts.createPrinter({
  newLine: ts.NewLineKind.LineFeed,
  removeComments: true,
});

process.stdout.write(printer.printFile(sf));