import ts from "typescript";

import type { HsonSchemaDataSemanticNode, HsonSchemaDefinition, HsonSchemaDocumentContent, HsonSchemaDocumentElement, HsonSchemaDocumentItem, HsonSchemaSemanticNode } from "./compiler.js";

export type GeneratedHsonSchemaTypes = Readonly<{
  declarations: string;
  proofNodeCount: number;
}>;

/** Emit bounded declaration-only evidence for one verified human Schema. */
export function generate_hson_schema_types(name: string, root: HsonSchemaSemanticNode, definitions: readonly HsonSchemaDefinition[] = Object.freeze([])): GeneratedHsonSchemaTypes {
  let proofNodeCount = 0;
  const proofDeclarations: string[] = [];
  const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition]));
  const reachableDefinitions: HsonSchemaDefinition[] = [];
  const aliases = new Map<string, string>();
  const visitData = (root: HsonSchemaDataSemanticNode): void => {
    // A flat defs map can form a reference chain much deeper than the HSON text.
    const pending = [root];
    while (pending.length) {
      const node = pending.pop()!;
      if (node.kind === "ref") {
        const target = registerDefinition(node.name);
        if (target && target.schema.kind !== "document-element") pending.push(target.schema);
      } else if (node.kind === "object") {
        if (node.additional !== undefined) pending.push(node.additional);
        for (let i = node.members.length - 1; i >= 0; i--) pending.push(node.members[i]!.schema);
      } else if (node.kind === "array") pending.push(node.item);
      else if (node.kind === "union" || node.kind === "tuple") {
        const children = node.kind === "tuple" ? node.items : node.choices;
        for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]!);
      }
    }
  };
  const visitDocument = (element: HsonSchemaDocumentElement): void => {
    element.attrs.forEach((attr) => { if (!attr.flag) visitData(attr.schema); });
    const items = element.content.kind === "document-sequence" ? element.content.items : element.content.kind === "document-repeat" ? [element.content.item] : [];
    items.forEach((item) => {
      if (item.kind === "document-ref") visitDefinition(item.name);
      else if (item.kind === "document-element") visitDocument(item);
    });
  };
  const registerDefinition = (definitionName: string): HsonSchemaDefinition | undefined => {
    if (aliases.has(definitionName)) return;
    const definition = definitionsByName.get(definitionName);
    if (definition === undefined) throw new Error(`Missing generated Schema definition ${JSON.stringify(definitionName)}.`);
    aliases.set(definitionName, root.kind === "document" || root.kind === "document-element"
      ? `__${name}Definition${aliases.size}`
      : structural_definition_name(definitionName, aliases.size));
    reachableDefinitions.push(definition);
    return definition;
  };
  const visitDefinition = (name: string): void => {
    const definition = registerDefinition(name);
    if (definition?.schema.kind === "document-element") visitDocument(definition.schema);
  };
  if (root.kind === "document") {
    const items = root.content.kind === "document-sequence" ? root.content.items : root.content.kind === "document-repeat" ? [root.content.item] : [];
    items.forEach((item) => {
      if (item.kind === "document-ref") visitDefinition(item.name);
      else if (item.kind === "document-element") visitDocument(item);
    });
  } else if (root.kind === "document-element") visitDocument(root);
  else visitData(root);
  const proof = (label: string): string => {
    const proofIndex = proofNodeCount;
    const className = `__${name}${label}Proof${proofIndex}`;
    proofNodeCount += 1;
    proofDeclarations.push(`abstract class ${className} { declare private readonly __hsonSchemaProof${proofIndex}: void; }`);
    return className;
  };
  const proposalAliases = new Map<string, string>();
  const proposalDefinitions: Array<Readonly<{ alias: string; schema: HsonSchemaDataSemanticNode }>> = [];
  const proposalReference = (name: string): string => {
    const terminal = terminalReference(name);
    const existing = proposalAliases.get(terminal);
    if (existing !== undefined) return existing;
    const definition = definitionsByName.get(terminal);
    if (definition === undefined || definition.schema.kind === "document-element") {
      throw new Error(`Missing Data proposal definition ${JSON.stringify(terminal)}.`);
    }
    const alias = `$SchemaProposal${proposalAliases.size}`;
    proposalAliases.set(terminal, alias);
    proposalDefinitions.push({ alias, schema: definition.schema });
    return alias;
  };
  // Data reads express structure only. Constraints beyond TypeScript's shape
  // model are checked at admission, while Schema identity lives in Evidence.
  const emitData = (schema: HsonSchemaDataSemanticNode, proposal = false): string => {
    switch (schema.kind) {
      case "string": return "string";
      case "number": return "number";
      case "boolean": return "boolean";
      case "null": return "null";
      case "any": return proposal ? "$SchemaDataInput" : "$SchemaDataRead";
      case "exact": {
        if (schema.value === null) return "null";
        if (typeof schema.value === "string" || typeof schema.value === "boolean") return JSON.stringify(schema.value);
        return Object.is(schema.value, -0) ? "0" : String(schema.value);
      }
      case "object": {
        const open = schema.additional !== undefined;
        if (proposal && !open && schema.members.length === 0) return "{ readonly [key: string | symbol]: never }";
        const fields = schema.members.map(member => {
          // Absent own members can inherit arbitrary values through a mutable prototype.
          const type = member.optional && !proposal ? "unknown" : emitData(member.schema, proposal);
          return `readonly ${property_name(member.name)}${member.optional ? "?" : ""}: ${type};`;
        });
        // A string index cannot exclude the named members. Runtime evaluation
        // applies the wildcard to extras and the named rule to each declared key.
        const index = proposal ? " & { readonly [key: string]: $SchemaDataInput }" : " & $SchemaObjectRead";
        return `{ ${fields.join(" ")} }${open ? index : ""}`;
      }
      case "array": return `ReadonlyArray<${emitData(schema.item, proposal)}>`;
      case "tuple": return `readonly [${schema.items.map(item => emitData(item, proposal)).join(", ")}]`;
      case "union": return schema.choices.map(choice => `(${emitData(choice, proposal)})`).join(" | ");
      case "ref": {
        if (proposal) return proposalReference(schema.name);
        const alias = aliases.get(schema.name);
        if (alias === undefined) throw new Error(`Unreachable generated Schema ref ${JSON.stringify(schema.name)}.`);
        return alias;
      }
    }
  };

  const emitDocumentItem = (item: HsonSchemaDocumentItem, path: string): string => {
    if (item.kind === "document-string") return `Readonly<{ readonly $_tag: "_hson_str"; readonly $_content: readonly [string]; }> & ${proof(`${path}Text`)}`;
    if (item.kind === "document-ref") {
      const alias = aliases.get(item.name);
      if (alias === undefined) throw new Error(`Unreachable generated document Schema ref ${JSON.stringify(item.name)}.`);
      return alias;
    }
    return emitDocumentElement(item, path);
  };
  const emitDocumentContent = (content: HsonSchemaDocumentContent, path: string): string => {
    if (content.kind === "document-broad") return "readonly HsonNode[]";
    if (content.kind === "document-empty") return "readonly []";
    if (content.kind === "document-repeat") {
      const item = emitDocumentItem(content.item, `${path}RItem`);
      const repeated = content.count === undefined
        ? `ReadonlyArray<${item}>`
        : content.count <= EXACT_DOCUMENT_REPEAT_TUPLE_LIMIT
          ? `readonly [${Array.from({ length: content.count }, () => item).join(", ")}]`
          : `ReadonlyArray<${item}> & ${proof(`${path}Count${content.count}`)}`;
      return `readonly [Readonly<{ readonly $_tag: "_hson_elem"; readonly $_content: ${repeated} & ${proof(`${path}Repeat`)}; }> & ${proof(`${path}Cluster`)}]`;
    }
    const items = content.kind === "document-string-content"
      ? [emitDocumentItem(Object.freeze({ kind: "document-string" }), `${path}S0`)]
      : content.items.map((item, index) => emitDocumentItem(item, `${path}S${index}`));
    return `readonly [Readonly<{ readonly $_tag: "_hson_elem"; readonly $_content: readonly [${items.join(", ")}]; }> & ${proof(`${path}Cluster`)}]`;
  };
  const emitDocumentElement = (element: HsonSchemaDocumentElement, path: string): string => {
    const required = element.attrs.some((attr) => !attr.optional);
    const attrFields = element.attrs.map((attr, index) => {
      const value = attr.flag ? JSON.stringify(attr.name) : attr.schema.kind === "exact"
        ? JSON.stringify(attr.schema.value === null ? "null" : Object.is(attr.schema.value, -0) ? "-0" : String(attr.schema.value))
        : `string & ${proof(`${path}A${index}`)}`;
      return `readonly ${property_name(attr.name)}${attr.optional ? "?" : ""}: ${value};`;
    }).join(" ");
    const open = element.attrsExact ? "" : " & Readonly<Record<string, unknown>>";
    const attrsType = `Readonly<{ ${attrFields} }>${open} & ${proof(`${path}Attrs`)}`;
    return `Readonly<{ readonly $_tag: ${JSON.stringify(element.tag)}; readonly $_attrs${required ? "" : "?"}: ${attrsType}; readonly $_content: ${emitDocumentContent(element.content, `${path}Content`)}; }> & ${proof(`${path}Element`)}`;
  };

  const emitDocumentRootContent = (content: HsonSchemaDocumentContent, path: string): string => {
    if (content.kind === "document-broad") return "readonly HsonNode[]";
    if (content.kind === "document-empty") return "readonly []";
    if (content.kind === "document-repeat") {
      const item = emitDocumentItem(content.item, `${path}RItem`);
      if (content.count === undefined) return `ReadonlyArray<${item}> & ${proof(`${path}Repeat`)}`;
      if (content.count <= EXACT_DOCUMENT_REPEAT_TUPLE_LIMIT) {
        return `readonly [${Array.from({ length: content.count }, () => item).join(", ")}] & ${proof(`${path}Repeat`)}`;
      }
      return `ReadonlyArray<${item}> & ${proof(`${path}Count${content.count}`)} & ${proof(`${path}Repeat`)}`;
    }
    const items = content.kind === "document-string-content"
      ? [emitDocumentItem(Object.freeze({ kind: "document-string" }), `${path}S0`)]
      : content.items.map((item, index) => emitDocumentItem(item, `${path}S${index}`));
    return `readonly [${items.join(", ")}]`;
  };

  const referenceTerminals = new Map<string, string>();
  const terminalReference = (name: string): string => {
    const chain = new Set<string>();
    let current = name;
    while (true) {
      const cached = referenceTerminals.get(current);
      if (cached !== undefined) {
        current = cached;
        break;
      }
      const target = definitionsByName.get(current);
      if (target?.schema.kind !== "ref") break;
      if (chain.has(current)) throw new Error(`Circular generated Schema alias ${JSON.stringify(current)}.`);
      chain.add(current);
      current = target.schema.name;
    }
    for (const alias of chain) referenceTerminals.set(alias, current);
    return current;
  };

  // Keep names at use sites and skip transparent hops in alias bodies. Structural
  // definitions remain named boundaries, including in productive recursive cycles.
  const definitionDeclarations = reachableDefinitions.map((definition, index) => {
    const alias = aliases.get(definition.name);
    if (alias === undefined) throw new Error(`Missing generated alias for ${JSON.stringify(definition.name)}.`);
    const schema = definition.schema;
    const body = schema.kind === "document-element" ? emitDocumentElement(schema, `D${index}`)
      : schema.kind === "ref" ? emitData({ kind: "ref", name: terminalReference(schema.name) })
        : emitData(schema);
    return definition.schema.kind === "document-element"
      ? `type ${alias} = (${body}) & ${proof(`D${index}Definition`)};`
      : `export type ${alias} = ${body};`;
  });
  const type = root.kind === "document"
    ? `Readonly<{ readonly $_tag: "_hson_root"; readonly $_content: ${emitDocumentRootContent(root.content, "RootContent")}; }> & ${proof("RootDocument")}`
    : root.kind === "document-element"
      ? `Readonly<{ readonly $_tag: "_hson_root"; readonly $_content: readonly [${emitDocumentElement(root, "RootItem")}]; }> & ${proof("RootDocument")}`
    : emitData(root);
  const document = root.kind === "document" || root.kind === "document-element";
  const proposal = document ? "unknown" : emitData(root, true);
  // Only named structural targets used by proposals need private aliases. The
  // worklist also closes productive recursive references without inlining them.
  const proposalDeclarations: string[] = [];
  for (const { alias, schema } of proposalDefinitions) {
    proposalDeclarations.push(`type ${alias} = ${emitData(schema, true)};`);
  }
  return Object.freeze({
    proofNodeCount,
    declarations: [...proofDeclarations, ...definitionDeclarations, ...proposalDeclarations,
      "declare const __Identity: unique symbol;",
      `export type Evidence = Readonly<{ value: ${type}; mode: ${JSON.stringify(document ? "document" : "data")}; identity: typeof __Identity; proposal: ${proposal} }>;`,
    ].join("\n"),
  });
}

/** Prevent pathological declarations while exact runtime cardinality remains canonical. */
const EXACT_DOCUMENT_REPEAT_TUPLE_LIMIT = 32;

function property_name(name: string): string {
  return /^[$A-Z_a-z][$\w]*$/.test(name) ? name : JSON.stringify(name);
}

/** Keep authored ref names where valid, avoiding built-ins used by the emitter. */
function structural_definition_name(name: string, index: number): string {
  const reserved = new Set(["Evidence", "JsonValue", "HsonNode", "ReadonlyArray", "Readonly", "Array", "Record", "__Identity",
    "undefined", "eval", "arguments"]);
  // Keywords and contextual keywords must not be emitted as type-alias names
  // or refs. Let TypeScript classify them rather than maintaining a keyword list.
  return /^[$A-Z_a-z][$\w]*$/.test(name) && !reserved.has(name) && !name.startsWith("$SchemaRef")
    && !name.startsWith("$SchemaProposal") && !["$SchemaDataRead", "$SchemaObjectRead", "$SchemaDataInput"].includes(name)
    && ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, name).scan() === ts.SyntaxKind.Identifier
    ? name : `$SchemaRef${index}`;
}
