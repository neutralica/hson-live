/** Explicit editor context; never inferred from QUAD-like source text. */
export type StandaloneAuthoringMode = 'canonical' | 'document' | 'data';
export function standaloneAuthoringMode(value: unknown): StandaloneAuthoringMode {
  return value === 'document' || value === 'data' ? value : 'canonical';
}
