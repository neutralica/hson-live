import type ts from "typescript";
import { discover_hson_schema_declarations } from "./schema-discovery.js";
import { compile_hson_schema, type CompiledHsonSchema } from "./compiler.js";
import { is_official_hson_package_binding, read_supported_hson_import_symbols } from "../embedded-hson/discover-hson-tagged-templates.js";
import { evaluate_static_schema_candidate, type StaticDocumentLibraryContext } from "./candidate-evaluation.js";
import { resolve_immutable_schema } from "./schema-identity.js";
import { evaluate_canonical_projected_fields, evaluate_canonical_projected_schema } from "../canonical-schema/evaluate.js";
import type { CanonicalGraphIssue } from "../canonical-schema/issues.js";
import { resolve_hson_schema_annotation } from "./schema-annotation.js";
import { library_source_admission } from "./library-source.js";
import { library_json_has_hson_source } from "./library-json-source.js";
import { static_event_parser } from "./static-event-parser.js";
import { PartOwnershipWork, static_source_candidates } from "./source-candidates.js";
import { part_source_coordinates, part_iterator_source_origin, static_part_collection, type PartConnectorSource, type PartDocumentSource, type PartSourceFacts, type PartSourceLocation } from "./part-source.js";
import { OBJECT_VALUE, inspect_schema_data, project_ordered_data } from "./data-projection.js";
import { is_ordered_projected_object, ordered_projected_object, type OrderedProjectedValue } from "../../core/ordered-projected-value.js";
import { ordered_projected_value_at } from "../../core/ordered-projected-value-mutation.js";
import { is_part_argument_attribute, is_part_scalar_qualifier, part_argument_name, part_argument_issue, part_direction_issue, whole_part_reference } from "../part-placeholder.js";
import { qualify_hson_document_root } from "../../api/document/hson-document.js";
import { parse_authored_document_library } from "../../api/livemap/livemap.document.quad.js";
import { is_ordinary_element_node } from "../../core/node-guards.js";
import { admit_data_source } from "../../core/data-source-admission.js";
import { certain_part_invocations, part_data_contexts, part_data_projection } from "../editor-introspection/part-data-evidence.js";
import type { PartBindingReference } from "../editor-introspection/part-bindings.js";
import { event_argument_references, type AuthoredEventArgument } from "../authored-events.js";
import { is_event_argument_value } from "../event-argument-plan.js";

type StaticSchemaDiagnosticLocation = Readonly<{ file: string; start: number; end: number; message: string }>;
export type StaticSchemaDiagnostic = StaticSchemaDiagnosticLocation & Readonly<{ code: string; related?: readonly StaticSchemaDiagnosticLocation[] }>;
type Schema = Readonly<{ declaration: ts.VariableDeclaration; name: string; compiled: CompiledHsonSchema }>;
type EventArgumentEvidence = "present" | "absent" | "conditional" | "opaque" | Readonly<{ value: OrderedProjectedValue }>;

function same_part_range(left: PartSourceLocation | undefined, right: PartSourceLocation | undefined): boolean {
  return left?.precision === "exact" && right?.precision === "exact"
    && left.file === right.file && left.start === right.start && left.end === right.end;
}

/** Use the same receiving and lexical identities as Part composition. Only a
 * certain direct connector can refine a conditional read to a concrete result. */
function event_reference_evidence(definition: PartDocumentSource | undefined, use: PartBindingReference | undefined,
  argument: AuthoredEventArgument, connector?: PartConnectorSource): EventArgumentEvidence {
  if (definition === undefined || use === undefined || use.conditional
    || definition.referenceIssues.some(issue => same_part_range(issue.location, use.location))) return "opaque";
  const { reference, declaration } = use;
  const incoming = reference.namespace === "incoming" ? reference.name : declaration?.incoming;
  const requiredness = incoming === undefined ? undefined : definition.signature?.requiredness.get(incoming);
  if (reference.namespace === "local" ? use.resolution !== "resolved" : requiredness === undefined || reference.path.length !== 0) return "opaque";
  const optionalRoot = declaration?.optionalReceiving === true
    || reference.namespace === "incoming" && requiredness === "optional" && (reference.optional || declaration !== undefined);
  if (connector === undefined) return optionalRoot || reference.optional ? "conditional" : "present";
  if (incoming === undefined || use.withinOptionalStructure || use.iterators.length > 0) return "opaque";
  const supplied = connector.attributes.find(attribute => part_argument_name(attribute.name)?.name === incoming);
  if (supplied === undefined) return optionalRoot && requiredness === "optional" ? "absent" : "opaque";
  if (supplied.dynamicValue || supplied.value === undefined || supplied.scalarIssue !== undefined) return "opaque";
  const kind = definition.signature?.parameters.get(incoming);
  if (kind === "scalar" || kind === "str" || kind === "num") {
    const qualifier = kind === "num" ? "num" : "str";
    return reference.path.length === 0 && (argument.operand.kind === "interpolation" || argument.qualifier === "data"
      || argument.qualifier === qualifier) ? "present" : "opaque";
  }
  if (kind !== "data") return "opaque";
  let value: OrderedProjectedValue | undefined;
  try { value = admit_data_source(supplied.value); }
  catch { return "opaque"; }
  for (const selector of reference.path) {
    if (typeof selector === "number" ? !Array.isArray(value) : !is_ordered_projected_object(value)) return "opaque";
    value = ordered_projected_value_at(value, [selector]);
    if (value === undefined) return reference.optional ? "absent" : "opaque";
  }
  if (argument.operand.kind === "interpolation") return value === null || typeof value !== "object" ? "present" : "opaque";
  return is_event_argument_value(argument.qualifier, value) ? { value } : "opaque";
}

/** Editor-only projection of compiler-owned facts. Never included in Schema build/Watch policy. */
export function static_part_reference_diagnostics(facts: PartSourceFacts, typescript?: typeof ts, checker?: ts.TypeChecker): readonly StaticSchemaDiagnostic[] {
  const output: StaticSchemaDiagnostic[] = [];
  const reported = new Set<string>();
  const memberInvocations = new Set<object>();
  const report = (where: PartSourceLocation | undefined, code: string, message: string,
    declaration?: PartSourceLocation, attachment?: PartSourceLocation, declarationMessage = "Relevant Part declaration.", attachmentMessage = "Part event attachment."): void => {
    if (where?.precision !== "exact") return;
    const key = JSON.stringify([where.file, where.start, where.end, code, message, attachment]);
    if (reported.has(key)) return;
    reported.add(key);
    const related: StaticSchemaDiagnosticLocation[] = [];
    if (declaration?.precision === "exact") related.push({ file: declaration.file, start: declaration.start, end: declaration.end,
      message: declarationMessage });
    if (attachment?.precision === "exact") related.push({ file: attachment.file, start: attachment.start, end: attachment.end,
      message: attachmentMessage });
    output.push({ file: where.file, start: where.start, end: where.end, code, message, ...(related.length === 0 ? {} : { related }) });
  };
  for (const issue of facts.eventIssues) report(issue.location, issue.code, issue.message, issue.declaration, issue.attachment, "First declaration.", "Document Event metadata.");
  for (const [literal, owners] of facts.eventOwners) {
    const source = facts.parsedEvents.get(literal);
    if (source === undefined || owners.size !== 1) continue;
    const { event, location, map } = source;
    const domain = event.kind === "locus" ? "host" : "local";
    const matches = facts.actionDeclarations.filter(action => owners.has(action.owner) && action.domain === domain && action.name === event.key);
    if (matches.length !== 1) continue;
    const action = matches[0]!;
    const attachments = facts.eventAttachments.get(literal) ?? [];
    const label = JSON.stringify(event.key);
    if (event.args.length === 0) {
      if (action.required) for (const { location: attachment } of attachments) report(location, "HSON_EVENT_INPUT_REQUIRED",
        `Action ${label} requires arguments. Supply named typed arguments in this event declaration.`,
        action.requiredLocation, attachment, "This Action declares required arguments.", "Event attachment.");
      continue;
    }
    if (action.schema === undefined) continue;
    const schema = action.schema;
    const argumentsByName = new Map(event.args.map(argument => [argument.name, argument]));
    const argumentLocation = (name: string | undefined) => {
      const argument = name === undefined ? undefined : argumentsByName.get(name);
      return argument === undefined ? location : map({ start: argument.header.index, end: argument.end.index });
    };
    const roots = inspect_schema_data(schema.value, []).alternatives;
    const ambiguous = roots.length !== 1 || roots[0]?.kind !== "supported";
    const evaluate = (states: ReadonlyMap<string, EventArgumentEvidence>, attachment: PartSourceLocation): void => {
      const invalid = (name: string | undefined, detail: string) => report(argumentLocation(name), "HSON_EVENT_ARGUMENT_INVALID",
        `Arguments for Action ${label} do not match its Schema. ${detail}.`, schema.location, attachment, "Action argument Schema.", "Event attachment.");
      const missing = (name: string) => report(location, "HSON_EVENT_ARGUMENT_MISSING",
        `Action ${label} requires argument ${JSON.stringify(name)}.`, schema.location, attachment, "Action argument Schema.", "Event attachment.");
      const known: [string, OrderedProjectedValue][] = [];
      const unknown = new Map<string, boolean>();
      for (const [name, state] of states) {
        if (typeof state === "object") known.push([name, state.value]);
        else if (state !== "absent") unknown.set(name, state === "present");
      }
      const fields = ordered_projected_object(known);
      const evaluation = unknown.size === 0 ? evaluate_canonical_projected_schema(schema.value.graph, fields)
        : evaluate_canonical_projected_fields(schema.value.graph, fields, unknown);
      const commonMissing = new Set<string>();
      const firstRoot = roots[0];
      if (ambiguous && firstRoot?.kind === "supported" && firstRoot.node.kind === "object") {
        for (const { name, optional } of firstRoot.node.members) {
          if (!optional && (!argumentsByName.has(name) || states.get(name) === "absent") && roots.every(root => root.kind === "supported"
            && root.node.kind === "object" && root.node.members.some(member => member.name === name && !member.optional))) {
            commonMissing.add(name);
            missing(name);
          }
        }
      }
      for (const issue of evaluation.issues) {
        if (issue.evidence.kind === "resource-limit" || issue.evidence.kind === "invalid-graph") continue;
        const first = issue.path[0];
        const name = typeof first === "string" ? first : undefined;
        const missingName = issue.evidence.kind === "missing-required" && issue.path.length === 1 ? name : undefined;
        if (!ambiguous) {
          if (missingName !== undefined) missing(missingName);
          else invalid(name, issue_detail(issue));
        } else if (missingName === undefined || !commonMissing.has(missingName)) invalid(undefined, "No Schema alternative accepts these arguments");
      }
      // Native lookup types are part of the Event grammar. Their actual values
      // remain unknown, so refinements and exact values cannot be checked here.
      for (const { name, operand } of event.args) {
        if (states.get(name) !== "present" || operand.kind !== "native" && operand.kind !== "interpolation") continue;
        const kinds: readonly string[] = operand.kind === "interpolation" ? ["string"]
          : operand.lookup.length === 5 && operand.lookup[4] === "entry-or-null" ? [operand.valueKind, "null"] : [operand.valueKind];
        const choices = inspect_schema_data(schema.value, [name]).alternatives;
        if (choices.some(choice => choice.kind === "supported") && choices.every(choice => {
          if (choice.kind !== "supported") return choice.kind === "absent" || choice.kind === "invalid-traversal";
          const node = choice.node;
          const expected = node.kind === "exact" ? node.value === null ? "null" : typeof node.value : node.kind === "tuple" ? "array" : node.kind;
          return expected !== "any" && !kinds.includes(expected);
        })) invalid(name, `Argument ${JSON.stringify(name)} supplies a value of type ${kinds.join(" or ")}`);
      }
    };
    for (const { location: attachment, part } of attachments) {
      const bindings = new Map<string, readonly (PartBindingReference | undefined)[]>();
      for (const argument of event.args) {
        if (argument.operand.kind === "literal" || argument.operand.kind === "native") continue;
        bindings.set(argument.name, event_argument_references(argument).map(site => {
          const where = map({ start: site.start.index, end: site.end.index });
          return part?.bindingSources?.references.find(use => use.context === "event" && same_part_range(use.attachment, attachment)
            && same_part_range(use.location, where));
        }));
      }
      const evidence = (argument: AuthoredEventArgument, connector?: PartConnectorSource): EventArgumentEvidence => {
        if (argument.operand.kind === "literal") return { value: argument.operand.value };
        if (argument.operand.kind === "native") return "present";
        const states = bindings.get(argument.name)?.map(use => event_reference_evidence(part, use, argument, connector)) ?? [];
        if (argument.operand.kind === "reference") return states[0] ?? "opaque";
        if (states.includes("opaque")) return "opaque";
        if (states.includes("absent")) return "absent";
        return states.includes("conditional") ? "conditional" : "present";
      };
      const states = new Map(event.args.map(argument => [argument.name, evidence(argument)]));
      evaluate(states, attachment);
      if (part === undefined || !event.args.some(argument => states.get(argument.name) === "conditional")) continue;
      for (const invocation of certain_part_invocations(facts, part)) {
        if (!owners.has(invocation.batch.call) || invocation.connector === undefined) continue;
        const occurrence = new Map(states);
        for (const argument of event.args) {
          if (states.get(argument.name) !== "conditional") continue;
          const refined = evidence(argument, invocation.connector);
          if (refined !== "opaque" && refined !== "conditional") occurrence.set(argument.name, refined);
        }
        if (event.args.some(({ name }) => occurrence.get(name) !== states.get(name))) evaluate(occurrence, attachment);
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
            const { alternatives } = inspect_schema_data(argument.dataSchema, origin.path);
            invalid ||= alternatives.length > 0 && alternatives.every(alternative => alternative.kind === "supported"
              && alternative.presence === "required" && alternative.node.kind !== "any"
              && (kind === "object" ? alternative.node.kind !== "object" : alternative.node.kind !== "array" && alternative.node.kind !== "tuple"));
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

/** Pure preflight over authored ASTs. Unknown expressions withdraw the entire proof. */
export function static_schema_candidate_diagnostics(typescript: typeof ts, program: ts.Program, parseEvent = static_event_parser()): readonly StaticSchemaDiagnostic[] {
  const checker = program.getTypeChecker();
  const schemas = new Map<ts.Declaration, Schema>();
  const sources = program.getSourceFiles().filter(source => !source.isDeclarationFile && !program.isSourceFileFromExternalLibrary(source)
    && !source.fileName.replaceAll("\\", "/").split("/").includes(".hson"));
  const sourceCandidates = static_source_candidates(typescript, checker, program, parseEvent);
  for (const source of sources) for (const found of discover_hson_schema_declarations(typescript, source, checker, sourceCandidates.eligible)) {
    if (!found.eligible || found.source === undefined) continue;
    const compiled = compile_hson_schema(found.source);
    if (compiled.ok) schemas.set(found.declaration, { declaration: found.declaration, name: found.name, compiled: compiled.value });
  }
  const schema = (input: ts.Expression, work: PartOwnershipWork, depth: number, use: "value" | "type-query" = "value"): Schema | undefined =>
    resolve_immutable_schema(typescript, checker, input, found => schemas.get(found), new Set(), sourceCandidates.eligibility(work), use,
      relative => work.charge(1, depth + relative));
  const output: StaticSchemaDiagnostic[] = [];
  const reported = new Map<string, number>();
  const representationReported = new Set<ts.Expression>();
  const reportJsonSource = (json: ts.Expression, work: PartOwnershipWork): boolean => {
    if (!library_json_has_hson_source(typescript, checker, json, sourceCandidates.eligibility(work)) || work.exhausted) return false;
    if (!representationReported.has(json)) {
      representationReported.add(json);
      output.push({ file: json.getSourceFile().fileName, start: json.getStart(), end: json.getEnd(),
        code: "HSON_LIBRARY_JSON_SOURCE", message: "HSON source supplied to json. Use the hson channel for source, or supply semantic Data under json." });
    }
    return true;
  };
  const report = (contract: Schema | undefined, input: ts.Expression,
    operation: "certify" | "detached-document" | "data" | "json" | StaticDocumentLibraryContext,
    owner: ts.Node, work: PartOwnershipWork, depth: number): void => {
    if (contract === undefined) return;
    const document = contract.compiled.semantic.kind === "document" || contract.compiled.semantic.kind === "document-element";
    const family = typeof operation !== "string" || operation === "detached-document" ? "document"
      : operation === "certify" ? document ? "document" : "json" : operation;
    const context = typeof operation !== "string" ? operation : family === "document" ? "detached-document" : "data";
    const possible = sourceCandidates.candidates(input, family, work, depth);
    if (possible === undefined || possible.length === 0) return;
    const failures = possible.map(candidate => evaluate_static_schema_candidate(contract.compiled, candidate, context));
    // A valid branch, opaque branch or malformed Hson belongs to runtime/authoring diagnostics.
    if (work.exhausted || failures.some(failure => failure.kind !== "invalid")) return;
    const first = failures[0];
    if (first?.kind !== "invalid") return;
    const candidate = possible[0]!;
    const local = possible.length === 1 && candidate.node.getSourceFile() === input.getSourceFile();
    const node = local ? candidate.node : input;
    const range = local && "source" in candidate && candidate.bodyStart !== undefined && candidate.bodyStart >= 0 && first.range !== undefined
      ? { start: candidate.bodyOffsets?.[first.range.start] ?? candidate.bodyStart + first.range.start,
        end: candidate.bodyOffsets?.[first.range.end] ?? candidate.bodyStart + first.range.end }
      : { start: node.getStart(), end: node.getEnd() };
    const location = (entry: ts.Node) => ({ file: entry.getSourceFile().fileName, start: entry.getStart(), end: entry.getEnd() });
    const attribution = { file: node.getSourceFile().fileName, ...range };
    // Repeated detached checks can share the same authored proof and range.
    // Library evaluation belongs to an admission site and a Library within it.
    const documentOperation = family === "document"
      ? [typeof operation === "string" ? operation : [operation.kind, operation.name, location(owner)], attribution]
      : undefined;
    const key = JSON.stringify([location(contract.declaration), possible.map(entry => location(entry.node)), documentOperation,
      first.issue.code, first.issue.schemaNode, first.issue.path, first.issue.attributeName,
      first.issue.expected, first.issue.received, first.issue.evidence]);
    const operationLocation = documentOperation === undefined ? undefined : { ...location(owner), message:
      typeof operation !== "string" ? `Document Schema admission for Library ${JSON.stringify(operation.name)}.`
        : operation === "certify" ? "Detached Document Schema certification." : "Detached Document Schema annotation." };
    const existing = reported.get(key);
    if (existing !== undefined) {
      const diagnostic = output[existing]!;
      if (operationLocation !== undefined && diagnostic.related !== undefined
        && !diagnostic.related.some(entry => entry.file === operationLocation.file
          && entry.start === operationLocation.start && entry.end === operationLocation.end)) {
        output[existing] = { ...diagnostic, related: [...diagnostic.related, operationLocation].sort((a, b) => a.start - b.start) };
      }
      return;
    }
    reported.set(key, output.length);
    const related: StaticSchemaDiagnosticLocation[] = operationLocation === undefined ? [] : [operationLocation];
    if (possible.length === 1 && candidate.bodyStart !== undefined && candidate.bodyStart >= 0 && first.relatedRange !== undefined) {
      related.push({
        file: candidate.node.getSourceFile().fileName, start: candidate.bodyStart + first.relatedRange.start, end: candidate.bodyStart + first.relatedRange.end,
        message: `Conflicting value at ${first.issue.evidence.relatedPath?.join(".")}; derived key ${first.issue.received}.`,
      });
    }
    output.push({ ...attribution, code: first.issue.code, ...(related.length === 0 ? {} : { related }),
      message: `Static Hson does not satisfy ${contract.name}: ${issue_detail(first.issue)}${possible.length > 1 ? " (all static alternatives fail)." : "."}` });
  };
  for (const source of sources) {
    const mapSymbols = read_supported_hson_import_symbols(source, checker, [], "hsonLiveMap", typescript);
    const checkRepresentation = (input: ts.Expression, work: PartOwnershipWork, depth: number): void => {
      const alternatives = sourceCandidates.alternatives(input, "json", { work, depth });
      const definition = alternatives.complete && alternatives.nodes.length === 1 ? alternatives.nodes[0] : undefined;
      const fields = definition !== undefined && typescript.isObjectLiteralExpression(definition)
        ? sourceCandidates.libraryFields(definition, work, alternatives.depth ?? depth) : undefined;
      const json = fields?.get("json");
      if (json !== undefined && !["hson", "document", "parts", "data"].some(key => fields?.has(key))) reportJsonSource(json, work);
    };
    const validateDefinition = (definition: ts.Expression, name: string | ts.Expression | undefined, owner: ts.Node, work: PartOwnershipWork, depth: number,
      batch?: Readonly<{ fields: ReadonlyMap<string, ts.Expression>; depth: number }>): void => {
      if (!typescript.isObjectLiteralExpression(definition)) return;
      const fields = sourceCandidates.libraryFields(definition, work, depth);
      if (fields === undefined) return;
      const document = fields.get("document"), json = fields.get("json"), hson = fields.get("hson");
      if (fields.has("data") || fields.has("parts")) return;
      if (Number(document !== undefined) + Number(json !== undefined) + Number(hson !== undefined) !== 1) return;
      if (json !== undefined && reportJsonSource(json, work)) return;
      const annotation = fields.get("schema");
      const contract = annotation === undefined ? undefined : schema(annotation, work, depth + 2);
      // Resolve collections on demand. Within this proof, the receiver, its
      // authored source and every referenced collection share the same budget.
      const collections = new Map<string, unknown>();
      const parts = batch === undefined ? undefined : { get(name: string): unknown {
        const cached = collections.get(name);
        if (cached !== undefined) return cached;
        const selected = batch.fields.get(name);
        const value = selected === undefined ? undefined : static_part_collection(typescript, sourceCandidates, selected, work, batch.depth + 2);
        if (value !== undefined) collections.set(name, value);
        return value;
      } };
      if (document !== undefined && contract !== undefined && name !== undefined) {
        let libraryName: string | undefined;
        if (typeof name === "string") libraryName = name;
        else {
          const names = sourceCandidates.alternatives(name, "json", { reachableOnly: true, work, depth });
          const literal = names.complete && names.nodes.length === 1 ? names.nodes[0] : undefined;
          if (literal !== undefined && typescript.isStringLiteralLike(literal)) libraryName = literal.text;
        }
        if (libraryName !== undefined) report(contract, document, { kind: "document-library", name: libraryName,
          ...(parts === undefined ? {} : { parts, parseEvent: parseEvent.part }) }, owner, work, depth + 2);
      }
      if (json !== undefined) report(contract, json, "json", owner, work, depth + 2);
      if (hson !== undefined) report(contract, hson, "data", owner, work, depth + 2);
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
      const work = new PartOwnershipWork();
      const contract = annotation.schema === undefined ? undefined : schema(annotation.schema, work, 0, "type-query");
      if (work.exhausted) continue;
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
      report(contract, initializer, exact ? "json" : tag.name.text === "data" ? "data" : "detached-document", annotationNode, work, 0);
    }
    const visit = (node: ts.Node): void => {
      if (typescript.isCallExpression(node)) {
        if (typescript.isPropertyAccessExpression(node.expression) && node.expression.name.text === "certify" && node.arguments.length === 1) {
          const work = new PartOwnershipWork();
          report(schema(node.expression.expression, work, 0), node.arguments[0]!, "certify", node.expression, work, 0);
        }
        const admission = library_source_admission(node, checker, mapSymbols, false, typescript, sourceCandidates.eligible);
        if (admission?.eligible) {
          const literal = typescript.isObjectLiteralExpression(admission.definitions);
          const batch = sourceCandidates.libraryInventory(admission.definitions, literal ? "part-record" : "json");
          if (batch.completeness === "complete") for (const [name, definition] of batch.fields) {
            if (literal && typescript.isObjectLiteralExpression(definition)) validateDefinition(definition, name, node.expression, batch.work.fork(), batch.depth + 2, batch);
            else checkRepresentation(definition, batch.work.fork(), batch.depth + 2);
          }
        }
        if (admission?.eligible && (admission.operation === "create" || admission.operation === "resume")) {
          const work = new PartOwnershipWork();
          const configuration = node.arguments[1];
          const local = configuration !== undefined && typescript.isObjectLiteralExpression(configuration)
            ? sourceCandidates.libraryFields(configuration, work, 0)?.get("local") : undefined;
          if (local !== undefined && typescript.isArrayLiteralExpression(local)) for (const entry of local.elements) {
            if (!work.charge(1, 3)) break;
            const branch = work.fork();
            const fields = typescript.isObjectLiteralExpression(entry) ? sourceCandidates.libraryFields(entry, branch, 3) : undefined;
            const initializer = fields?.get("initializer");
            if (initializer !== undefined) validateDefinition(initializer, fields?.get("name"), entry, branch, 5);
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
