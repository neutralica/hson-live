#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXTENSION_ID,
  displayPath,
  discoverVsCodeCli,
  inspectStatus,
  installCurrentSource,
  packageCurrentSource,
} from "./vscode-local-lib.mjs";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(extensionRoot, "../..");

function sourceLabel(authority) {
  if (!authority) return "unverified";
  const short = authority.source.commit === "unknown" ? "unknown" : authority.source.commit.slice(0, 12);
  return `${short}${authority.source.dirty ? "-dirty" : ""}`;
}

function printStatus(result) {
  const packageState = result.packageState;
  const artifact = packageState.artifact;
  process.stdout.write([
    "Hson VS Code extension",
    "",
    `VS Code:      ${result.cli.channel} ${result.cli.version}`,
    `CLI:          ${result.cli.path}`,
    `Extension:    ${EXTENSION_ID}`,
    `Version:      ${packageState.manifest.version}`,
    "",
    `VSIX:         ${displayPath(packageState.vsixPath, repositoryRoot)}`,
    `SHA-256:      ${artifact?.vsixSha256 ?? "unavailable"}`,
    `Source:       ${sourceLabel(packageState.authority)}`,
    "",
    `Installed:    ${result.installedVersion ?? "absent"}`,
    `Build match:  ${result.buildMatch ? "yes" : "no"}`,
    `Status:       ${result.status}`,
    ...(result.status === "current" ? [] : [`Reason:       ${result.reason}`]),
    "",
  ].join("\n"));
}

async function main(command) {
  if (command === "package") {
    const result = await packageCurrentSource({ extensionRoot, repositoryRoot });
    process.stdout.write([
      "Hson VS Code extension packaged",
      "",
      `Extension: ${EXTENSION_ID}`,
      `Version:   ${result.manifest.version}`,
      `VSIX:      ${displayPath(result.canonicalVsix, repositoryRoot)}`,
      `SHA-256:   ${result.artifact.vsixSha256}`,
      `Source:    ${sourceLabel(result.authority)}`,
      "",
    ].join("\n"));
    return;
  }

  const cli = await discoverVsCodeCli();
  process.stdout.write(`Selected VS Code CLI: ${cli.path}\n`);
  if (command === "status") {
    printStatus(await inspectStatus({ extensionRoot, repositoryRoot, cli }));
    return;
  }
  if (command === "install") {
    const result = await installCurrentSource({ extensionRoot, repositoryRoot, cli });
    process.stdout.write([
      "Hson VS Code extension installed",
      "",
      `Extension: ${EXTENSION_ID}`,
      `Version:   ${result.manifest.version}`,
      `Status:    ${result.status}`,
      `VSIX:      ${displayPath(result.canonicalVsix, repositoryRoot)}`,
      `SHA-256:   ${result.artifact.vsixSha256}`,
      "",
      "Reload VS Code:",
      "  Developer: Reload Window",
      "",
    ].join("\n"));
    return;
  }
  throw new Error("usage: vscode-local.mjs package|install|status");
}

main(process.argv[2]).catch(error => {
  process.stderr.write(`Hson VS Code: ${error.stage ? error.message : `tooling failure: ${error.message}`}\n`);
  process.exitCode = 1;
});
