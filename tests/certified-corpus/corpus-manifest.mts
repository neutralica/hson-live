import { literalAcceptedAuthoredHsonCases } from "./authored-accepted.mts";
import { authoredAcceptedFamilies, authoredRejectedFamilies } from "./authored-families.mts";
import { literalRejectedAuthoredHsonCases } from "./authored-rejected.mts";
import { authoredCompletenessBasisCases } from "./authored-completeness-basis.mts";
import { diagnosticCircuitCases, specializedReferenceCases } from "./diagnostic-and-references.mts";
import { graphAcceptedTransportCases, graphRejectedTransportCases } from "./graph-transports.mts";
import {
  structuralHtmlAcceptedCases,
  structuralHtmlRejectedCases,
} from "./html-transports.mts";
import {
  structuralJsonAcceptedCases,
  structuralJsonRejectedCases,
} from "./json-transports.mts";
import type {
  CorpusCounts,
  CorpusFamilyDefinition,
  MaterializedCorpusCase,
} from "./corpus-types.mts";

export const corpusFamilyDefinitions: readonly CorpusFamilyDefinition[] = Object.freeze([
  ...authoredAcceptedFamilies,
  ...authoredRejectedFamilies,
]);

const concrete = [
  ...literalAcceptedAuthoredHsonCases,
  ...authoredCompletenessBasisCases.filter((entry) => entry.disposition === "accept"),
  ...authoredAcceptedFamilies.flatMap((family) => family.cases),
  ...literalRejectedAuthoredHsonCases,
  ...authoredCompletenessBasisCases.filter((entry) => entry.disposition === "reject"),
  ...authoredRejectedFamilies.flatMap((family) => family.cases),
  ...graphAcceptedTransportCases,
  ...graphRejectedTransportCases,
  ...structuralJsonAcceptedCases,
  ...structuralJsonRejectedCases,
  ...structuralHtmlAcceptedCases,
  ...structuralHtmlRejectedCases,
  ...diagnosticCircuitCases,
  ...specializedReferenceCases,
].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export const materializedCorpusCases: readonly MaterializedCorpusCase[] = Object.freeze(concrete);

const authoredCases = materializedCorpusCases.filter((entry) => entry.ingress === "hson");
const authoredSources = authoredCases.flatMap((entry) =>
  entry.disposition === "reference" || entry.source === undefined ? [] : [entry.source]);

export const corpusCounts: CorpusCounts = Object.freeze({
  literalAcceptedAuthoredHson: literalAcceptedAuthoredHsonCases.length
    + authoredCompletenessBasisCases.filter((entry) => entry.disposition === "accept").length,
  transparentAcceptedAuthoredHson: authoredAcceptedFamilies.reduce((sum, family) => sum + family.cases.length, 0),
  literalRejectedAuthoredHson: literalRejectedAuthoredHsonCases.length
    + authoredCompletenessBasisCases.filter((entry) => entry.disposition === "reject").length,
  transparentRejectedAuthoredHson: authoredRejectedFamilies.reduce((sum, family) => sum + family.cases.length, 0),
  graphOnlyAcceptedTransport: graphAcceptedTransportCases.length,
  graphOnlyRejectedTransport: graphRejectedTransportCases.length,
  structuralJsonTransport: structuralJsonAcceptedCases.length + structuralJsonRejectedCases.length,
  structuralHtmlTransport: structuralHtmlAcceptedCases.length + structuralHtmlRejectedCases.length,
  diagnosticCircuitRegressions: diagnosticCircuitCases.length,
  specializedTestReferences: specializedReferenceCases.length,
  totalConcreteDescriptors: materializedCorpusCases.length,
  uniqueAuthoredSources: new Set(authoredSources).size,
  declaredSourceReuse: materializedCorpusCases.filter((entry) => entry.declaredSourceReuse !== undefined).length,
});
