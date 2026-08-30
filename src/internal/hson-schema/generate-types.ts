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
  const visitData = (schema: HsonSchemaDataSemanticNode): void => {
    if (schema.kind === "ref") { visitDefinition(schema.name); return; }
    if (schema.kind === "object") schema.members.forEach((member) => visitData(member.schema));
    else if (schema.kind === "array") visitData(schema.item);
    else if (schema.kind === "tuple") schema.items.forEach(visitData);
    else if (schema.kind === "union") schema.choices.forEach(visitData);
  };
  const visitDocument = (element: HsonSchemaDocumentElement): void => {
    element.attrs.forEach((attr) => { if (!attr.flag) visitData(attr.schema); });
    if (element.content.kind === "document-sequence") element.content.items.forEach((item) => {
      if (item.kind === "document-ref") visitDefinition(item.name);
      else if (item.kind === "document-element") visitDocument(item);
    });
  };
  const visitDefinition = (definitionName: string): void => {
    if (aliases.has(definitionName)) return;
    const definition = definitionsByName.get(definitionName);
    if (definition === undefined) throw new Error(`Missing generated Schema definition ${JSON.stringify(definitionName)}.`);
    aliases.set(definitionName, `__${name}Definition${aliases.size}`);
    reachableDefinitions.push(definition);
    if (definition.schema.kind === "document-element") visitDocument(definition.schema); else visitData(definition.schema);
  };
  if (root.kind === "document-element") visitDocument(root); else visitData(root);
  const proof = (label: string): string => {
    const proofIndex = proofNodeCount;
    const className = `__${name}${label}Proof${proofIndex}`;
    proofNodeCount += 1;
    proofDeclarations.push(`abstract class ${className} { declare private readonly __hsonSchemaProof${proofIndex}: void; }`);
    return className;
  };
  const refined = (base: string, schema: Extract<HsonSchemaDataSemanticNode, { refinements: readonly unknown[] }>, path: string): string => schema.refinements.reduce(
    (type, refinement, index) => `${type} & ${proof(`${path}${refinement.member[0]?.toUpperCase() ?? "R"}${refinement.member.slice(1)}R${index}`)}`,
    base,
  );
  const emitData = (schema: HsonSchemaDataSemanticNode, path: string): string => {
    switch (schema.kind) {
      case "string": return refined("string", schema, path);
      case "number": return refined("HsonNumber", schema, path);
      case "boolean": return "boolean";
      case "null": return "null";
      case "exact": {
        if (schema.value === null) return "null";
        if (typeof schema.value === "string" || typeof schema.value === "boolean") return JSON.stringify(schema.value);
        const spelling = Object.is(schema.value, -0) ? "0" : String(schema.value);
        const zeroProof = schema.value === 0 ? ` & ${proof(`${path}Zero`)}` : "";
        return `${spelling} & HsonNumber${zeroProof}`;
      }
      case "object": {
        const fields = schema.members.map((member, index) => `readonly ${property_name(member.name)}${member.optional ? "?" : ""}: ${emitData(member.schema, `${path}M${index}`)};`).join(" ");
        return `Readonly<{ ${fields} }> & ${proof(`${path}Object`)}`;
      }
      case "array": return refined(`ReadonlyArray<${emitData(schema.item, `${path}Item`)}> & ${proof(`${path}Array`)}`, schema, path);
      case "tuple": return refined(`readonly [${schema.items.map((item, index) => emitData(item, `${path}T${index}`)).join(", ")}] & ${proof(`${path}Tuple`)}`, schema, path);
      case "union": return schema.choices.map((choice, index) => `(${emitData(choice, `${path}U${index}`)})`).join(" | ");
      case "ref": {
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
    if (content.kind === "document-empty") return "readonly []";
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

  const definitionDeclarations = reachableDefinitions.map((definition, index) => {
    const alias = aliases.get(definition.name);
    if (alias === undefined) throw new Error(`Missing generated alias for ${JSON.stringify(definition.name)}.`);
    const body = definition.schema.kind === "document-element" ? emitDocumentElement(definition.schema, `D${index}`) : emitData(definition.schema, `D${index}`);
    return `type ${alias} = (${body}) & ${proof(`D${index}Definition`)};`;
  });
  const type = root.kind === "document-element" ? emitDocumentElement(root, "Root") : emitData(root, "Root");
  const hsonProof = proof("Hson");
  return Object.freeze({
    proofNodeCount,
    declarations: `${proofDeclarations.join("\n")}\n${definitionDeclarations.join("\n")}${definitionDeclarations.length === 0 ? "" : "\n"}export type ${name}Type = ${type};\nexport type ${name}Hson = HsonCanonical & ${hsonProof};`,
  });
}

function property_name(name: string): string {
  return /^[$A-Z_a-z][$\w]*$/.test(name) ? name : JSON.stringify(name);
}
