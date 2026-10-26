import type { HsonNode, Primitive } from "../core/types.js";
import { ROOT_TAG, STR_TAG } from "../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../core/node-guards.js";
import { PART_DECLARATION, PART_OPTIONAL, part_declaration_issue, part_optional_issue, is_part_receiving_attribute, part_receiving_declaration, has_part_reference, part_structural_reference, part_placeholder_placement_issue, whole_part_reference, part_placeholder_matches, type PartArgumentKind, type PartReference, type PartReceivingDeclaration } from "./part-placeholder.js";

/** Part admission validates flag form even for definitions never invoked. */
export function validate_part_definition_flags(root: HsonNode): void {
  const element = root.$_content[0];
  if (!is_ordinary_element_node(element) || !Object.hasOwn(element.$_attrs ?? {}, PART_DECLARATION)) {
    throw new TypeError("Part definition root requires the hson:part flag.");
  }
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (Object.hasOwn(node.$_attrs ?? {}, PART_DECLARATION)) {
      const issue = part_declaration_issue(node.$_attrs![PART_DECLARATION]);
      if (issue !== undefined || node !== element) throw new TypeError(issue ?? "hson:part is only allowed on the single Part definition root.");
    }
    if (Object.hasOwn(node.$_attrs ?? {}, PART_OPTIONAL)) {
      const issue = part_optional_issue(node.$_attrs![PART_OPTIONAL]);
      if (issue !== undefined || !is_ordinary_element_node(node)) throw new TypeError(issue ?? "part:optional requires an element in a Part definition.");
    }
    for (const child of node.$_content) if (is_Node(child)) stack.push(child);
  }
}

/** Shared placement checks over an already detached, qualified document. */
export function transform_part_parameter_strings(root: HsonNode,
  substitute: (value: string, node: HsonNode, owner: HsonNode) => Primitive | undefined,
  forwarding?: (reference: PartReference, node: HsonNode, kind: "data" | "doc") => void,
  receiving?: (declarations: readonly PartReceivingDeclaration[]) => void,
  traversal?: Readonly<{
    enter?: (node: HsonNode, parent: HsonNode | undefined) => boolean | void;
    leave?: (node: HsonNode, parent: HsonNode | undefined) => void;
    inspect?: boolean;
    structure?: (reference: PartReference, node: HsonNode) => void;
  }>): void {
  const element = root.$_tag === ROOT_TAG && root.$_content.length === 1 && is_Node(root.$_content[0]) ? root.$_content[0] : undefined;
  const declarations = Object.entries(element?.$_attrs ?? {}).filter(([name]) => element !== undefined && is_part_receiving_attribute(element.$_tag, name))
    .map(([name, value]) => part_receiving_declaration(name, value));
  receiving?.(declarations);
  const stack: { node: HsonNode; owner: HsonNode; parent?: HsonNode; leaving?: boolean }[] = [{ node: root, owner: root }];
  while (stack.length) {
    const job = stack.pop()!, { node, parent } = job;
    const owner = is_ordinary_element_node(node) ? node : job.owner;
    if (job.leaving) { traversal?.leave?.(node, parent); continue; }
    if (traversal?.enter?.(node, parent) === false) continue;
    stack.push({ ...job, leaving: true });
    if (has_part_reference(node.$_tag)) throw new TypeError("Part placeholders cannot occur in tags.");
    if (node.$_meta !== undefined && has_part_reference(JSON.stringify(node.$_meta))) throw new TypeError("Part placeholders cannot occur in identity metadata.");
    if (node.$_attrs !== undefined) {
      const attrs: NonNullable<HsonNode["$_attrs"]> = Object.create(null);
      for (const [name, value] of Object.entries(node.$_attrs)) {
        if (name === PART_DECLARATION) {
          const issue = part_declaration_issue(value);
          if (issue !== undefined || node !== element) throw new TypeError(issue ?? "hson:part is only allowed on the single Part definition root.");
          continue; // Authored declaration; stripped only from the detached realization.
        }
        if (name === PART_OPTIONAL) {
          const issue = part_optional_issue(value);
          if (issue !== undefined || !is_ordinary_element_node(node)) throw new TypeError(issue ?? "part:optional requires an element in a Part definition.");
          continue;
        }
        if (is_part_receiving_attribute(node.$_tag, name)) {
          if (node !== element) throw new TypeError("Part receiving declarations are only allowed on the single definition root.");
          continue; // Compile-time receiving interface; never part of realized attributes.
        }
        if (name.startsWith("#{")) {
          const reference = part_structural_reference(node);
          if (reference === undefined) throw new TypeError("Invalid structural Part reference.");
          traversal?.structure?.(reference, node);
          attrs[name] = value;
          continue;
        }
        if (has_part_reference(name)) throw new TypeError("Part placeholders cannot occur in attribute names.");
        const issue = part_placeholder_placement_issue([], { name, value });
        if (issue !== undefined && (typeof value === "string" ? has_part_reference(value) : value !== null && typeof value === "object" && has_part_reference(JSON.stringify(value)))) throw new TypeError(issue);
        if (node.$_tag.toLowerCase() === "hson-part" && (name.startsWith("data:") || name.startsWith("doc:"))) {
          const reference = typeof value === "string" ? whole_part_reference(value) : undefined;
          if (reference !== undefined) forwarding?.(reference, node, name.startsWith("data:") ? "data" : "doc");
          attrs[name] = value;
        } else {
          const replacement = typeof value === "string" ? substitute(value, node, owner) : value;
          if (replacement !== undefined) attrs[name] = replacement;
        }
      }
      if (!traversal?.inspect) node.$_attrs = attrs;
    }
    if (node.$_tag === STR_TAG && typeof node.$_content[0] === "string") {
      const value = substitute(node.$_content[0], node, owner);
      // Canonical document text is STR-only; strong scalar types apply to attributes.
      if (value !== undefined && !traversal?.inspect) node.$_content = [String(value)];
    } else {
      const issue = part_placeholder_placement_issue([node.$_tag]);
      if (issue !== undefined && has_part_reference(JSON.stringify(node.$_content))) throw new TypeError(issue);
      for (let index = node.$_content.length - 1; index >= 0; index--) {
        const child = node.$_content[index];
        if (is_Node(child)) stack.push({ node: child, owner, parent: node });
      }
    }
  }
}

/** The exact surface spelling is its own flag representation. No private attribute alias. */
/** One receiving interface normalizer, used by governed write and composition. */
export function part_receiving_interface(root: HsonNode): ReadonlyMap<string, PartArgumentKind> {
  const names = new Map<string, PartArgumentKind>(), locals = new Map<string, "data" | "doc">();
  const add = (name: string, kind: PartArgumentKind) => {
    if (names.has(name) && names.get(name) !== kind) throw new TypeError(`Conflicting Part input ${JSON.stringify(name)}.`);
    names.set(name, kind);
  };
  const observe = (reference: PartReference, structure = false) => {
    if (reference.namespace === "incoming") {
      if (reference.path.length || structure) throw new TypeError("Structured Part inputs require a declared local binding and #{} reference.");
      add(reference.name, "scalar");
    } else {
      const kind = locals.get(reference.name);
      if (kind === undefined) throw new TypeError(`Missing Part local declaration ${JSON.stringify(reference.name)}.`);
      if (structure ? kind !== "doc" : reference.path.length && kind !== "data") throw new TypeError("Part reference does not match its declared representation.");
    }
  };
  transform_part_parameter_strings(root, value => {
    const references = part_placeholder_matches(value);
    if (references === undefined) throw new TypeError("Invalid Part placeholder.");
    references.forEach(reference => observe(reference)); return value;
  }, (reference, _node, kind) => {
    observe(reference);
    if (reference.namespace !== "local" || locals.get(reference.name) !== kind) throw new TypeError("Typed Part forwarding requires the same declared representation.");
  }, declarations => {
    for (const declaration of declarations) {
      if (locals.has(declaration.name)) throw new TypeError(`Conflicting Part local binding ${JSON.stringify(declaration.name)}.`);
      locals.set(declaration.name, declaration.kind); add(declaration.reference.name, declaration.kind);
    }
  }, { inspect: true, structure: reference => observe(reference, true) });
  return names;
}
