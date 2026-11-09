import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertInventory, ordinary, gateCommands, rootBuildConsumers, rootBuildPrerequisites } from "./validation-config.mjs";
import { runStages } from "./validation-execution.mjs";
import { validateCommitted } from "./validate-staged.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

export async function runAcceptance(mode, options = {}) {
  const scripts = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")).scripts;
  const gates = Object.fromEntries(["check", "full", "extended", "commit"].map(gate => [gate, gateCommands(scripts, gate)]));
  const names = gates[mode];
  const stages = names.map((name, index) => ({ name, command: scripts[name],
    dependsOn: rootBuildConsumers.includes(name) ? ["build"] : [],
    continueOnFailure: mode === "extended" || mode === "full" && index >= ordinary.length,
    timeout: mode === "extended" || mode === "full" && index >= ordinary.length ? 180_000 : 0 }));
  return runStages({ root: repositoryRoot, mode, stages,
    preflight: async () => (await import("./validation-inventory.mjs")).createInventory(), checkInventory: assertInventory,
    rootBuildPrerequisites,
    configuration: { gates, rootBuildConsumers, rootBuildPrerequisites, commands: Object.fromEntries(names.map(name => [name, scripts[name]])) },
    ...options });
}

async function main() {
  const mode = process.argv[2];
  if (mode === "--preflight") {
    try {
      const { createInventory } = await import("./validation-inventory.mjs");
      const inventory = assertInventory(createInventory());
      const gate = process.argv.find(arg => arg.startsWith("--gate="))?.slice(7);
      if (gate && !inventory.gates[gate]) throw new Error(`Unknown preflight gate: ${gate}`);
      if (process.argv.includes("--json")) console.log(JSON.stringify(inventory, null, 2));
      else console.log(JSON.stringify({ inventory: "passed", suites: inventory.suites.length,
        commands: Object.fromEntries(Object.entries(inventory.gates).map(([name, commands]) => [name, commands.length])),
        gateRequirements: inventory.gateRequirements, missingLegacyMetadata: inventory.metadataMissing.length,
        metadataPolicy: inventory.metadataPolicy, existingRepeatedBodies: inventory.duplicates }));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  } else if (mode === "full") {
    process.exitCode = (await validateCommitted()).exitStatus;
  } else if (["check", "extended"].includes(mode)) {
    const result = await runAcceptance(mode);
    process.exitCode = result.exitStatus;
  } else {
    console.error("Usage: run-current-acceptance.mjs check|full|extended|--preflight [--gate=full|extended|check|commit] [--json]");
    process.exitCode = 1;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
