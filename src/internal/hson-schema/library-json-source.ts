import type ts from "typescript";
import { hson_package_declaration_path, is_official_hson_package_binding } from "../embedded-hson/discover-hson-tagged-templates.js";
import { immutable_source_declaration } from "./schema-identity.js";

/** Static representation evidence only. Primitive strings have no runtime brand. */
export function library_json_has_hson_source(typescript: typeof ts, checker: ts.TypeChecker,
  input: ts.Expression, eligible: (node: ts.Node) => boolean): boolean {
  const typeHasSource = (type: ts.Type, seen = new Set<ts.Type>(), depth = 0): boolean => {
    if (depth > 16 || seen.has(type) || type.flags & (typescript.TypeFlags.Any | typescript.TypeFlags.Unknown | typescript.TypeFlags.Never)) return false;
    const next = new Set(seen); next.add(type);
    if (type.isUnion()) return type.types.some(member => typeHasSource(member, next, depth + 1));
    const constraint = checker.getBaseConstraintOfType(type);
    if (constraint !== undefined && constraint !== type && typeHasSource(constraint, next, depth + 1)) return true;
    // Match the actual unique-symbol declaration, not an alias spelling or a
    // user-authored property with the same text.
    const properties = type.getProperties();
    if (properties.some(property => property.declarations?.some(declaration => {
      if (!typescript.isPropertySignature(declaration) || !typescript.isComputedPropertyName(declaration.name)
        || !typescript.isIdentifier(declaration.name.expression)
        || !["HSON_CANONICAL_BRAND", "HSON_AUTHORED_BRAND"].includes(declaration.name.expression.text)) return false;
      const path = hson_package_declaration_path(declaration.getSourceFile().fileName);
      return path === "src/api/transform/transform.types.ts" || path === "dist/api/transform/transform.types.d.ts";
    }))) return true;
    // This checks the channel's whole value. Native containers and authentic
    // carriers retain their semantic interpretation, including string members.
    return false;
  };
  const expressionHasSource = (node: ts.Expression, seen = new Set<ts.Declaration>(), depth = 0): boolean => {
    if (depth > 16 || !eligible(node)) return false;
    if (typeHasSource(checker.getTypeAtLocation(node))) return true;
    if (typescript.isParenthesizedExpression(node) || typescript.isAsExpression(node) || typescript.isSatisfiesExpression(node)) {
      return expressionHasSource(node.expression, seen, depth + 1);
    }
    if (typescript.isTaggedTemplateExpression(node) && typescript.isPropertyAccessExpression(node.tag)
      && ["data", "canonical", "document"].includes(node.tag.name.text) && typescript.isIdentifier(node.tag.expression)) {
      return is_official_hson_package_binding(node.tag.expression, "Hson", checker, true, typescript, eligible);
    }
    if (typescript.isIdentifier(node)) {
      const binding = immutable_source_declaration(typescript, checker, node, eligible);
      if (!binding?.eligible || seen.has(binding.declaration) || binding.declaration.initializer === undefined) return false;
      // Immutable primitive provenance can survive an explicit string widening.
      // Do not reuse an object's initializer after its mutable fields may change.
      if (!(checker.getTypeAtLocation(node).flags & typescript.TypeFlags.StringLike)) return false;
      const next = new Set(seen); next.add(binding.declaration);
      return expressionHasSource(binding.declaration.initializer, next, depth + 1);
    }
    if (typescript.isConditionalExpression(node)) return expressionHasSource(node.whenTrue, seen, depth + 1)
      || expressionHasSource(node.whenFalse, seen, depth + 1);
    return false;
  };
  return expressionHasSource(input);
}
