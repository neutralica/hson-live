class FakeNode {
  parentNode: FakeElement | FakeFragment | undefined;
  isConnected = false;

  remove(): void {
    this.parentNode?.removeChild(this);
  }
}

export class FakeText extends FakeNode {
  readonly nodeType = 3;
  public constructor(public data: string) { super(); }
}

class FakeChildList extends Array<FakeNode> {
  item(index: number): FakeNode | null { return this[index] ?? null; }
}

class FakeFragment extends FakeNode {
  readonly childNodes = new FakeChildList();
  appendChild(node: FakeNode): FakeNode { append_child(this, node); return node; }
  removeChild(node: FakeNode): FakeNode { remove_child(this, node); return node; }
}

class FakeStyle {
  cssText = "";
  readonly values = new Map<string, string>();
  setProperty(name: string, value: string): void { this.values.set(name, value); }
  removeProperty(name: string): void { this.values.delete(name); }
}

export class FakeElement extends FakeNode {
  readonly childNodes = new FakeChildList();
  readonly attrs = new Map<string, string>();
  readonly style = new FakeStyle();
  readonly ownerDocument = fakeDocument;
  readonly namespaceURI: string;
  replaceWrites = 0;
  failReplace = false;
  beforeReplace: (() => void) | undefined;

  public constructor(public readonly tagName: string, namespace = "http://www.w3.org/1999/xhtml") {
    super();
    this.namespaceURI = namespace;
  }

  appendChild(node: FakeNode): FakeNode {
    if (node instanceof FakeFragment) {
      for (const child of [...node.childNodes]) append_child(this, child);
      return node;
    }
    append_child(this, node);
    return node;
  }

  insertBefore(node: FakeNode, reference: FakeNode | null): FakeNode {
    if (node instanceof FakeFragment) {
      for (const child of [...node.childNodes]) this.insertBefore(child, reference);
      return node;
    }
    node.parentNode?.removeChild(node);
    const index = reference === null ? this.childNodes.length : this.childNodes.indexOf(reference);
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, node);
    node.parentNode = this;
    return node;
  }

  removeChild(node: FakeNode): FakeNode { remove_child(this, node); return node; }

  replaceChildren(...nodes: FakeNode[]): void {
    if (this.failReplace) throw new Error("forced structural DOM failure");
    this.beforeReplace?.();
    this.replaceWrites += 1;
    for (const child of [...this.childNodes]) remove_child(this, child);
    for (const node of nodes) this.appendChild(node);
  }

  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  getAttributeNames(): string[] { return [...this.attrs.keys()]; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  querySelectorAll(): FakeElement[] { return []; }
}

function append_child(parent: FakeElement | FakeFragment, node: FakeNode): void {
  node.parentNode?.removeChild(node);
  parent.childNodes.push(node);
  node.parentNode = parent;
}

function remove_child(parent: FakeElement | FakeFragment, node: FakeNode): void {
  const index = parent.childNodes.indexOf(node);
  if (index >= 0) parent.childNodes.splice(index, 1);
  if (node.parentNode === parent) node.parentNode = undefined;
}

const fakeDocument = {
  createTextNode: (value: string) => new FakeText(value),
  createDocumentFragment: () => new FakeFragment(),
  createElement: (tag: string) => new FakeElement(tag),
  createElementNS: (namespace: string, tag: string) => new FakeElement(tag, namespace),
};

export function install_fake_document(): void {
  Reflect.set(globalThis, "document", fakeDocument);
  Reflect.set(globalThis, "Node", { TEXT_NODE: 3 });
}
