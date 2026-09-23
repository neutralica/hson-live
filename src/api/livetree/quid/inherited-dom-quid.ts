/** Temporary Phase 3A record of DOM metadata present before local adoption. @internal */
const inheritedDomQuids = new WeakMap<Element, string | null>();

export function record_inherited_dom_quid(element: Element): void {
  inheritedDomQuids.set(element, element.getAttribute("hson:quid"));
}

export function forget_inherited_dom_quid(element: Element): void {
  inheritedDomQuids.delete(element);
}

export function inherited_dom_quid(element: Element): string | null | undefined {
  return inheritedDomQuids.get(element);
}

export function matches_inherited_dom_quid(element: Element): boolean {
  return inheritedDomQuids.has(element)
    && element.getAttribute("hson:quid") === inheritedDomQuids.get(element);
}
