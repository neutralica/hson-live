LiveTree Contracts (v1) (19MAR2026)

- find.* → never throws, returns empty/undefined
- must.* → throws on failure
- dataset keys → must be non-empty, normalized via formatData
- null/undefined → removal semantics
- node removal → idempotent
- stale handles → [your chosen behavior]