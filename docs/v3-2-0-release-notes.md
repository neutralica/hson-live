## 3.2.0 — 2026-07-30

HSON 3.2 substantially tightens canonical graph behavior, replaces the former
QUID metadata convention, introduces branded HSON output, strengthens LiveHost
as an independent authority runtime, and makes the complete test surface more
truthful and deterministic.

### Compatibility changes

- Replaced canonical graph metadata keys:

  - `$_meta["data-_quid"]` → `$_meta.quid`
  - `$_meta["data-_index"]` → `$_meta.index`

- Replaced system metadata markup:

  - `data-_quid` → `hson:quid`
  - `data-_index` → `hson:index`

- Returned the complete `data-*` attribute namespace to application code,
  including `data-_quid` and `data-_index`.

- Made system metadata exact and registry-driven. Unknown `hson:*` markup and
  unknown canonical metadata keys now reject.

- Preserved canonical HSON QUID syntax as `@<quid>`.

### HSON strings and normalization

- Added the Transform-owned `HsonString` branded primitive type.

- HSON-specific serialization paths now return `HsonString`, including:

  - direct HSON serialization;
  - default readable output;
  - compact output through `noBreak()`;
  - `noQuid()` output;
  - universal and Worker-safe Transform paths.

- Kept HTML, JSON, dynamic-format, transport, persistence, diagnostic, CSS, and
  DOM serialization typed as ordinary `string`.

- Added `hson.string(source)` and the narrow named producer
  `hsonString(source)`.

- Both string producers parse, normalize, validate, and officially reserialize
  HSON source before returning `HsonString`.

- `hson.string` and `hsonString` share the same implementation and function
  identity.

- Added root and `hson-live/transform` exports for `hsonString`.

- Retained a single trusted brand assertion at the successful official HSON
  serializer boundary.

- Added compile-time tests for format-specific return types, brand provenance,
  public entrypoints, and rejection of arbitrary strings as `HsonString`.

### Canonical graph closure

- Normalized canonical graph ingress without mutating caller-owned input.

- Rejected cycles and non-finite numbers.

- Preserved negative zero through parsing, serialization, normalization, and
  equality.

- Normalized optional records and ordinary attribute values.

- Preserved distinct element-mode and object-mode content through parsing,
  serialization, and canonical equality.

- Accepted programmatic empty standard-tag content as shorthand for canonical
  empty element-mode content.

- Preserved the empty `_hson_root` as a runtime fragment carrier while
  continuing to reject it from direct HSON-text serialization.

- Allowed shared acyclic references to serialize repeatedly by value while
  rejecting cyclic graphs deterministically.

- Centralized canonical name, metadata, number, content-mode, and graph
  invariant enforcement.

### QUID identity

- Reworked QUID storage around canonical `$_meta.quid`.

- Projected QUID identity into HTML, SVG, and DOM as `hson:quid`.

- Added reversible XML-safe transit handling for colonized HSON metadata during
  XML-based HTML parsing.

- Centralized QUID admission, validation, assignment, collection, removal, and
  duplicate detection.

- Centralized production QUID selector generation using escaped literal-colon
  selectors:

  ```css
  [hson\:quid="..."]
  ```

- Updated DOM projection, CSS ownership, grafting, cloning, disposal, cleanup,
  LiveMap identity, replay, recovery, and persistence paths.

- Preserved stable identity across detach and reattachment.

- Kept destruction distinct from detachment.

- Ensured cloning receives fresh QUID identities where required.

- Preserved `noQuid()` as a non-mutating output view.

- Removed dependence on pseudo-identities and private DOM runtime markers.

### Metadata and attributes

- Added one exact metadata registry for the production keys `quid` and `index`.

- Centralized metadata projection, node eligibility, validation, and
  per-format behavior.

- Kept array index metadata string-valued. Wrapper-bearing admission orders a
  valid complete permutation by index; canonical physical wrapper order and
  positional indexes then agree for every Transform serializer.

- Added private, reversible XML-transit encoding for `hson:*` attribute names.

- Prevented private transit names from escaping into canonical graphs, DOM
  output, snapshots, or serialized output.

- Preserved ordinary `data-*` attributes through parsing, graph storage, DOM
  projection, and serialization.

- Updated browser, Worker, direct Element, HTML, SVG, JSON, HSON, and raw-node
  metadata boundaries.

### LiveHost

- Strengthened LiveHost as an independent Node-compatible authority and
  transport runtime.

- Added and refined official socket adapters, bootstrap behavior, production
  trust configuration, and authority lifecycle management.

- Kept the Node application host transport-focused rather than making it the
  canonical graph authority.

- Expanded authoritative commit ordering, recovery, snapshot, replay,
  persistence, and document-lifecycle coverage.

- Improved the ability to deploy LiveHost as a self-contained remote authority
  for browser and non-browser clients.

### LiveMap and LiveTree

- Updated LiveMap graph identity, document installation, mutation, capture,
  replay, view-state, and persistence behavior for canonical metadata.

- Updated LiveTree projection, DOM identity, CSS selectors, stylesheet
  ownership, events, grafting, cloning, cleanup, and runtime scope behavior.

- Preserved the separation between canonical LiveMap state and LiveTree
  DOM/CSS/event projection.

- Improved lifecycle handling across creation, attachment, detachment,
  reattachment, cloning, and destruction.

### Parsing and serialization

- Updated HTML, SVG, JSON, HSON, raw-node, browser DOM, and Worker parsing for
  the new canonical metadata model.

- Preserved parser/serializer closure across supported canonical graph states.

- Kept HSON array indexes implicit where physical array order carries their
  meaning.

- Improved rejection of invalid numbers, cycles, malformed names, malformed
  QUIDs, unsupported metadata, and metadata placed on ineligible nodes.

- Preserved readable and compact serialization behavior without changing
  output bytes solely for the introduction of `HsonString`.

### Testing and diagnostics

- Added a truthful terminal-completion protocol for all external test
  launchers.

- Validated launcher identity, expected counts, process completion, stream
  bounds, timeouts, and termination escalation.

- Hardened the canonical runner with finite per-case timeouts, deterministic
  setup and cleanup, abort handling, bounded details, and exactly one terminal
  event per case.

- Reconciled the canonical, external, Worker, browser, hosted, and inclusive
  test inventories.

- Added focused browser proof for literal `hson:*` attributes and escaped QUID
  selectors across HTML and SVG.

- Separated synthetic-DOM CSS ownership assertions from real-browser computed
  style assertions.

- Fixed a browser fixture circular initialization failure and introduced an
  explicit, observable fixture installation lifecycle.

- Fixed splash cancellation and disposal races by canceling and awaiting
  per-run timers, microtasks, animation frames, listeners, and completion work.

- Expanded serializer, metadata, QUID ingress and egress, public-boundary,
  Worker, browser, persistence, replay, recovery, and declaration coverage.

### Documentation

- Updated the canonical HsonNode representation, HSON syntax, markup
  projection, Transform API, QUID identity, LiveTree, LiveMap, LiveHost,
  persistence, and lifecycle documentation.

- Documented `HsonString` as a TypeScript-only branded primitive produced by
  official HSON serialization.

- Documented that `hson.string()` and `hsonString()` normalize source spelling
  and are not security, authentication, or cross-process trust mechanisms.

- Removed the former implication that the `data-_` prefix belongs to HSON
  system metadata.
