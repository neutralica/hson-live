import type ts from "typescript";
import { discover_hson_schema_declarations } from "./schema-discovery.js";
import { compile_hson_schema, type CompiledHsonSchema } from "./compiler.js";
import { is_official_hson_package_binding, read_supported_hson_import_symbols } from "../embedded-hson/discover-hson-tagged-templates.js";
import { evaluate_static_schema_candidate } from "./candidate-evaluation.js";
import { resolve_immutable_schema } from "./schema-identity.js";
import { evaluate_canonical_projected_fields, evaluate_canonical_projected_schema } from "../canonical-schema/evaluate.js";
import type { VerifiedCanonicalSchemaGraph } from "../canonical-schema/graph.js";
import type { CanonicalGraphIssue } from "../canonical-schema/issues.js";
import { resolve_hson_schema_annotation } from "./schema-annotation.js";
import { library_source_admission, library_source_definitions, library_source_fields } from "./library-source.js";
import { library_json_has_hson_source } from "./library-json-source.js";
import { static_source_candidates } from "./source-candidates.js";
import { part_source_coordinates, part_iterator_source_origin, static_part_inventory, type PartSourceFacts, type PartSourceLocation } from "./part-source.js";
import { OBJECT_VALUE, project_ordered_data, project_schema_data } from "./data-projection.js";
import { is_ordered_projected_object, ordered_projected_object, type OrderedProjectedObject, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { is_part_argument_attribute, is_part_scalar_qualifier, part_argument_name, part_argument_issue, part_direction_issue, whole_part_reference } from "../part-placeholder.js";
import { qualify_hson_document_root } from "../../api/document/hson-document.js";
import { parse_authored_document_library } from "../../api/livemap/livemap.document.quad.js";
import { is_ordinary_element_node } from "../../core/node-guards.js";
import { admit_data_source } from "../../core/data-source-admission.js";
import { certain_part_invocations, part_data_contexts, part_data_projection } from "../editor-introspection/part-data-evidence.js";
import { ordered_projected_value_at } from "../../core/ordered-projected-value-mutation.js";
import { event_argument_references, type AuthoredEventArgument } from "../authored-events.js";

type StaticSchemaDiagnosticLocation = Readonly<{ file: string; start: number; end: number; message: string }>;
export type StaticSchemaDiagnostic = StaticSchemaDiagnosticLocation & Readonly<{ code: string; related?: readonly StaticSchemaDiagnosticLocation[] }>;
type Schema = Readonly<{ declaration: ts.VariableDeclaration; name: string; compiled: CompiledHsonSchema }>;

/** Editor-only projection of compiler-owned facts. Never included in Schema build/Watch policy. */
export function static_part_reference_diagnostics(facts: PartSourceFacts, typescript?: typeof ts, checker?: ts.TypeChecker): readonly StaticSchemaDiagnostic[] {
  const output: StaticSchemaDiagnostic[] = [];
  const reported = new Set<string>();
  const memberInvocations = new Set<object>();
  const report = (where: PartSourceLocation | undefined, code: string, message: string,
    declaration?: PartSourceLocation, attachment?: PartSourceLocation, declarationMessage = "Relevant Part declaration."): void => {
    if (where?.precision !== "exact") return;
    const key = JSON.stringify([where.file, where.start, where.end, code, message, attachment]);
    if (reported.has(key)) return;
    reported.add(key);
    const related: StaticSchemaDiagnosticLocation[] = [];
    if (declaration?.precision === "exact") related.push({ file: declaration.file, start: declaration.start, end: declaration.end,
      message: declarationMessage });
    if (attachment?.precision === "exact") related.push({ file: attachment.file, start: attachment.start, end: attachment.end,
      message: "Part event attachment." });
    output.push({ file: where.file, start: where.start, end: where.end, code, message, ...(related.length === 0 ? {} : { related }) });
  };
  for (const issue of facts.eventIssues) report(issue.location, issue.code, issue.message, issue.declaration, issue.attachment, "First declaration.");
  for (const { event, location, map, attachment, maybeAbsent, definition, batch, contract } of facts.eventContracts) {
    if (event.args.length === 0) {
      report(contract.required === undefined ? undefined : location, "HSON_EVENT_INPUT_REQUIRED",
        `Action ${JSON.stringify(event.key)} requires arguments. Supply named typed arguments in this event declaration.`,
        contract.required, attachment, "This action declares required arguments.");
      continue;
    }
    if (contract.schema === undefined) continue;
    const schema = contract.schema.value;
    const args = new Map(event.args.map(argument => [argument.name, argument]));
    const argumentLocation = (name: string) => {
      const argument = args.get(name);
      return argument === undefined ? undefined : map({ start: argument.header.index, end: argument.end.index });
    };
    const missing = (name: string, where = location) => report(where, "HSON_EVENT_ARGUMENT_MISSING",
      `Action ${JSON.stringify(event.key)} requires argument ${JSON.stringify(name)}.`,
      contract.schema?.location, attachment, "Registered Action argument Schema.");
    const incompatible = (name: string | undefined, detail: string) => report(
      name === undefined ? location : argumentLocation(name), "HSON_EVENT_ARGUMENT_INVALID",
      `Arguments for Action ${JSON.stringify(event.key)} do not match its Schema. ${detail}.`,
      contract.schema?.location, attachment, "Registered Action argument Schema.");
    const invocations = definition === undefined ? [] : certain_part_invocations(facts, definition)
      .filter(invocation => invocation.batch.call === batch);
    const omittedAtKnownInvocation = (argument: AuthoredEventArgument, invocation: typeof invocations[number]): boolean => {
      if (definition === undefined || attachment === undefined || !maybeAbsent?.has(argument)) return false;
      return event_argument_references(argument).some(({ reference }) => {
        const use = definition.bindingSources?.references.find(use => use.reference === reference
          && use.attachment?.file === attachment.file && use.attachment.start === attachment.start);
        if (use === undefined || use.conditional || use.withinOptionalStructure || use.iterators.length !== 0) return false;
        const binding = use.declaration;
        const incoming = reference.namespace === "incoming" ? reference.name : binding?.incoming;
        if (incoming === undefined) return false;
        const supplied = invocation.connector?.attributes.find(attribute => part_argument_name(attribute.name)?.name === incoming);
        if (supplied === undefined) {
          return definition.signature?.requiredness.get(incoming) === "optional"
            && (reference.namespace === "incoming" ? (reference.optional === true || binding?.optionalReceiving === true) && reference.path.length === 0
              : binding?.optionalReceiving === true && (reference.path.length === 0 || binding.kind === "data"));
        }
        if (!reference.optional || binding?.kind !== "data" || reference.path.length === 0) return false;
        if (!supplied.dynamicValue && supplied.value !== undefined) {
          let value: OrderedProjectedValue | undefined;
          try { value = admit_data_source(supplied.value); }
          catch { return false; }
          for (const selector of reference.path) {
            if (value === undefined || (typeof selector === "number" ? !Array.isArray(value) : !is_ordered_projected_object(value))) return false;
            value = ordered_projected_value_at(value, [selector]);
            if (value === undefined) return true;
          }
          return false;
        }
        return part_data_contexts(facts, definition, incoming).some(context => {
          if (context.invocation !== invocation || context.receiving !== binding || context.evidence?.strength !== "validated") return false;
          const { alternatives } = part_data_projection(context.evidence, reference.path);
          return alternatives.length > 0 && alternatives.every(alternative => alternative.kind === "absent");
        });
      });
    };

    const roots = project_schema_data(schema, []);
    const objects = roots.filter(root => root.kind === "object");
    // Each object branch requires these fields, including when other operands are unknown.
    if (objects.length !== 0 && roots.every(root => root.kind !== "any")) {
      for (const member of objects[0]!.members) {
        if (!objects.every(root => root.members.some(field => field.name === member.name && !field.optional))) continue;
        const argument = args.get(member.name);
        if (argument === undefined) missing(member.name);

      }
    }

    const literals = event.args.flatMap(({ name, operand }) => operand.kind === "literal" ? [[name, operand.value] as const] : []);
    const fields = ordered_projected_object(literals);
    for (const invocation of invocations) {
      const omitted = event.args.filter(argument => omittedAtKnownInvocation(argument, invocation));
      if (omitted.length === 0) continue;
      const names = new Set(omitted.map(argument => argument.name));
      const missingInEveryBranch = omitted.filter(({ name }) => objects.length > 0 && roots.every(root => root.kind !== "any")
        && objects.every(root => root.members.some(field => field.name === name && !field.optional)));
      for (const { name } of missingInEveryBranch) missing(name, argumentLocation(name));
      if (missingInEveryBranch.length > 0) continue;

      if (literals.length + omitted.length === event.args.length) {
        const evaluation = evaluate_canonical_projected_schema(schema.graph, fields);
        if (roots.length > 1 && evaluation.issues.some(issue => issue.evidence.kind !== "resource-limit" && issue.evidence.kind !== "invalid-graph")) {
          incompatible(undefined, "No Schema alternative accepts this object");
        }
      } else if (roots.length > 1 && !event_schema_branch_viable(schema.graph, fields, names)) {
        incompatible(undefined, "No Schema alternative accepts this object");
      }
    }
    const fullyKnown = literals.length === event.args.length;
    if (fullyKnown || literals.length > 0) {
      const evaluation = fullyKnown ? evaluate_canonical_projected_schema(schema.graph, fields)
        : evaluate_canonical_projected_fields(schema.graph, fields);
      for (const issue of evaluation.issues) {
        if (issue.evidence.kind === "resource-limit" || issue.evidence.kind === "invalid-graph") continue;
        const name = issue.path[0];
        if (issue.evidence.kind === "missing-required" && issue.path.length === 1 && typeof name === "string") {
          if (roots.length <= 1) missing(name);
          else incompatible(undefined, "No Schema alternative accepts this object");
        } else {
          // The evaluator can choose a closest union branch. Avoid attributing
          // that branch's failure to a particular argument in an ambiguous union.
          incompatible(roots.length > 1 || typeof name !== "string" ? undefined : name,
            roots.length > 1 ? "No Schema alternative accepts this object" : issue_detail(issue));
        }
      }
      if (fullyKnown) continue;
    }

    // A required reference supplies the kind promised by its scalar qualifier.
    if (roots.length === 0) continue;
    if (roots.every(root => root.kind !== "object" && root.kind !== "any")) {
      if (literals.length === 0) incompatible(undefined, "The Schema requires a different root type");
      continue;
    }
    for (const argument of event.args) {
      const { name, qualifier, operand } = argument;
      if (operand.kind === "literal" || maybeAbsent?.has(argument)) continue;
      if (objects.length > 0 && roots.every(root => root.kind !== "any")
        && objects.every(root => root.members.every(member => member.name !== name))) {
        incompatible(name, `unknown key at ${name}`);
        continue;
      }
      const actual = qualifier === "str" ? "string" : qualifier === "num" || operand.kind === "pointer" ? "number" : undefined;
      if (actual === undefined) continue;
      const domains = project_schema_data(schema, [name]);
      if (domains.length > 0 && domains.every(domain => domain.kind !== "any" && domain.kind !== actual
        && (domain.kind !== "exact" || (domain.value === null ? "null" : typeof domain.value) !== actual))) {
        incompatible(name, `Argument ${JSON.stringify(name)} supplies a value of type ${actual}`);
      }
    }
  }
  if (typescript !== undefined && checker !== undefined) for (const write of facts.writes) {
    for (const argument of write.arguments) {
      if (!is_part_scalar_qualifier(argument.kind)) continue;
      const type = checker.getTypeAtLocation(argument.expression);
      const expected = argument.kind === "str" ? typescript.TypeFlags.StringLike : typescript.TypeFlags.NumberLike;
      // Structural object types such as {} and String can admit primitives.
      // Only diagnose when every alternative excludes the required primitive.
      const known = typescript.TypeFlags.StringLike | typescript.TypeFlags.NumberLike | typescript.TypeFlags.BooleanLike
        | typescript.TypeFlags.Null | typescript.TypeFlags.Undefined | typescript.TypeFlags.BigIntLike | typescript.TypeFlags.ESSymbolLike | typescript.TypeFlags.NonPrimitive;
      if ((type.isUnion() ? type.types : [type]).every(alternative => (alternative.flags & known) !== 0 && (alternative.flags & expected) === 0)) {
        report(argument.valueLocation, "HSON_PART_ARGUMENT_INVALID", `Part.write argument ${JSON.stringify(argument.name)} requires ${argument.kind === "str" ? "a string" : "a finite number"}.`,
          write.definition.bindingSources?.declarations.find(binding => binding.incoming === argument.name)?.location);
      }
    }
  }
  for (const document of facts.documents) {
    // Grammar and declared-name conflicts are local facts; they require no receiver shape.
    const isDefinition = facts.batches.some(batch => batch.eligible && batch.libraries.some(library => library.family === "parts"
      && library.members.some(member => member.documents.includes(document))));
    const ordinaryReceiver = !isDefinition && document.receivers.some(receiver => receiver.library?.family === "document"
      && (receiver.certainty === "certain" || receiver.placementCertain));
    for (const flag of document.partDeclarations) {
      if (flag.issue !== undefined) report(flag.location, "HSON_PART_DECLARATION_INVALID", flag.issue);
      else if (!isDefinition && document.receivers.some(receiver => receiver.certainty === "certain" && receiver.library?.family === "document")) {
        report(flag.location, "HSON_PART_DECLARATION_INVALID", "hson:part is only allowed on a governed Part definition root.");
      }
    }
    if (isDefinition && document.admission === "qualified" && document.librarySourceAdmission === "qualified" && document.partDeclarations.every(flag => !flag.root)) {
      report(document.definitionRoot, "HSON_PART_DECLARATION_MISSING", "Part definition root requires the hson:part flag.");
    }
    for (const flag of document.optionalStructures) {
      if (flag.issue !== undefined) report(flag.location, "HSON_PART_OPTIONAL_INVALID", flag.issue);
      else if (!isDefinition && document.receivers.some(receiver => receiver.certainty === "certain" && receiver.library?.family === "document")) {
        report(flag.location, "HSON_PART_OPTIONAL_INVALID", "part:optional is only allowed within a governed Part definition.");
      }
    }
    for (const iterator of document.iteratorDeclarations) {
      if (isDefinition && iterator.issue !== undefined || ordinaryReceiver) report(iterator.location, "HSON_PART_REFERENCE_INVALID",
        iterator.issue ?? "Part iteration is only allowed within a governed Part definition.");
    }
    if (isDefinition) for (const issue of document.referenceIssues) report(issue.location, "HSON_PART_REFERENCE_INVALID", issue.message, issue.declaration, issue.attachment);
    if (isDefinition) for (const use of document.bindingSources?.references ?? []) {
      const binding = use.declaration;
      // Initial proof boundary: exact, unconditional reads of a directly
      // received Data alias. Iteration/forwarding/conditional structure supplies
      // no guaranteed execution, and optional ancestors supply no presence proof.
      const event = use.context === "event";
      if ((!event && use.context !== "value") || use.conditional || use.withinOptionalStructure || use.iterators.length !== 0 || use.resolution !== "resolved"
        || binding?.origin !== "receiving" || binding.kind !== "data" || binding.incoming === undefined
        || use.reference.path.length === 0) continue;
      for (const context of part_data_contexts(facts, document, binding.incoming)) {
        if (context.receiving !== binding || !context.executionCertain || context.evidence?.strength !== "validated"
          || context.argument === undefined || context.connector === undefined || (!event && memberInvocations.has(context.connector))) continue;
        const alternatives = part_data_projection(context.evidence, use.reference.path).alternatives;
        const invalid = alternatives.length > 0 && alternatives.every(alternative => alternative.presence === "required"
          && (alternative.kind === "invalid-traversal" || !use.reference.optional && alternative.kind === "absent"));
        if (!invalid) continue;
        const selector = context.connector.attributes.find(attribute => attribute.name === "at")?.valueLocation;
        const where = selector?.precision === "exact" ? selector : context.argument.nameLocation;
        if (where.precision !== "exact" || use.location.precision !== "exact" || binding.location.precision !== "exact") continue;
        if (!event) memberInvocations.add(context.connector);
        output.push({ ...where, code: "HSON_PART_DATA_MEMBER_INVALID",
          message: `Part reference ^{${use.reference.reference}} cannot succeed for this invocation's validated Data Schema.`,
          related: [{ ...use.location, message: "Authored Part reference." }, { ...binding.location, message: `Receiving local ${binding.name} from incoming ${binding.incoming}.` },
            { ...context.evidence.schemaLocation, message: "Validated input Schema." },
            ...(use.attachment === undefined ? [] : [{ ...use.attachment, message: "Part event attachment." }])] });
      }
    }
    // A known invocation can disprove its own collection input. It never supplies
    // a universal Schema for the reusable definition. Nested value checks also
    // require evidence that every enclosing iterator reaches the checked source.
    if (ordinaryReceiver && document.receivers.length === 1) {
      const batch = facts.batches.find(batch => batch.call === document.receivers[0]!.batch);
      for (const connector of document.connectors) {
        if (!batch?.eligible || !connector.headerComplete) continue;
        const coordinates = part_source_coordinates(connector);
        if (coordinates === undefined || coordinates.issue !== undefined) continue;
        const { library: lib, member: at } = coordinates;
        const libraries = batch.libraries.filter(library => library.name === lib && library.family === "parts");
        const members = libraries.length === 1 ? libraries[0]!.members.filter(member => member.name === at) : [];
        const definition = members.length === 1 ? members[0]!.contractSource : undefined;
        if (definition?.signature === undefined) continue;
        const inputs = new Map<string, OrderedProjectedValue | undefined>();
        const literalInput = (name: string): OrderedProjectedValue | undefined => {
          if (!inputs.has(name)) {
            const argument = connector.attributes.find(attribute => attribute.name === name);
            try { inputs.set(name, argument?.value === undefined ? undefined : admit_data_source(argument.value)); }
            catch { inputs.set(name, undefined); } // Serialized input diagnostics own invalid Data.
          }
          return inputs.get(name);
        };
        for (const iterator of definition.iteratorDeclarations) {
          const origin = part_iterator_source_origin(definition, iterator), kind = iterator.declaration?.kind;
          if (origin === undefined || kind === undefined || iterator.issue !== undefined) continue;
          if (iterator.enclosingIterators === undefined || !iterator.enclosingIterators.every(where => {
            const ancestor = definition.iteratorDeclarations.find(candidate => candidate.location.start === where.start && candidate.location.end === where.end);
            const source = ancestor === undefined ? undefined : part_iterator_source_origin(definition, ancestor);
            const declaration = ancestor?.declaration;
            if (source === undefined || declaration === undefined || ancestor?.issue !== undefined) return false;
            const input = literalInput(`${source.incoming}:data`);
            if (input === undefined) return false;
            const values = project_ordered_data(input, source.path, true);
            // Schema member multiplicity, unknown inputs and empty collections
            // cannot establish execution. Require all projected contexts to run:
            // independently bound sources must not borrow reachability from a
            // different outer element. Runtime owns uncertain correlations.
            return values.length > 0 && values.every(value => declaration.kind === "array"
              ? Array.isArray(value) && value.length > 0
              : is_ordered_projected_object(value) && value.entries.length > 0);
          })) continue;
          const argument = connector.attributes.find(attribute => attribute.name === `${origin.incoming}:data`);
          if (argument === undefined) continue;
          let invalid = false;
          const input = literalInput(argument.name);
          if (input !== undefined) {
            const values = project_ordered_data(input, origin.path);
            invalid = values.some(value => kind === "array" ? !Array.isArray(value) : !is_ordered_projected_object(value));
          }
          // Unknown member multiplicity can be zero; withhold unconditional errors.
          if (argument.dataSchema !== undefined && !origin.path.some(step => step === null || step === OBJECT_VALUE)) {
            const nodes = project_schema_data(argument.dataSchema, origin.path);
            invalid ||= nodes.length > 0 && nodes.every(node => node.kind !== "any" && node.kind !== "ref"
              && (kind === "object" ? node.kind !== "object" : node.kind !== "array" && node.kind !== "tuple"));
          }
          if (invalid) report(argument.valueLocation?.precision === "exact" ? argument.valueLocation : argument.nameLocation,
            "HSON_PART_REFERENCE_INVALID", `Part iterator ${JSON.stringify(iterator.declaration!.attribute)} requires ${kind} Data for this invocation.`, iterator.location);
        }
      }
    }
    for (const connector of document.connectors) {
      if (!connector.headerComplete) continue;
      for (const attribute of connector.attributes) {
        const issue = part_direction_issue("hson-part", attribute.name);
        if (issue !== undefined) report(attribute.nameLocation, "HSON_PART_ARGUMENT_INVALID", issue);
      }
      const coordinates = part_source_coordinates(connector);
      if (coordinates?.issue !== undefined) {
        // Missing inherited context is invalid only at a proven ordinary receiver;
        // an unseen consumer may register this source as a Part definition.
        if (!ordinaryReceiver && coordinates.field === "lib" && !connector.attributes.some(attribute => attribute.name === "lib")) continue;
        const attribute = connector.attributes.find(attribute => attribute.name === coordinates.field);
        report(attribute?.valueLocation ?? attribute?.nameLocation ?? connector.location, "HSON_PART_COORDINATES_INVALID", coordinates.issue);
      }
    }
    if (document.admission === "qualified") for (const connector of document.connectors) {
      const supplied = new Set<string>();
      for (const attribute of connector.attributes.filter(attribute => is_part_argument_attribute(attribute.name))) {
        const argument = part_argument_name(attribute.name);
        if (argument === undefined) {
          report(attribute.nameLocation, "HSON_PART_ARGUMENT_INVALID", part_argument_issue(attribute.name));
          continue;
        }
        if (supplied.has(argument.name)) report(attribute.nameLocation, "HSON_PART_ARGUMENT_CONFLICT", `Conflicting Part argument ${JSON.stringify(argument.name)}.`);
        supplied.add(argument.name);
        if (attribute.scalarIssue !== undefined && !isDefinition) {
          report(attribute.valueLocation ?? attribute.nameLocation, "HSON_PART_ARGUMENT_INVALID", attribute.scalarIssue);
        }
        if ((argument.kind === "data" || argument.kind === "doc") && attribute.value !== undefined && whole_part_reference(attribute.value) === undefined) {
          try {
            if (argument.kind === "data") admit_data_source(attribute.value);
            else {
              const root = qualify_hson_document_root(parse_authored_document_library(attribute.value).root);
              if (root.$_content.length !== 1 || !is_ordinary_element_node(root.$_content[0])) throw new TypeError("Document input requires one authored element.");
            }
          }
          catch (cause) { report(attribute.valueLocation, argument.kind === "data" ? "HSON_PART_DATA_INVALID" : "HSON_PART_DOCUMENT_INVALID", `Invalid serialized ${argument.kind} for ${JSON.stringify(argument.name)}: ${String(cause)}`); }
        }
      }
    }
    // Possible, conditional, multiple and open-world receivers cannot prove absence.
    // Do not filter alternatives to turn an ambiguous relationship into a certain one.
    if ((document.librarySourceAdmission !== "qualified" && !document.valueIndependentAdmission) || document.receivers.length !== 1) continue;
    const receiver = document.receivers[0]!;
    // A stored Part can be composed after later admissions or governed writes.
    // Its collection relationship alone does not establish an initial execution context.
    if ((receiver.certainty !== "certain" && !receiver.placementCertain) || receiver.library?.family !== "document") continue;
    const batch = facts.batches.find(batch => batch.call === receiver.batch);
    if (batch === undefined || !batch.eligible || batch.receivingInventory !== "candidate-only"
      || batch.inventoryCompleteness !== "complete") continue;
    const inventoryCertain = batch.libraries.every(library => library === receiver.library || library.certainty === "certain");
    for (const connector of document.connectors) {
      if (!connector.headerComplete) continue;
      const coordinates = part_source_coordinates(connector);
      if (coordinates === undefined || coordinates.issue !== undefined) continue;
      const lib = connector.attributes.find(attribute => attribute.name === "lib");
      const at = connector.attributes.find(attribute => attribute.name === "at");
      const libraryLocation = coordinates.qualified ? at?.valueLocation : lib?.valueLocation;
      const memberLocation = at?.valueLocation;
      const { library: libraryName, member: memberName } = coordinates;
      const arguments_ = connector.attributes.filter(attribute => is_part_argument_attribute(attribute.name));
      // Argument names and representation prefixes are known independently of values.
      if (arguments_.some(attribute => part_argument_name(attribute.name) === undefined
        || attribute.value === undefined && !attribute.dynamicValue)) continue;
      const libraries = batch.libraries.filter(library => library.name === libraryName);
      if (libraries.length === 0 || libraries.length === 1 && libraries[0]!.family !== "parts") {
        if (inventoryCertain) report(libraryLocation, "HSON_PART_LIBRARY_UNKNOWN", `Unknown Parts Library ${JSON.stringify(libraryName)}.`);
        continue;
      }
      const library = libraries.length === 1 ? libraries[0] : undefined;
      if (library?.family !== "parts") continue;
      const members = library.members.filter(member => member.name === memberName);
      if (members.length === 0) {
        if (inventoryCertain && library.memberCompleteness === "complete") {
          report(memberLocation, "HSON_PART_MEMBER_UNKNOWN", `Unknown Part member ${JSON.stringify(memberName)} in Parts Library ${JSON.stringify(libraryName)}.`);
        }
        continue;
      }
      const member = members.length === 1 ? members[0] : undefined;
      const definition = member?.contractSource;
      const contract = definition?.signature;
      if (member === undefined || definition === undefined || contract === undefined) continue;
      const supplied = new Set(arguments_.map(attribute => part_argument_name(attribute.name)!.name));
      const contractLocation = (name: string) => definition.bindingSources?.declarations.find(binding => binding.incoming === name)?.location
        ?? definition.bindingSources?.references.find(use => use.reference.namespace === "incoming" && use.reference.name === name)?.root
        ?? member.declaration;
      for (const [name, requiredness] of contract.requiredness) if (!supplied.has(name) && requiredness === "required") {
        report(connector.location.precision === "exact" ? connector.location : at?.nameLocation ?? lib?.nameLocation,
          "HSON_PART_ARGUMENT_MISSING", `Missing Part parameter ${JSON.stringify(name)} for ${JSON.stringify(`${libraryName}/${memberName}`)}.`, contractLocation(name));
      }
      for (const attribute of arguments_) {
        const argument = part_argument_name(attribute.name)!;
        const kind = contract.parameters.get(argument.name);
        if (kind === undefined) {
          // An opaque attachment can add a scalar read. Structured inputs
          // still need a receiving declaration in the known Part body.
          if (argument.kind !== "scalar" || definition.parameterCompleteness === "complete") {
            report(attribute.nameLocation, "HSON_PART_ARGUMENT_UNKNOWN", `Unknown Part parameter ${JSON.stringify(attribute.name)} for ${JSON.stringify(`${libraryName}/${memberName}`)}.`, member.declaration);
          }
        } else if (argument.kind !== kind) {
          report(attribute.nameLocation, "HSON_PART_ARGUMENT_INVALID", `Part parameter ${JSON.stringify(argument.name)} requires ${kind} in the receiving interface of ${JSON.stringify(`${libraryName}/${memberName}`)}; supplied ${argument.kind}.`, contractLocation(argument.name));
        }
      }
    }
  }
  return output;
}

/** Keep absence and known values correlated within each root alternative. */
function event_schema_branch_viable(graph: VerifiedCanonicalSchemaGraph, fields: OrderedProjectedObject,
  omitted: ReadonlySet<string>): boolean {
  let budget = 256;
  const viable = (ref: number, depth: number): boolean => {
    if (--budget < 0 || depth >= 64) return true;
    const node = graph.nodes[ref];
    switch (node?.kind) {
      case "projected-union": return node.choices.some(choice => viable(choice, depth + 1));
      case "projected-ref": return viable(node.target, depth + 1);
      case "projected-refinement":
      case "projected-nullable":
      case "projected-optional": return viable(node.base, depth + 1);
      case "projected-object":
        if (node.properties.some(([name, child]) => omitted.has(name) && graph.nodes[child]?.kind !== "projected-optional")) return false;
        break;
      case "projected-literal":
        if (!node.values.some(value => is_ordered_projected_object(value) && value.entries.every(([name]) => !omitted.has(name)))) return false;
        break;
    }
    const evaluation = evaluate_canonical_projected_fields({ ...graph, capabilities: { projectedRoot: ref } }, fields);
    return evaluation.ok || evaluation.issues.some(issue => issue.evidence.kind === "resource-limit" || issue.evidence.kind === "invalid-graph");
  };
  const root = graph.capabilities.projectedRoot;
  return root === undefined || viable(root, 0);
}

/** Pure preflight over authored ASTs. Unknown expressions withdraw the entire proof. */
export function static_schema_candidate_diagnostics(typescript: typeof ts, program: ts.Program): readonly StaticSchemaDiagnostic[] {
  const checker = program.getTypeChecker();
  const schemas = new Map<ts.Declaration, Schema>();
  const sources = program.getSourceFiles().filter(source => !source.isDeclarationFile && !program.isSourceFileFromExternalLibrary(source)
    && !source.fileName.replaceAll("\\", "/").split("/").includes(".hson"));
  const sourceCandidates = static_source_candidates(typescript, checker, program);
  for (const source of sources) for (const found of discover_hson_schema_declarations(typescript, source, checker, sourceCandidates.eligible)) {
    if (!found.eligible || found.source === undefined) continue;
    const compiled = compile_hson_schema(found.source);
    if (compiled.ok) schemas.set(found.declaration, { declaration: found.declaration, name: found.name, compiled: compiled.value });
  }
  const { declaration, candidates } = sourceCandidates;
  const schema = (input: ts.Expression, use: "value" | "type-query" = "value"): Schema | undefined => resolve_immutable_schema(typescript, checker, input, found => schemas.get(found), new Set(), sourceCandidates.eligible, use);
  const output: StaticSchemaDiagnostic[] = [];
  const reported = new Set<string>();
  const representationReported = new Set<ts.Expression>();
  const reportJsonSource = (json: ts.Expression): boolean => {
    if (!library_json_has_hson_source(typescript, checker, json, sourceCandidates.eligible)) return false;
    if (!representationReported.has(json)) {
      representationReported.add(json);
      output.push({ file: json.getSourceFile().fileName, start: json.getStart(), end: json.getEnd(),
        code: "HSON_LIBRARY_JSON_SOURCE", message: "HSON source supplied to json. Use the hson channel for source, or supply semantic Data under json." });
    }
    return true;
  };
  const report = (contract: Schema | undefined, input: ts.Expression, family: "certify" | "document" | "data" | "json", parts?: ReadonlyMap<string, unknown>): void => {
    if (contract === undefined) return;
    const possible = candidates(input, family === "certify" ? contract.compiled.semantic.kind === "document" || contract.compiled.semantic.kind === "document-element" ? "document" : "json" : family);
    if (possible === undefined || possible.length === 0) return;
    const failures = possible.map(candidate => evaluate_static_schema_candidate(contract.compiled, candidate, parts));
    // A valid branch, opaque branch or malformed Hson belongs to runtime/authoring diagnostics.
    if (failures.some(failure => failure.kind !== "invalid")) return;
    const first = failures[0];
    if (first?.kind !== "invalid") return;
    const candidate = possible[0]!;
    const local = possible.length === 1 && candidate.node.getSourceFile() === input.getSourceFile();
    const node = local ? candidate.node : input;
    const range = local && "source" in candidate && candidate.bodyStart !== undefined && candidate.bodyStart >= 0 && first.range !== undefined
      ? { start: candidate.bodyStart + first.range.start, end: candidate.bodyStart + first.range.end }
      : { start: node.getStart(), end: node.getEnd() };
    // Key the underlying proof, not its wording or chosen display anchor.
    const identity = (entry: ts.Node) => [entry.getSourceFile().fileName, entry.getStart(), entry.getEnd()];
    const key = JSON.stringify([identity(contract.declaration), possible.map(entry => identity(entry.node)),
      first.issue.code, first.issue.schemaNode, first.issue.path, first.issue.attributeName, first.issue.evidence]);
    if (reported.has(key)) return;
    reported.add(key);
    output.push({ file: node.getSourceFile().fileName, ...range, code: first.issue.code,
      ...(possible.length === 1 && candidate.bodyStart !== undefined && candidate.bodyStart >= 0 && first.relatedRange !== undefined ? { related: [{
        file: candidate.node.getSourceFile().fileName, start: candidate.bodyStart + first.relatedRange.start, end: candidate.bodyStart + first.relatedRange.end,
        message: `Conflicting value at ${first.issue.evidence.relatedPath?.join(".")}; derived key ${first.issue.received}.`,
      }] } : {}),
      message: `Static Hson does not satisfy ${contract.name}: ${issue_detail(first.issue)}${possible.length > 1 ? " (all static alternatives fail)." : "."}` });
  };
  for (const source of sources) {
    const mapSymbols = read_supported_hson_import_symbols(source, checker, [], "hsonLiveMap", typescript);
    const construction = (node: ts.Expression) => sourceCandidates.eligible(node)
      ? library_source_definitions(node, checker, mapSymbols, false, typescript, sourceCandidates.eligible) : undefined;
    const inventory = (definitions: ts.ObjectLiteralExpression) => static_part_inventory(typescript, checker, definitions, sourceCandidates);
    const knownObject = (input: ts.Expression): ts.ObjectLiteralExpression | undefined => {
      const alternatives = sourceCandidates.alternatives(input, "json");
      const only = alternatives.complete && alternatives.nodes.length === 1 ? alternatives.nodes[0] : undefined;
      return only !== undefined && typescript.isObjectLiteralExpression(only) ? only : undefined;
    };
    const checkRepresentation = (input: ts.Expression): void => {
      const definition = knownObject(input);
      const fields = definition === undefined ? undefined : library_source_fields(definition, typescript);
      const json = fields?.get("json");
      if (json !== undefined && !["hson", "document", "parts", "data"].some(key => fields?.has(key))) reportJsonSource(json);
    };
    const validateDefinition = (definition: ts.Expression, parts?: ReadonlyMap<string, unknown>): void => {
      if (!typescript.isObjectLiteralExpression(definition)) return;
      const fields = library_source_fields(definition, typescript);
      if (fields === undefined) return;
      const document = fields.get("document"), json = fields.get("json"), hson = fields.get("hson");
      const contract = fields.get("schema") === undefined ? undefined : schema(fields.get("schema")!);
      if (fields.has("data") || fields.has("parts")) return;
      if (Number(document !== undefined) + Number(json !== undefined) + Number(hson !== undefined) !== 1) return;
      if (document !== undefined) report(contract, document, "document", parts);
      if (json !== undefined) {
        if (!reportJsonSource(json)) report(contract, json, "json");
      }
      if (hson !== undefined) report(contract, hson, "data");
    };
    // Annotation relationships retain the direct, official, substitution-free
    // initializer boundary used to establish compiler/editor assignment proof.
    for (const statement of source.statements) {
      if (!typescript.isVariableStatement(statement) || (statement.declarationList.flags & typescript.NodeFlags.Const) === 0
        || statement.declarationList.declarations.length !== 1) continue;
      const found = statement.declarationList.declarations[0];
      if (found?.type === undefined || found.initializer === undefined) continue;
      const annotationNode = found.type;
      const annotation = resolve_hson_schema_annotation(typescript, checker, annotationNode, sourceCandidates.eligible);
      if (annotation === undefined) continue;
      const initializer = found.initializer;
      if (!typescript.isTaggedTemplateExpression(initializer)) continue;
      const exact = typescript.isPropertyAccessExpression(initializer.tag) && initializer.tag.name.text === "parse";
      const tag = exact && typescript.isPropertyAccessExpression(initializer.tag) ? initializer.tag.expression : initializer.tag;
      if (!typescript.isPropertyAccessExpression(tag)
        || !["data", "document"].includes(tag.name.text) || !typescript.isIdentifier(tag.expression)
        || exact && tag.name.text !== "data"
        || !is_official_hson_package_binding(tag.expression, "Hson", checker, true, typescript, sourceCandidates.eligible)
        || !typescript.isNoSubstitutionTemplateLiteral(initializer.template) || initializer.template.isUnterminated) continue;
      const contract = annotation.schema === undefined ? undefined : schema(annotation.schema, "type-query");
      const annotationDiagnostic = (code: string, message: string): void => {
        output.push({ file: source.fileName, start: annotationNode.getStart(), end: annotationNode.getEnd(), code, message });
      };
      if (annotation.kind === "projected") {
        if (contract !== undefined && annotation.schema !== undefined && tag.name.text === "data") annotationDiagnostic("HSON_PROJECTED_VALUE_ANNOTATION",
          exact
            ? `This Hson.data.parse template produces an exact HsonDataValue governed by ${contract.name}, but the annotation describes its JSON/JS value representation. For exact Data, use HsonDataValue<typeof ${annotation.schema.text}>.`
            : `This Hson.data template produces the Hson representation governed by ${contract.name}, but the annotation describes its JSON/JS value representation. For Hson source, use HsonFromSchema<typeof ${annotation.schema.text}>.`);
        continue;
      }
      if (exact ? annotation.kind !== "value" : annotation.kind === "value"
        || annotation.kind !== "hson" && tag.name.text !== annotation.kind) continue;
      if (contract === undefined) {
        annotationDiagnostic("HSON_SCHEMA_PROOF_UNRESOLVED", `Unable to resolve the Schema proof for this ${annotation.kind === "hson" ? "HsonFromSchema" : annotation.kind === "value" ? "HsonDataValue" : annotation.kind === "data" ? "HsonData" : "HsonDocument"} annotation; use typeof a statically known Hson.schema binding.`);
        continue;
      }
      report(contract, initializer, exact ? "json" : tag.name.text === "data" ? "data" : "document");
    }
    const visit = (node: ts.Node): void => {
      if (typescript.isCallExpression(node)) {
        if (typescript.isPropertyAccessExpression(node.expression) && node.expression.name.text === "certify" && node.arguments.length === 1) report(schema(node.expression.expression), node.arguments[0]!, "certify");
        const definitions = construction(node);
        if (definitions !== undefined) {
          const parts = inventory(definitions);
          for (const definition of library_source_fields(definitions, typescript)?.values() ?? []) validateDefinition(definition, parts);
        }
        const admission = library_source_admission(node, checker, mapSymbols, false, typescript, sourceCandidates.eligible);
        const representationDefinitions = admission?.eligible ? knownObject(admission.definitions) : undefined;
        if (representationDefinitions !== undefined) for (const definition of library_source_fields(representationDefinitions, typescript)?.values() ?? []) checkRepresentation(definition);
        if (admission?.eligible && (admission.operation === "create" || admission.operation === "resume")) {
          const configuration = node.arguments[1];
          const local = configuration !== undefined && typescript.isObjectLiteralExpression(configuration)
            ? library_source_fields(configuration, typescript)?.get("local") : undefined;
          if (local !== undefined && typescript.isArrayLiteralExpression(local)) for (const entry of local.elements) {
            const initializer = typescript.isObjectLiteralExpression(entry) ? library_source_fields(entry, typescript)?.get("initializer") : undefined;
            if (initializer !== undefined) validateDefinition(initializer);
          }
        }
      }
      typescript.forEachChild(node, visit);
    };
    visit(source);
  }
  return output;
}

function issue_detail(issue: CanonicalGraphIssue): string {
  const description = issue.code === "MISSING_REQUIRED" ? "missing required child/value" : issue.evidence.kind === "document-tag-mismatch" ? "wrong tag" : issue.code.replaceAll("_", " ").toLowerCase();
  return `${description} at ${issue.path.join(".") || "root"}${issue.attributeName === undefined ? "" : ` attribute ${JSON.stringify(issue.attributeName)}`}${issue.expected === undefined ? "" : `; expected ${issue.expected}`}${issue.received === undefined ? "" : `; received ${issue.received}`}`;
}
