# Trusted Schema diagnostics

This package connects authored Hson source ranges to an explicitly selected `HsonSchema`. Current discovery follows `Hson.schema` definitions and calls to `schema.certify(candidate)`. It uses finite local binding analysis and records source provenance so the editor can place diagnostics on authored content.

A LiveMap Schema is supplied when a named library is constructed with `hsonLiveMap.fromLibraries({ name: { data, schema } })` or `{ document, schema }`. The registry validates at admission and on mutation. For supported direct local flow, the shared compiler/editor view also recognizes `map.lib("name").schema.use(Schema)` and refines subsequent access after successful continuation.

The runtime verifies the trusted Schema binding before using its issue evidence. Source ranges, interpolation captures, and the parser's document or data mode determine the diagnostic placement. Without a proven association, the editor reports Hson syntax errors but does not invent Schema validation results.

The lifecycle and protocol modules still carry bounded capture and verification facilities for trusted source observations. They do not grant LiveMap authority or expose an application API.
