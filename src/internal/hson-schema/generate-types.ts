import type { HsonSchemaSemanticNode } from "./compiler.js";

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
  const emit = (schema: HsonSchemaSemanticNode, path: string): string => {
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
        const fields = schema.members.map((member, index) => `readonly ${property_name(member.name)}${member.optional ? "?" : ""}: ${emit(member.schema, `${path}M${index}`)};`).join(" ");
        return `Readonly<{ ${fields} }> & ${proof(`${path}Object`)}`;
      }
      case "array": return `ReadonlyArray<${emit(schema.item, `${path}Item`)}> & ${proof(`${path}Array`)}`;
      case "tuple": return `readonly [${schema.items.map((item, index) => emit(item, `${path}T${index}`)).join(", ")}] & ${proof(`${path}Tuple`)}`;
      case "union": return schema.choices.map((choice, index) => `(${emit(choice, `${path}U${index}`)})`).join(" | ");
    }
  };

  const value = emit(root, "Root");
  const hsonProof = proof("Hson");
  return Object.freeze({
    proofNodeCount,
    declarations: `${proofDeclarations.join("\n")}\nexport type ${name}Value = ${value};\nexport type ${name}Hson = HsonCanonical & ${hsonProof};`,
  });
}

function property_name(name: string): string {
  return /^[$A-Z_a-z][$\w]*$/.test(name) ? name : JSON.stringify(name);
}
