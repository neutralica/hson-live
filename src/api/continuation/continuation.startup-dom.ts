/** A bounded prepublication checkpoint of the selected native subtree. Recovery
 * may retire graph nodes, so rollback retains native objects independently of
 * Mirror correspondence. It never recreates an Element or a text node. */
export function capture_startup_dom(root: Element): () => void {
  type Attempt = (complete: () => boolean, mutate: () => void) => void;
  const restore: Array<(attempt: Attempt) => void> = [];
  const verify: Array<() => boolean> = [];
  const parent = root.parentNode;
  const siblings = Array.from(parent?.childNodes ?? []);
  const next = siblings[siblings.indexOf(root) + 1] ?? null;
  const rootRestored = () => parent == null ? root.parentNode == null
    : root.parentNode === parent && root.nextSibling === next;
  verify.push(rootRestored);
  restore.push(attempt => attempt(rootRestored, () => {
    if (parent == null) root.parentNode?.removeChild(root);
    else parent.insertBefore(root, next);
  }));
  const visit = (node: Node): void => {
    const children = Array.from(node.childNodes ?? []);
    if (node.nodeType === 1) {
      const element = node as Element;
      const attrs = element.getAttributeNames().map(name => ({ name, value: element.getAttribute(name)!,
        namespace: element.getAttributeNode?.(name)?.namespaceURI ?? null }));
      verify.push(() => {
        const names = element.getAttributeNames();
        return names.length === attrs.length && attrs.every((attr, index) => names[index] === attr.name
          && element.getAttribute(attr.name) === attr.value
          && (element.getAttributeNode?.(attr.name)?.namespaceURI ?? null) === attr.namespace);
      });
      restore.push(attempt => {
        const names = element.getAttributeNames();
        const reorder = names.length !== attrs.length || names.some((name, index) => name !== attrs[index]?.name);
        if (reorder) for (const name of names) attempt(() => !element.hasAttribute(name), () => element.removeAttribute(name));
      });
      for (const attr of attrs) restore.push(attempt => attempt(() => element.getAttribute(attr.name) === attr.value
        && (element.getAttributeNode?.(attr.name)?.namespaceURI ?? null) === attr.namespace, () => {
        if (attr.namespace === null) element.setAttribute(attr.name, attr.value);
        else element.setAttributeNS(attr.namespace, attr.name, attr.value);
      }));
      if (element.localName === "template") visit((element as HTMLTemplateElement).content);
    } else if (node.nodeType === 3 || node.nodeType === 8) {
      const value = node.nodeValue;
      verify.push(() => node.nodeValue === value);
      restore.push(attempt => attempt(() => node.nodeValue === value, () => { node.nodeValue = value; }));
    }
    if (node.childNodes !== undefined) {
      verify.push(() => node.childNodes.length === children.length
        && children.every((child, index) => node.childNodes[index] === child && child.parentNode === node));
      restore.push(attempt => {
        for (const child of Array.from(node.childNodes)) if (!children.includes(child)) {
          attempt(() => child.parentNode !== node, () => node.removeChild(child));
        }
      });
      children.forEach((child, index) => restore.push(attempt => attempt(
        () => node.childNodes[index] === child && child.parentNode === node,
        () => { node.insertBefore(child, node.childNodes[index] ?? null); },
      )));
    }
    for (const child of children) visit(child);
  };
  visit(root);
  return () => {
    const failures: unknown[] = [];
    const attempt: Attempt = (complete, mutate) => {
      const causes: unknown[] = [];
      // A throwing native call may already have completed its mutation. Inspect
      // the DOM before retrying; at most two calls are allowed per operation.
      for (let tries = 0; tries < 2; tries++) {
        try { if (complete()) return; mutate(); }
        catch (cause) { causes.push(cause); }
      }
      try { if (complete()) return; }
      catch (cause) { causes.push(cause); }
      failures.push(...causes);
    };
    for (const step of restore) {
      try { step(attempt); } catch (cause) { failures.push(cause); }
    }
    let incomplete = false;
    for (const complete of verify) {
      try {
        if (complete()) continue;
        failures.push(new Error("Startup DOM checkpoint does not match its original state."));
      }
      catch (cause) { failures.push(cause); }
      incomplete = true;
    }
    // Transient exceptions are resolved only by a complete final checkpoint
    // match. Persistent faults must not be mistaken for successful rollback.
    if (incomplete) throw new AggregateError(failures, "Hosted startup DOM restoration incomplete.");
  };
}
