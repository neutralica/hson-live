import type { HsonSchemaDataSemanticNode, HsonSchemaDocumentContent, HsonSchemaDocumentElement, HsonSchemaDocumentItem, HsonSchemaSemanticNode } from "./compiler.js";

export type GeneratedHsonSchemaTypes = Readonly<{
  declarations: string;
  proofNodeCount: number;
}>;

/** Emit bounded declaration-only evidence for one verified human Schema. */
export function generate_hson_schema_types(name: string, root: HsonSchemaSemanticNode): GeneratedHsonSchemaTypes {
  let proofNodeCount = 0;
  const proofDeclarations: string[] = [];
  const proof = (label: string): string => {
    const className = `__${name}${label}Proof${proofNodeCount}`;
    proofNodeCount += 1;
    proofDeclarations.push(`abstract class ${className} { declare private readonly __hsonSchemaProof: void; }`);
    return className;
  };
  const emitData = (schema: HsonSchemaDataSemanticNode, path: string): string => {
    switch (schema.kind) {
      case "string": return "string";
      case "number": return "HsonNumber";
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
      case "array": return `ReadonlyArray<${emitData(schema.item, `${path}Item`)}> & ${proof(`${path}Array`)}`;
      case "tuple": return `readonly [${schema.items.map((item, index) => emitData(item, `${path}T${index}`)).join(", ")}] & ${proof(`${path}Tuple`)}`;
      case "union": return schema.choices.map((choice, index) => `(${emitData(choice, `${path}U${index}`)})`).join(" | ");
    }
  };

  const emitDocumentItem = (item: HsonSchemaDocumentItem, path: string): string => item.kind === "document-string"
    ? `Readonly<{ readonly $_tag: "_hson_str"; readonly $_content: readonly [string]; }> & ${proof(`${path}Text`)}`
    : emitDocumentElement(item, path);
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

  const value = root.kind === "document-element" ? emitDocumentElement(root, "Root") : emitData(root, "Root");
  const hsonProof = proof("Hson");
  return Object.freeze({
    proofNodeCount,
    declarations: `${proofDeclarations.join("\n")}\nexport type ${name}Value = ${value};\nexport type ${name}Hson = HsonCanonical & ${hsonProof};`,
  });
}

function property_name(name: string): string {
  return /^[$A-Z_a-z][$\w]*$/.test(name) ? name : JSON.stringify(name);
}
