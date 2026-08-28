import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { TrustedSchemaDiagnosticRuntime } from "../src/internal/trusted-schema-diagnostics/runtime.ts";
import { TrustedSchemaInfrastructureError, TrustedSchemaNodeSupervisor } from "../src/internal/trusted-schema-diagnostics/node-supervisor.ts";
import type { TrustedSchemaRequest } from "../src/internal/trusted-schema-diagnostics/protocol.ts";
import { schemaStatusTooltip } from "../editors/vscode-hson/src/diagnostic-messages.ts";

class MessageProcess extends EventEmitter {
  connected = true;
  killed = false;
  send(request: TrustedSchemaRequest, callback: (error: Error | null) => void): void {
    callback(null);
    if (request.type === "handshake") queueMicrotask(() => this.emit("message", { protocolVersion: 1,
      runtimeGeneration: request.runtimeGeneration, requestId: request.requestId, type: "ready" }));
  }
  kill(): void { this.connected = false; this.killed = true; }
}

export async function check_runtime_messages(check: (name: string, run: () => Promise<void>) => Promise<void>): Promise<void> {
  const base = { protocolVersion: 1, runtimeGeneration: 1, requestId: "review" };
  const expect = (actual: string | undefined, expected: string): void => {
    assert.equal(actual, expected);
    assert.equal(schemaStatusTooltip("runtime-failed", actual), expected);
  };
  await check("runtime exact protocol mismatch", async () => {
    expect((await new TrustedSchemaDiagnosticRuntime(1).handle({ ...base, protocolVersion: 9, type: "ping" })).message, "Unsupported trusted Schema diagnostics protocol.");
  });
  await check("runtime exact stale generation", async () => {
    expect((await new TrustedSchemaDiagnosticRuntime(1).handle({ ...base, runtimeGeneration: 2, type: "ping" })).message, "Stale runtime generation.");
  });
  await check("runtime exact unavailable correspondence", async () => {
    expect((await new TrustedSchemaDiagnosticRuntime(1).handle({ ...base, type: "associate", associationId: "missing" })).message, "No proven direct construction/attachment correspondence.");
  });
  await check("runtime exact configured identity mismatch and reload failure", async () => {
    const runtime = new TrustedSchemaDiagnosticRuntime(1);
    const request = { ...base, type: "load" as const, hsonModuleUrl: "data:text/javascript,export const hson={}", moduleUrl: "data:text/javascript,export {}" };
    expect((await runtime.handle(request)).message, "Configured runtime is not the D1 validator's supported runtime instance.");
    expect((await runtime.handle(request)).message, "D1 requires a new generation to load another project.");
  });
  await check("runtime exact non-Error module failure", async () => {
    expect((await new TrustedSchemaDiagnosticRuntime(1).handle({ ...base, type: "load", hsonModuleUrl: new URL("../src/hson.ts", import.meta.url).href,
      moduleUrl: "data:text/javascript,throw 42" })).message, "Project module failed to load.");
  });
  await check("supervisor exact trust gate", async () => {
    const owner = new TrustedSchemaNodeSupervisor({ trust: { enabled: false, workspaceTrusted: true } });
    try { await assert.rejects(owner.start(), error => {
      assert.ok(error instanceof TrustedSchemaInfrastructureError);
      expect(error.message, "Trusted Schema diagnostics require Workspace Trust and explicit enablement.");
      return true;
    }); } finally { owner.dispose(); }
  });
  await check("supervisor exact crash, retirement and restart budget", async () => {
    const process = new MessageProcess();
    const owner = new TrustedSchemaNodeSupervisor({ trust: { enabled: true, workspaceTrusted: true }, maxRestarts: 0, spawnRuntime: () => process });
    const reasons: string[] = [];
    owner.onRetired(reason => reasons.push(reason.message));
    try {
      await owner.start();
      process.emit("disconnect");
      expect(reasons[0], "Trusted Schema runtime disconnected.");
      await assert.rejects(owner.start(), error => {
        assert.ok(error instanceof TrustedSchemaInfrastructureError);
        expect(error.message, "Trusted Schema runtime restart budget exhausted; create a new owner to retry.");
        return true;
      });
    } finally { owner.dispose(); }
  });
  await check("supervisor timeout template passes verbatim to tooltip", async () => {
    const owner = new TrustedSchemaNodeSupervisor({ trust: { enabled: true, workspaceTrusted: true }, validationDeadlineMs: 10, spawnRuntime: () => new MessageProcess() });
    try {
      await owner.start();
      await assert.rejects(owner.request({ type: "ping" }), error => {
        assert.ok(error instanceof TrustedSchemaInfrastructureError);
        assert.equal(error.code, "REQUEST_TIMEOUT");
        assert.match(error.message, /^Trusted Schema request timed out after \d+ms\.$/);
        assert.equal(schemaStatusTooltip("runtime-failed", error.message), error.message);
        return true;
      });
    } finally { owner.dispose(); }
  });
  await check("supervisor exact disposed state", async () => {
    const owner = new TrustedSchemaNodeSupervisor({ trust: { enabled: true, workspaceTrusted: true } });
    owner.dispose();
    await assert.rejects(owner.start(), error => {
      assert.ok(error instanceof TrustedSchemaInfrastructureError);
      expect(error.message, "Trusted Schema supervisor is disposed.");
      return true;
    });
  });
}
