import { hson } from "../../../src/index.ts";

const messageListeners = new Set();
const closeListeners = new Set();
const socket = {
  send() {},
  close() { for (const listener of [...closeListeners]) listener(); },
  onMessage(listener) { messageListeners.add(listener); return () => messageListeners.delete(listener); },
  onClose(listener) { closeListeners.add(listener); return () => closeListeners.delete(listener); },
};

const client = hson.liveHost.client({ socket });
client.connect();
const action = client.action("echo", 1);
process.stdout.write(JSON.stringify({ clientId: client.clientId, requestId: action.request.requestId }));
