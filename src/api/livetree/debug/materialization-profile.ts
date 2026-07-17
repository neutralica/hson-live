export type LiveTreeMaterializationProfile = Readonly<{
  liveTreeInstances: number;
  subtreeTraversalPasses: number;
  subtreeNodesTraversed: number;
  ownershipIndexPasses: number;
  ownershipNodesIndexed: number;
  appendBranchCalls: number;
  batchAttachmentPasses: number;
  branchesBatchAttached: number;
  appendValidationTargetNodes: number;
  appendValidationBranchNodes: number;
  hsonHostInsertions: number;
  domProjectionCalls: number;
  domElementsCreated: number;
  domTextNodesCreated: number;
  domFragmentsCreated: number;
  domAppendOperations: number;
  quidEnsureCalls: number;
  quidRegistryWrites: number;
  quidLookups: number;
  sourceSnapReads: number;
  sourceAtCalls: number;
  objectKeyEnumerations: number;
  rendererHookInvocations: number;
  specializationMatchCalls: number;
  inspectorRootListeners: number;
  inspectorCssRuleSets: number;
  projectionSourceReadMs: number;
  projectionRendererCreateMs: number;
  projectionSurvivorUpdateMs: number;
  projectionAttachmentMs: number;
  inspectorBranchConstructionMs: number;
}>;

export type LiveTreeMaterializationProfileKey = keyof LiveTreeMaterializationProfile;

type MutableProfile = { -readonly [K in LiveTreeMaterializationProfileKey]: number };

let active: MutableProfile | undefined;

export function begin_livetree_materialization_profile(): Readonly<{
  stop: () => LiveTreeMaterializationProfile;
}> {
  if (active !== undefined) throw new Error("A LiveTree materialization profile is already active.");
  const counters = empty_profile();
  active = counters;
  let stopped = false;
  return Object.freeze({
    stop(): LiveTreeMaterializationProfile {
      if (stopped) return Object.freeze({ ...counters });
      stopped = true;
      if (active === counters) active = undefined;
      return Object.freeze({ ...counters });
    },
  });
}

export function record_livetree_materialization(
  key: LiveTreeMaterializationProfileKey,
  amount = 1,
): void {
  if (active === undefined) return;
  active[key] += amount;
}

function empty_profile(): MutableProfile {
  return {
    liveTreeInstances: 0,
    subtreeTraversalPasses: 0,
    subtreeNodesTraversed: 0,
    ownershipIndexPasses: 0,
    ownershipNodesIndexed: 0,
    appendBranchCalls: 0,
    batchAttachmentPasses: 0,
    branchesBatchAttached: 0,
    appendValidationTargetNodes: 0,
    appendValidationBranchNodes: 0,
    hsonHostInsertions: 0,
    domProjectionCalls: 0,
    domElementsCreated: 0,
    domTextNodesCreated: 0,
    domFragmentsCreated: 0,
    domAppendOperations: 0,
    quidEnsureCalls: 0,
    quidRegistryWrites: 0,
    quidLookups: 0,
    sourceSnapReads: 0,
    sourceAtCalls: 0,
    objectKeyEnumerations: 0,
    rendererHookInvocations: 0,
    specializationMatchCalls: 0,
    inspectorRootListeners: 0,
    inspectorCssRuleSets: 0,
    projectionSourceReadMs: 0,
    projectionRendererCreateMs: 0,
    projectionSurvivorUpdateMs: 0,
    projectionAttachmentMs: 0,
    inspectorBranchConstructionMs: 0,
  };
}
