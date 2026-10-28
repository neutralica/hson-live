import type { HsonNode, Primitive } from "../core/types.js";
import { ROOT_TAG, STR_TAG } from "../core/constants.js";
import { is_Node, is_ordinary_element_node } from "../core/node-guards.js";
import { PART_DECLARATION, PART_OPTIONAL, PART_LOCAL_REFERENCE_MIGRATION, part_declaration_issue, part_optional_issue, is_part_iterator_attribute, part_node_iterator, is_part_receiving_attribute, part_receiving_declaration, has_part_reference, part_structural_reference, part_reference_text, part_placeholder_placement_issue, whole_part_reference, part_placeholder_matches, type PartArgumentKind, type PartReference, type PartReceivingDeclaration, type PartIteratorDeclaration } from "./part-placeholder.js";

/** Part admission validates flag form even for definitions never invoked. */
export function validate_part_definition_flags(root: HsonNode): void {
  const element = root.$_content[0];
  if (!is_ordinary_element_node(element) || !Object.hasOwn(element.$_attrs ?? {}, PART_DECLARATION)) {
    throw new TypeError("Part definition root requires the hson:part flag.");
  }
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const iterator = part_node_iterator(node);
    if (iterator !== undefined && (node === element || !is_ordinary_element_node(node))) {
      throw new TypeError("Part iteration is only allowed on descendant elements, never the definition root.");
    }
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
  substitute: (value: string, node: HsonNode, owner: HsonNode, attribute?: string) => Primitive | undefined,
  forwarding?: (reference: PartReference, node: HsonNode, kind: "data" | "doc", attribute: string) => void,
  receiving?: (declarations: readonly PartReceivingDeclaration[]) => void,
  traversal?: Readonly<{
    enter?: (node: HsonNode, parent: HsonNode | undefined) => boolean | void;
    leave?: (node: HsonNode, parent: HsonNode | undefined) => void;
    inspect?: boolean;
    structure?: (reference: PartReference, node: HsonNode) => void;
    iterator?: (declaration: PartIteratorDeclaration, node: HsonNode) => void;
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
    const iterator = part_node_iterator(node);
    if (iterator !== undefined) {
      if (node === element || !is_ordinary_element_node(node)) throw new TypeError("Part iteration is only allowed on descendant elements, never the definition root.");
      traversal?.iterator?.(iterator, node);
    }
    if (has_part_reference(node.$_tag)) throw new TypeError("Part placeholders cannot occur in tags.");
    if (node.$_meta !== undefined && has_part_reference(JSON.stringify(node.$_meta))) throw new TypeError("Part placeholders cannot occur in identity metadata.");
    if (node.$_attrs !== undefined) {
      const attrs: NonNullable<HsonNode["$_attrs"]> = Object.create(null);
      for (const [name, value] of Object.entries(node.$_attrs)) {
        if (is_part_iterator_attribute(name)) continue;
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
        if (name.startsWith("^{")) {
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
          if (typeof value === "string" && value.startsWith("#{")) throw new TypeError(PART_LOCAL_REFERENCE_MIGRATION);
          const reference = typeof value === "string" ? whole_part_reference(value) : undefined;
          if (reference !== undefined) forwarding?.(reference, node, name.startsWith("data:") ? "data" : "doc", name);
          attrs[name] = value;
        } else {
          const replacement = typeof value === "string" ? substitute(value, node, owner, name) : value;
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

/** Declaration objects are lexical identities, shared by all uses in their scope. */
export type PartLocalDeclaration = Readonly<{ name: string; kind: PartArgumentKind; node: HsonNode; receiving?: PartReceivingDeclaration;
  elementOf?: PartReferenceUse }>;
type PartReceivingLocal = PartLocalDeclaration & Readonly<{ receiving: PartReceivingDeclaration }>;
export type PartReferenceUse = Readonly<{ reference: PartReference; node: HsonNode; binding?: PartLocalDeclaration;
  scope: ReadonlyMap<string, PartLocalDeclaration>;
  iterators: readonly HsonNode[];
  context: "value" | "forwarding" | "structure" | "iteration"; supply?: "data" | "doc" }>;
export type PartRequiredness = "required" | "optional" | "conditional";
export type PartDefinitionAnalysis = Readonly<{
  parameters: ReadonlyMap<string, PartArgumentKind>;
  requiredness: ReadonlyMap<string, PartRequiredness>;
  receiving: readonly PartReceivingLocal[];
  scopes: ReadonlyMap<HsonNode, ReadonlyMap<string, PartLocalDeclaration>>;
  iterators: ReadonlyMap<HsonNode, PartIteratorDeclaration>;
  uses: readonly PartReferenceUse[];
  used: ReadonlySet<PartLocalDeclaration>;
}>;
export type PartDefinitionIssue = Readonly<{ node: HsonNode; reference?: PartReference; attribute?: string; message: string }>;

/** Shared semantic analysis for receiving interfaces, execution and source facts.
 * Reporting consumers can retain precise local issues; execution fails closed. */
export function analyze_part_definition(root: HsonNode, report?: (issue: PartDefinitionIssue) => void): PartDefinitionAnalysis {
  const parameters = new Map<string, PartArgumentKind>();
  const receiving: PartReceivingLocal[] = [], uses: PartReferenceUse[] = [];
  const used = new Set<PartLocalDeclaration>();
  const scopes = new Map<HsonNode, ReadonlyMap<string, PartLocalDeclaration>>();
  const iterators = new Map<HsonNode, PartIteratorDeclaration>();
  let execution: readonly HsonNode[] = [];
  const outerExecution = new Map<HsonNode, readonly HsonNode[]>();
  let locals = new Map<string, PartLocalDeclaration>();
  const previous = new Map<HsonNode, Map<string, PartLocalDeclaration>>();
  const issue = (node: HsonNode, message: string, reference?: PartReference, attribute?: string): void => {
    if (report === undefined) throw new TypeError(message);
    report({ node, message, ...(reference === undefined ? {} : { reference }), ...(attribute === undefined ? {} : { attribute }) });
  };
  const add = (reference: PartReference, kind: PartArgumentKind, node: HsonNode, attribute?: string) => {
    const name = reference.name;
    if (parameters.has(name) && parameters.get(name) !== kind) issue(node, `Conflicting Part input ${JSON.stringify(name)}.`, reference, attribute);
    parameters.set(name, kind);
  };
  const observe = (reference: PartReference, node: HsonNode, context: PartReferenceUse["context"] = "value", supply?: "data" | "doc", attribute?: string) => {
    const binding = reference.namespace === "local" ? locals.get(reference.name) : undefined;
    const use: PartReferenceUse = { reference, node, context, scope: locals, iterators: execution, ...(binding === undefined ? {} : { binding }), ...(supply === undefined ? {} : { supply }) };
    uses.push(use);
    if (reference.namespace === "incoming") {
      if (reference.path.length || context !== "value") issue(node, context === "forwarding"
        ? "Typed Part forwarding requires a declared local binding and ^{} reference."
        : "Structured Part inputs require a declared local binding and ^{} reference.", reference, attribute);
      add(reference, "scalar", node, attribute);
    } else if (binding === undefined) {
      issue(node, `Missing Part local declaration ${JSON.stringify(reference.name)}.`, reference, attribute);
    } else {
      used.add(binding);
      if (context === "structure" ? binding.kind !== "doc"
        : context === "iteration" ? binding.kind !== "data"
        : reference.path.length && binding.kind !== "data") issue(node, "Part reference does not match its declared representation.", reference, attribute);
      if (supply !== undefined && binding.kind !== supply) issue(node, "Typed Part forwarding requires the same declared representation.", reference, attribute);
    }
    return use;
  };
  transform_part_parameter_strings(root, (value, node, _owner, attribute) => {
    const references = part_placeholder_matches(value, message => issue(node, message, undefined, attribute));
    references?.forEach(reference => observe(reference, node, "value", undefined, attribute)); return value;
  }, (reference, node, kind, attribute) => observe(reference, node, "forwarding", kind, attribute), declarations => {
    const node = root.$_content[0];
    if (!is_Node(node)) return;
    for (const declaration of declarations) {
      const attribute = `${declaration.name}:${declaration.kind}`;
      if (locals.has(declaration.name)) issue(node, `Conflicting Part local binding ${JSON.stringify(declaration.name)}.`, declaration.reference, attribute);
      const local: PartReceivingLocal = { name: declaration.name, kind: declaration.kind, node, receiving: declaration };
      locals.set(local.name, local); receiving.push(local); add(declaration.reference, declaration.kind, node, attribute);
    }
  }, {
    inspect: true,
    enter(node) { scopes.set(node, locals); },
    structure(reference, node) { observe(reference, node, "structure", undefined, part_reference_text(reference)); },
    iterator(declaration, node) {
      // The collection is read before this element's aliases shadow outer names.
      const source = observe(declaration.source, node, "iteration", undefined, declaration.attribute);
      outerExecution.set(node, execution); execution = [...execution, node];
      previous.set(node, locals);
      locals = new Map(locals);
      if (declaration.value !== undefined) locals.set(declaration.value, { name: declaration.value, kind: "data", node, elementOf: source });
      const ordinal = declaration.kind === "array" ? declaration.index : declaration.key;
      if (ordinal !== undefined) locals.set(ordinal, { name: ordinal, kind: "scalar", node });
      scopes.set(node, locals); iterators.set(node, declaration);
    },
    leave(node) {
      const outer = previous.get(node); if (outer !== undefined) locals = outer;
      const ancestry = outerExecution.get(node); if (ancestry !== undefined) execution = ancestry;
    },
  });
  const requiredness = new Map<string, PartRequiredness>();
  const rootElement = root.$_content[0];
  const optionalRoot = is_Node(rootElement) && Object.hasOwn(rootElement.$_attrs ?? {}, PART_OPTIONAL);
  for (const [name, kind] of parameters) {
    if (kind === "scalar") {
      requiredness.set(name, uses.some(use => use.reference.namespace === "incoming" && use.reference.name === name && !use.reference.optional) ? "required" : "optional");
      continue;
    }
    const declarations = receiving.filter(local => local.receiving.reference.name === name && !local.receiving.reference.optional);
    // Data declarations on optional roots can remain entirely unexecuted. A
    // direct strict read proves demand; lexical identities exclude shadowed aliases.
    requiredness.set(name, declarations.length === 0 ? "optional" : kind === "doc" || !optionalRoot
      || uses.some(use => declarations.some(local => local === use.binding)
        && use.iterators.length === 0 && !use.reference.optional) ? "required" : "conditional");
  }
  return { parameters, requiredness, receiving, scopes, iterators, uses, used };
}

/** One receiving interface normalizer, used by governed write and composition. */
export function part_receiving_interface(root: HsonNode): ReadonlyMap<string, PartArgumentKind> {
  return analyze_part_definition(root).parameters;
}
