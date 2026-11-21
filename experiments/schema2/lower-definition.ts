import { HSON_MAX_NESTING } from "../../src/core/constants.js";
import { serialize_canonical_hson_data } from "../../src/core/hson-data-canonical-codec.js";
import { is_valid_hson_data_name } from "../../src/core/hson-name.js";
import {
  is_ordered_projected_object, ordered_projected_array, ordered_projected_object,
  type OrderedProjectedObject, type OrderedProjectedValue,
} from "../../src/core/ordered-projected-value.js";
import { is_schema_occurrence, type SchemaHeader, type SchemaOccurrence, type SchemaOrigin } from "./structure.js";

type Path = readonly (string | number)[];
type Entry = readonly [string, OrderedProjectedValue];

export class SchemaLoweringError extends Error {
  constructor(readonly origin: SchemaOrigin, message: string) {
    super(message);
    this.name = "SchemaLoweringError";
  }
}

function fail(origin: SchemaOrigin, message: string): never {
  throw new SchemaLoweringError(origin, message);
}

function no_headers(owner: SchemaOccurrence): void {
  const [first] = owner.headers;
  if (first) fail(first, `${owner.name} does not take a ${first.name} header.`);
}

function no_body(owner: SchemaOccurrence): void {
  const body = owner.body;
  if (body !== undefined) fail(body, `${owner.name} requires absent content.`);
}

function nested_expression(owner: SchemaOccurrence): SchemaOccurrence {
  const body = owner.body;
  if (body?.kind !== "operation") fail(body ?? owner, `${owner.name} requires a nested Schema operation.`);
  return body;
}

// Header spelling selects the 1.0 field and the conversion of its decoded operand.
// Range consistency, integer bounds, union disjointness and reference resolution belong to the compiler.
const lengths = ["len", "minlen", "maxlen"];
const numeric = ["min", "max", "over", "under"];
const allowedHeaders = {
  number: ["int", ...numeric],
  string: [...lengths, "prefix", "suffix", "contains", "alphabet"],
  array: [...lengths, "unique"],
  tuple: lengths,
};

function header_value(header: SchemaHeader): OrderedProjectedValue {
  const { name, operand } = header;
  if (name === "unique" && typeof operand === "object") {
    if (!is_ordered_projected_object(operand.value)) fail(operand, "Configured unique requires a Data object.");
    return operand.value;
  }
  if (name === "int" || name === "unique") {
    if (operand !== undefined) fail(header, `${name} requires a flag${name === "unique" ? " or a braced Data operand" : ""}.`);
    return true;
  }
  if (typeof operand !== "string") fail(header, `${name} requires a quoted header operand.`);
  if (!lengths.includes(name) && !numeric.includes(name)) return operand;
  // No trimming or general JS coercion. Exponents and the sign of zero survive decoding.
  const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(operand) ? Number(operand) : NaN;
  if (!Number.isFinite(number)) {
    fail(header, `${name} requires a finite JSON number in its header operand.`);
  }
  return number;
}

export type LoweredDefinition = Readonly<{
  orderedDefinition: OrderedProjectedObject;
  schema1Source: string;
  /** Nearest structural owner of a compiler path, including paths inside a braced operand. */
  originAt(path: Path): SchemaOrigin;
  /** Named member or wildcard owning this generated field, before optional or value lowering. */
  declarationAt(path: Path): SchemaOccurrence | undefined;
}>;

/**
 * Translate one completed, producer-owned declaration into Schema 1.0 Data. A SchemaLoweringError
 * identifies the offending input occurrence. On success, pass schema1Source to
 * compile_hson_schema for definition validation. Use originAt(issue.path) to anchor
 * its diagnostics. Compiler ranges refer to the generated Schema 1.0 text.
 * The private source entry also projects range-only issues using generated HSON provenance.
 *
 * Run the structural proof with:
 *   node --import=tsx --test experiments/schema2/lower-definition.test.mts
 */
export function lower_schema_definition(root: SchemaOccurrence): LoweredDefinition {
  if (!is_schema_occurrence(root)) throw new TypeError("Expected an owned Schema occurrence at the root.");
  const origins = new Map<string, SchemaOrigin>();
  const declarations = new Map<string, SchemaOccurrence>();
  function locate(path: Path, origin: SchemaOrigin): void {
    if (path.length >= HSON_MAX_NESTING) fail(origin, "Lowered definition exceeds the HSON nesting limit.");
    origins.set(JSON.stringify(path), origin);
  }

  function originAt(path: Path): SchemaOrigin {
    for (let length = path.length; length > 0; length--) {
      const origin = origins.get(JSON.stringify(path.slice(0, length)));
      if (origin) return origin;
    }
    return root;
  }

  function refinements(owner: SchemaOccurrence, domain: keyof typeof allowedHeaders, path: Path): Entry[] {
    const entries: Entry[] = [];
    const seen = new Set<string>();
    for (const header of owner.headers) {
      if (!allowedHeaders[domain].includes(header.name)) fail(header, `Unsupported ${domain} header ${header.name}.`);
      if (seen.has(header.name)) fail(header, `Duplicate ${domain} header ${header.name}.`);
      seen.add(header.name);
      locate([...path, header.name], header);
      entries.push([header.name, header_value(header)]);
    }
    return entries;
  }

  function memberFields(owner: SchemaOccurrence, parent: Path): Entry[] {
    no_headers(owner);
    const body = owner.body;
    const context = owner.name;
    const path = [...parent, context];
    if (context === "object" && body === undefined) {
      locate(path, owner);
      return [[context, ordered_projected_object([])]];
    }
    if (body?.kind !== "members") fail(body ?? owner, `${context} requires an ordered member map.`);
    locate(path, body);
    const entries: Entry[] = [];
    const seen = new Set<string>();
    let additional: Entry | undefined;
    for (const member of body.entries) {
      if (context === "object" && member.kind === "operation" && member.name === "any") {
        if (additional) fail(member, "Duplicate object wildcard.");
        const [header] = member.headers;
        if (header) fail(header, `Object wildcard any does not accept the ${header.name} header. Only named members can be optional.`);
        const wildcardPath = [...parent, "any"];
        declarations.set(JSON.stringify(wildcardPath), member);
        if (member.body === undefined) {
          locate(wildcardPath, member);
          additional = ["any", "any"];
        } else {
          additional = ["any", expression(nested_expression(member), wildcardPath)];
        }
        continue;
      }
      if (member.kind !== "name") fail(member, `${context} requires user-defined names, received operation ${member.name}.`);
      const name = member.name;
      if (!is_valid_hson_data_name(name)) fail(member, `Invalid Data name ${JSON.stringify(name)}.`);
      if (seen.has(name)) fail(member, `Duplicate name ${JSON.stringify(name)} in ${context}.`);
      seen.add(name);
      const memberPath = [...path, name];
      declarations.set(JSON.stringify(memberPath), member);
      const child = nested_expression(member);
      let value: OrderedProjectedValue;
      const [flag, extra] = member.headers;
      if (flag) {
        if (context === "defs" || flag.name !== "optional" || flag.operand !== undefined) {
          fail(flag, `Unsupported header on ${JSON.stringify(name)} in ${context}. Only object members accept the optional flag.`);
        }
        if (extra) fail(extra, "A member accepts only one optional flag.");
        locate(memberPath, flag);
        value = ordered_projected_object([["optional", expression(child, [...memberPath, "optional"])]]);
      } else {
        value = expression(child, memberPath);
      }
      entries.push([name, value]);
    }
    const fields: Entry[] = [[context, ordered_projected_object(entries)]];
    if (additional) fields.push(additional);
    return fields;
  }

  // Unmodified primitives are the only expressions emitted as Schema 1.0 strings.
  function primitiveShorthand(owner: SchemaOccurrence): boolean {
    return !owner.headers.length && ["any", "null", "boolean", "number", "string"].includes(owner.name);
  }

  function expression(owner: SchemaOccurrence, path: Path): OrderedProjectedValue {
    if (owner.kind !== "operation") fail(owner, `Expected a Schema operation, received name ${owner.name}.`);
    locate(path, owner);
    const name = owner.name;
    const operandPath = [...path, name];
    if (primitiveShorthand(owner)) {
      no_body(owner);
      return name;
    }
    switch (name) {
      case "any": case "null": case "boolean":
        return fail(owner.headers[0], `${name} does not take a ${owner.headers[0].name} header.`);
      case "number": case "string": {
        no_body(owner);
        const rules = refinements(owner, name, operandPath);
        return ordered_projected_object([[name, ordered_projected_object(rules)]]);
      }
      case "exact": case "ref": {
        no_headers(owner);
        const body = owner.body;
        if (body?.kind !== "value") fail(body ?? owner, `${name} requires an explicit literal operand.`);
        locate(operandPath, body);
        return ordered_projected_object([[name, body.value]]);
      }
      case "object":
        return ordered_projected_object(memberFields(owner, path));
      case "array": case "tuple": case "union": {
        if (name === "union") no_headers(owner);
        const rules = name === "union" ? [] : refinements(owner, name, operandPath);
        const contentPath = rules.length ? [...operandPath, "content"] : operandPath;
        let content: OrderedProjectedValue;
        if (name === "array") {
          content = expression(nested_expression(owner), contentPath);
        } else {
          const body = owner.body;
          if (body?.kind !== "group") fail(body ?? owner, `${name} requires an ordered group of expressions.`);
          locate(contentPath, body);
          content = ordered_projected_array(body.items.map((item, i) => expression(item, [...contentPath, i])));
        }
        const operand = rules.length ? ordered_projected_object([["content", content], ...rules]) : content;
        return ordered_projected_object([[name, operand]]);
      }
      default:
        return fail(owner, `Unsupported Data Schema operation ${JSON.stringify(name)}.`);
    }
  }

  if (root.kind !== "operation" || root.name !== "data") fail(root, "Expected a data root. Only Data Schema declarations are supported.");
  no_headers(root);
  locate([], root);
  locate(["type"], root);
  const entries: Entry[] = [["type", "data"]];
  function rootClause(clause: SchemaOccurrence): void {
    if (clause.kind !== "operation") fail(clause, "A data root clause must be an operation.");
    if (clause.name === "defs") {
      if (entries.length !== 1) fail(clause, "defs may occur once, before the root expression.");
      entries.push(...memberFields(clause, []));
      return;
    }
    if (entries.at(-1)?.[0] === "root") fail(clause, "A data root accepts only one expression.");
    const optional = clause.name === "optional" ? clause : clause.headers.find(header => header.name === "optional");
    if (optional) fail(optional, "Only a named object member can be optional. A Data root always has a value.");
    entries.push(["root", expression(clause, ["root"])]);
  }

  const body = root.body;
  if (body?.kind === "group") {
    if (!body.items.length) fail(body, "A present data body requires a nonempty group of root declarations.");
    for (const clause of body.items) rootClause(clause);
  } else if (body !== undefined) {
    if (!is_schema_occurrence(body)) fail(body, "Expected ordered data root declarations.");
    rootClause(body);
  }
  if (entries.at(-1)?.[0] !== "root") {
    locate(["root"], root);
    entries.push(["root", "any"]);
  }
  const orderedDefinition = ordered_projected_object(entries);
  let schema1Source: string;
  try {
    schema1Source = serialize_canonical_hson_data(orderedDefinition);
  } catch (error) {
    // A bounded literal can fit by itself and overflow inside the generated
    // definition. Only inspect the rejected tree, leaving admission to the codec.
    function overflowingOrigin(node: OrderedProjectedValue, path: Path): SchemaOrigin | undefined {
      if (path.length >= HSON_MAX_NESTING) return originAt(path);
      if (node === null || typeof node !== "object") return undefined;
      const children = is_ordered_projected_object(node) ? node.entries : node.entries();
      for (const [key, child] of children) {
        const found = overflowingOrigin(child, [...path, key]);
        if (found) return found;
      }
    }
    fail(overflowingOrigin(orderedDefinition, []) ?? root,
      `Cannot emit the lowered Data definition. ${error instanceof Error ? error.message : String(error)}`);
  }
  return { orderedDefinition, schema1Source, originAt, declarationAt: path => declarations.get(JSON.stringify(path)) };
}
