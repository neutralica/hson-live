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
        if (await evaluate("!!document.getElementById('catalog') && !!document.getElementById('open-scratchpad') && !!document.getElementById('foreground')", sessionId, contextId)) return { sessionId, contextId };
      } catch {}
    }
    throw new Error("Appearance controls unavailable");
  }
  async function perform(request) {
    if (request.action === "editor-key") {
      const sessionId = await workbench();
      await send("Page.bringToFront", {}, sessionId);
      const focused = await evaluate(`(() => {
        const editor = [...document.querySelectorAll('.monaco-editor')].find(node =>
          node.getBoundingClientRect().width > 100 && node.querySelector('.view-lines'));
        const input = editor?.querySelector('textarea.inputarea, .native-edit-context');
        input?.focus();
        return !!input && (document.activeElement === input || input.contains(document.activeElement));
      })()`, sessionId);
      if (!focused) throw new Error("Editor input is unavailable");
      const { key, code, text, modifiers, windowsVirtualKeyCode } = request;
      if (code === undefined) await send("Input.insertText", { text }, sessionId);
      else {
        await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text, modifiers, windowsVirtualKeyCode }, sessionId);
        await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode }, sessionId);
      }
      return {};
    }
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
    if(request.action==='native-pick'||request.action==='cancel-name') {
      const sessionId=await workbench();
      const ready=await evaluate(`document.activeElement?.tagName==='INPUT' && !!document.activeElement.closest('.quick-input-widget')`,sessionId);
      if(!ready)throw new Error('Quick pick not ready');
      if(request.action==='cancel-name'){
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);
        await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},sessionId);return {};
      }
      await send('Input.insertText',{text:request.label},sessionId);await pause();
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sessionId);
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sessionId);return {};
    }
    if (request.action === 'native-save-as') {
      const sessionId = await workbench();
      const ready = await evaluate(`(() => {const input=document.querySelector('input[aria-label="Folder path - Save As"]');if(!input || !input.value.includes('Hson '))return false;input.focus();input.select();return true;})()`,sessionId);
      if (!ready) throw new Error('Native Save As is not ready');
      await send('Input.insertText',{text:request.path},sessionId);
      await pause();
      const value=await evaluate('document.activeElement.value',sessionId);
      if(value!==request.path)throw new Error('Save As destination differs');
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sessionId);
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},sessionId);
      return {};
    }
    const { sessionId, contextId } = await panel();
    if (request.action === 'type-field') {
      await send('Page.bringToFront', {}, await workbench());
      await evaluate(`(() => { const node = document.getElementById(${JSON.stringify(request.control)}); node.scrollIntoView({block:'nearest'}); node.focus(); node.select(); })()`,sessionId,contextId);
      await send('Input.insertText', {text:request.value}, sessionId);
      if(!request.keepFocus) {
        await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sessionId);
        await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},sessionId);
      }
      return {};
    }
    if (request.action === 'type') {
      await send('Page.bringToFront', {}, await workbench());
      const activeControl = await evaluate('document.activeElement.id', sessionId, contextId);
      if (activeControl !== request.control) throw new Error('Cannot type into unfocused ' + request.control);
      await send('Input.insertText', {text:request.text}, sessionId);
      return {activeControl};
    }
    if (request.action === 'key') {
      await send('Input.dispatchKeyEvent', {type:'keyDown', key:request.key, code:request.key, windowsVirtualKeyCode:({Escape:27,Enter:13,Tab:9,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40})[request.key]}, sessionId);
      await send('Input.dispatchKeyEvent', {type:'keyUp', key:request.key, code:request.key, windowsVirtualKeyCode:({Escape:27,Enter:13,Tab:9,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40})[request.key]}, sessionId);
      return {};
    }
    if (request.action === 'key-activate' || request.action === 'shortcut') {
      const target = await workbench();
      await send('Page.bringToFront', {}, target);
      const focused = await evaluate(`(() => {
        const node = document.getElementById(${JSON.stringify(request.control)});
        for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.firstElementChild.contains(node))parent.open=true;node.scrollIntoView({block:'nearest'});node.focus();
        return document.activeElement === node;
      })()`, sessionId, contextId);
      if (!focused) throw new Error('Cannot focus ' + request.control);
      if(request.action==='shortcut'){
        const modifiers=4+(request.redo?8:0);
        await send('Input.dispatchKeyEvent',{type:'keyDown',key:request.redo?'Z':'z',code:'KeyZ',modifiers,windowsVirtualKeyCode:90},sessionId);
        await send('Input.dispatchKeyEvent',{type:'keyUp',key:request.redo?'Z':'z',code:'KeyZ',modifiers,windowsVirtualKeyCode:90},sessionId);return {focused};
      }
      await send('Input.dispatchKeyEvent', {type:'keyDown', key:'Enter', code:'Enter', text:'\r', windowsVirtualKeyCode:13}, sessionId);
      await send('Input.dispatchKeyEvent', {type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13}, sessionId);
      return {focused};
    }
    return evaluate(`(${function (request) {
      function reveal(node){for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!parent.firstElementChild.contains(node))parent.open=true;node.scrollIntoView({block:'nearest'});}
      if(request.action==='events'){
        if(!window.appearanceEvents){window.appearanceEvents=[];for(const type of ['focus','blur','pointerdown','keydown','input','change'])document.addEventListener(type,event=>{if(event.target?.type==='color')window.appearanceEvents.push({type,key:event.key,trusted:event.isTrusted,value:event.target.value,active:document.activeElement?.id,focused:document.hasFocus()});},true);}
        return window.appearanceEvents;
      }else if(request.action==='focus'){document.getElementById(request.control).focus();
      }else if(request.action==='confirm-revert'){if(!document.getElementById('revert-dialog').open)throw new Error('Confirmation not open');document.getElementById(request.cancel?'cancel-revert':'confirm-revert').click();
      }else if(request.action==='confirm-palette'){const dialog=document.getElementById('palette-dialog');if(!dialog.open)throw new Error('Palette confirmation not open');document.getElementById(request.cancel?'cancel-palette':'confirm-palette').click();
      }else if(request.action==='select-role'){
        const node=document.getElementById('role-'+request.role);reveal(node);if(node.getAttribute('aria-pressed')!=='true')node.click();
        const advanced=document.getElementById('advanced');if(request.advanced&&advanced.getAttribute('aria-expanded')!=='true')advanced.click();
      }else if(request.action==='details'){document.getElementById(request.control).open=request.open;
      }else if(request.action==='catalog-top'){document.getElementById('catalog').scrollTop=0;
      }else if(request.action==='metrics'){
        const catalog=document.getElementById('catalog'),box=catalog.getBoundingClientRect();
        const rows=[...document.querySelectorAll('.role-row')];
        return {activeControl:document.activeElement.id,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,catalogScrollWidth:catalog.scrollWidth,catalogClientWidth:catalog.clientWidth,
          obstructedRows:rows.filter(row=>{
            if(!row.getBoundingClientRect().height)return false;
            const inherit=row.querySelector('.inherit-check');
            if(inherit.scrollWidth>inherit.clientWidth+1||!inherit.querySelector('input').getBoundingClientRect().width)return true;
            const boxes=[...row.children].map(control=>control.getBoundingClientRect());
            return boxes.some((a,index)=>!a.width||!a.height||boxes.slice(index+1).some(b=>
              Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));
          }).map(row=>row.dataset.role),
          roles:rows.map(row=>row.dataset.role),editableRows:rows.filter(row=>!row.querySelector('.hex').disabled).length,visibleRows:rows.filter(row=>{const r=row.getBoundingClientRect();return r.top>=box.top&&r.bottom<=box.bottom&&r.height>0;}).length,
          firstRowTop:rows[0].getBoundingClientRect().top,headerBottom:document.querySelector('header').getBoundingClientRect().bottom,
          properties:[...document.querySelectorAll('#properties input,#properties select')].map(node=>node.id),
          groups:[...document.querySelectorAll('[data-group]')].map(node=>node.dataset.group),
          editorExample:[...document.querySelectorAll('.examples button')].find(node=>node.getAttribute('aria-pressed')==='true')?.id,
          saveDisabled:document.getElementById('save').disabled,inputInvalid:document.getElementById('foreground').getAttribute('aria-invalid'),
          editingMode:['dark','light'].find(mode=>document.getElementById(mode).getAttribute('aria-pressed')==='true'),
          previewMode:document.getElementById('previewMode').textContent,
          controlsColor:getComputedStyle(document.getElementById('save')).color,
          inputColor:getComputedStyle(document.getElementById('foreground')).color,
          effective:document.getElementById('effective').textContent,
          foreground:document.getElementById('foreground').value,foregroundCaret:document.getElementById('foreground').selectionStart,
          resetDisabled:document.getElementById('reset-foreground').disabled,intensityInvalid:document.getElementById('intensity').getAttribute('aria-invalid'),
          application:document.getElementById('scope-note').textContent,
          rowHeights:rows.map(row=>row.getBoundingClientRect().height),
          contextNote:document.getElementById('context-note').textContent,
          paletteMenuOpen:document.getElementById('management').open,saveOptionsOpen:document.getElementById('save-options').open,
          swatches:Object.fromEntries(rows.map(row=>{const swatch=row.querySelector('.swatch');return [row.dataset.role,{color:getComputedStyle(swatch).backgroundColor,hex:swatch.style.getPropertyValue('--swatch'),picker:row.querySelector('input[type=color]').value,inherit:row.querySelector('input[type=checkbox]').checked,source:row.querySelector('.from').value,acceptedSource:row.querySelector('.from').dataset.acceptedSource,sourceInvalid:row.querySelector('.from').getAttribute('aria-invalid'),disabled:row.querySelector('.from').disabled}];})),
          groupLabels:[...document.querySelectorAll('.group-heading')].map(node=>node.textContent),
          expanded:document.getElementById('inspector').hidden===false};
      }else if (request.action === "input") {
        const input = document.getElementById(request.control);
        reveal(input);if(!request.keepActive)input.focus();input.value = request.value;
        input.dispatchEvent(new Event("input", { bubbles: true })); if(!request.keepFocus&&!request.keepActive){if(input.type==='color')input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();}
      } else if (request.action === "blur") {document.getElementById(request.control).blur();
      } else if (request.action === "click") {const node=document.getElementById(request.control);reveal(node);node.click();}
      const family=['document','data'].find(id=>document.getElementById('context-'+id).getAttribute('aria-pressed')==='true');
      const editTarget=family?'override:'+family:document.getElementById('global-overrides').getAttribute('aria-pressed')==='true'?'override:all':document.getElementById('target').value;
      return {editTarget, saveLabel:document.getElementById('save').textContent, sharedPressed:document.getElementById('context-hson').getAttribute('aria-pressed'), status: document.getElementById("status").textContent,revertDisabled:document.getElementById("revert").disabled,
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
