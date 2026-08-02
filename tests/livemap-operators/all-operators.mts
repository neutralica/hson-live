import { mutation_operators } from "./mutation-operators.mts";
import { admission_schema_operators } from "./admission-schema-operators.mts";
import { transport_propagation_operators } from "./transport-propagation-operators.mts";

export { mutation_operators, admission_schema_operators, transport_propagation_operators };

export const deterministic_livemap_operators = Object.freeze([
  ...mutation_operators,
  ...admission_schema_operators,
  ...transport_propagation_operators,
]);
