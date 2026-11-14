import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const pause = () => new Promise(resolve => setTimeout(resolve, 100));
// Drive and inspect the rendered panel in the isolated test process only.
// The workbench is not patched and no internal editor/theme services are used.
export function monitor_appearance_ui(workspace, port) {
  let stopped = false, socket, sequence = 0;
  const pending = new Map(), contexts = new Map(), sessions = new Map();
  async function connect() {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    socket = new WebSocket(version.webSocketDebuggerUrl);
    socket.addEventListener("message", event => {
      const reply = JSON.parse(event.data);
      if (reply.method === "Runtime.executionContextCreated") {
        const entries = contexts.get(reply.sessionId) ?? [];
        entries.push(reply.params.context.id); contexts.set(reply.sessionId, entries);
      }
      if (reply.method === "Runtime.executionContextsCleared") contexts.delete(reply.sessionId);
      const handler = pending.get(reply.id);
      if (handler) { pending.delete(reply.id); reply.error ? handler.reject(new Error(reply.error.message)) : handler.resolve(reply.result); }
    });
    socket.addEventListener("close", () => { for (const handler of pending.values()) handler.reject(new Error("Renderer closed")); pending.clear(); });
    await new Promise((accept, reject) => { socket.addEventListener("open", accept, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  }
  async function send(method, params = {}, sessionId) {
    const id = ++sequence;
    const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    socket.send(JSON.stringify({ id, method, params, sessionId }));
    return response;
  }
  async function targets() {
    if (!socket) await connect();
    const { targetInfos } = await send("Target.getTargets");
    for (const target of targetInfos.filter(target => ["page", "iframe"].includes(target.type))) {
      if (sessions.has(target.targetId)) continue;
      const { sessionId } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
      sessions.set(target.targetId, { sessionId, url: target.url });
      await send("Runtime.enable", {}, sessionId);
    }
  }
  async function evaluate(expression, sessionId, contextId) {
    const result = await send("Runtime.evaluate", { expression, contextId, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  async function workbench() {
    await targets();
    const target = [...sessions.values()].find(target => target.url.includes("workbench"));
    if (!target) throw new Error("Workbench unavailable");
    return target.sessionId;
  }
  async function panel() {
    await targets();
    for (const [sessionId, ids] of contexts) for (const contextId of ids) {
      try {
        if (await evaluate("!!document.getElementById('foreground')", sessionId, contextId)) return { sessionId, contextId };
      } catch {}
    }
    throw new Error("Appearance controls unavailable");
  }
  async function perform(request) {
    if (["layout", "screenshot", "focus-editor", "text-style"].includes(request.action)) {
      const sessionId = await workbench();
      if(request.action === 'text-style') return evaluate(`(() => {
        const span=[...document.querySelectorAll('.view-line span')].find(span=>span.childNodes.length===1&&span.firstChild.nodeType===Node.TEXT_NODE&&span.textContent.replaceAll(String.fromCharCode(160),' ').includes(${JSON.stringify(request.needle)}));
        if(!span)throw new Error('Text span unavailable');const style=getComputedStyle(span);
        return {color:style.color,fontStyle:style.fontStyle,fontWeight:style.fontWeight,textDecoration:style.textDecorationLine};
      })()`,sessionId);
      if (request.action === "focus-editor") {
        await send("Page.bringToFront", {}, sessionId);
        return evaluate(`(() => {
          const editor = [...document.querySelectorAll('.monaco-editor')].find(editor => editor.getBoundingClientRect().width > 100 && editor.querySelector('.view-lines'));
          const input = editor.querySelector('textarea.inputarea, .native-edit-context');
          input.focus(); return {active: document.activeElement.className, focused: document.hasFocus()};
        })()`, sessionId);
      }
      if (request.action === "screenshot") {
        const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
        await writeFile(join(workspace, request.name + ".png"), Buffer.from(data, "base64"));
        return { screenshot: request.name + ".png" };
      }
      return evaluate(`JSON.stringify([...document.querySelectorAll('.editor-group-container')].map(group => {
        const rect = group.getBoundingClientRect();
        return {x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          controls: group.textContent.includes('Hson Appearance'), native: !!group.querySelector('.monaco-editor .view-lines')};
      }))`, sessionId).then(JSON.parse);
    }
    const { sessionId, contextId } = await panel();
    return evaluate(`(${function (request) {
      if (request.action === "input") {
        const input = document.getElementById(request.control);
        input.focus(); input.value = request.value;
        input.dispatchEvent(new Event("input", { bubbles: true })); input.blur();
      } else if (request.action === "click") document.getElementById(request.control).click();
      return { status: document.getElementById("status").textContent,
        saved: document.getElementById("saved").getAttribute("aria-pressed"),
        error: document.getElementById("error").textContent,
        values: Object.fromEntries([...document.querySelectorAll('input,select')].map(input=>[input.id,input.value])),
        targets: [...document.getElementById('target').options].map(option=>({value:option.value,label:option.textContent})) };

    }.toString()})(${JSON.stringify(request)})`, sessionId, contextId);
  }
  const done = (async () => {
    let last;
    while (!stopped) {
      const request = await readFile(join(workspace, "appearance-ui-request.json"), "utf8").then(JSON.parse).catch(() => undefined);
      if (!request || request.id === last) { await pause(); continue; }
      last = request.id;
      let value, error;
      for (let attempt = 0; attempt < 120 && !stopped; attempt++) {
        try { value = await perform(request); error = undefined; break; } catch (cause) { error = String(cause); await pause(); }
      }
      await writeFile(join(workspace, "appearance-ui-response.json"), JSON.stringify({ id: request.id, value, error }));
    }
  })();
  return { done, stop() { stopped = true; socket?.close(); } };
}
