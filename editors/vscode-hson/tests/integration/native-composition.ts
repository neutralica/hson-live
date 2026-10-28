import * as vscode from "vscode";

// VS Code 1.96 added underscored custom requests and Uri-to-open-file mapping:
// https://github.com/microsoft/vscode/blob/1.96.0/extensions/typescript-language-features/src/commands/tsserverRequests.ts
// Earlier hosts must yield to native TS rather than publish Hson-only tokens.
const [major = 0, minor = 0] = vscode.version.split(".").map(Number);
export const nativeCompositionSupported = major > 1 || major === 1 && minor >= 96;
