import { assertInventory, createInventory, repositoryRoot } from "./validation-inventory.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ordinary, gateCommands } from "./validation-config.mjs";
import { runStages } from "./validation-execution.mjs";

const mode = process.argv[2];
if (mode === "--preflight") {
  try {
    const inventory = assertInventory(createInventory());
    const gate = process.argv.find(arg => arg.startsWith("--gate="))?.slice(7);
    if (gate && !inventory.gates[gate]) throw new Error(`Unknown preflight gate: ${gate}`);
    if (process.argv.includes("--json")) console.log(JSON.stringify(inventory, null, 2));
    else console.log(JSON.stringify({ inventory: "passed", suites: inventory.suites.length,
      commands: Object.fromEntries(Object.entries(inventory.gates).map(([name, commands]) => [name, commands.length])),
      gateRequirements: inventory.gateRequirements, missingLegacyMetadata: inventory.metadataMissing.length,
      metadataPolicy: inventory.metadataPolicy, existingRepeatedBodies: inventory.duplicates }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
} else if (["check", "full", "extended"].includes(mode)) {
  const scripts = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")).scripts;
  const gates = Object.fromEntries(["check", "full", "extended"].map(gate => [gate, gateCommands(scripts, gate)]));
  const names = gates[mode];
  const stages = names.map((name, index) => ({ name, command: scripts[name],
    continueOnFailure: mode === "extended" || mode === "full" && index >= ordinary.length,
    timeout: mode === "extended" || mode === "full" && index >= ordinary.length ? 180_000 : 0 }));
  const result = await runStages({ root: repositoryRoot, mode, stages,
    preflight: () => assertInventory(createInventory()), configuration: { gates, commands: Object.fromEntries(names.map(name => [name, scripts[name]])) } });
  process.exitCode = result.exitStatus;
} else {
  console.error("Usage: run-current-acceptance.mjs check|full|extended|--preflight [--gate=full|extended|check] [--json]");
  process.exitCode = 1;
}
