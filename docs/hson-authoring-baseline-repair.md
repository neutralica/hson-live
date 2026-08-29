# Hson authoring baseline regression repair

Verified 2026-08-28. This is the focused baseline repair, not a later authoring or distribution phase.

## 1. Ordinary VS Code reproduction

Reproduced on ordinary macOS VS Code **1.134.0**, using the original VSIX in an isolated installed-extension directory. The extension activated, but official `Hson` had no Hson grammar tokens and malformed Hson produced zero diagnostics. Invalid → valid → invalid remained 0 → 0 → 0.

The installed everyday extension and original VSIX contained byte-identical `dist/extension.js` (SHA-256 `1e5dfe528a4881e05396cca52b116a9028c5a38760c7ca204b17f1c86e74d46f`). This ties the isolated reproduction to the actual installed artifact without changing the everyday profile.

## 2. Development-host reproduction

The pre-repair current source build **did not reproduce the direct-Hson failure**. It activated, emitted Hson grammar tokens, diagnosed invalid source, cleared on an unsaved correction, and republished on another invalid edit. Both trusted and genuinely untrusted workspaces passed. There was no Schema association/provider.

## 3. Highlighting root cause

The installed 0.1.0 VSIX still contributed a grammar matching `hsonString`, not `Hson`. Current source had already migrated the injection to `Hson`, but that spelling-only architecture could not recognize renamed official bindings or exclude unrelated/shadowed `Hson` bindings.

The repair retains `syntaxes/hson.tmLanguage.json` unchanged as the coloring authority. Its tokens are now published through a binding-selected semantic-token adapter with Hson scope fallbacks. The obsolete spelling-only injection is removed; no second Hson lexer/parser was introduced for coloring. This transport change is necessary because a TextMate regex cannot establish TypeScript symbol identity. VS Code continues to control semantic-token rendering through its normal theme/user preferences.

## 4. Validity-diagnostic root cause

The installed bundle's discovery still required imported name `hsonString`; official `Hson` produced no discovered source and therefore no diagnostic. Current source diagnostics were already independent of Schema/trust, but used `hson.fromHson(...).toNode()` rather than the exact authoring admission boundary.

Secure tag diagnostics now invoke the existing private `admit_hson` operation (the function underlying `Hson`). D5's raw-template newline/UTF-16 correspondence maps primary/related evidence back to the host. TypeScript determines whether cooked template segments exist; invalid cooked escapes are rejected by the real tag boundary. Readable noncanonical input is admitted and canonicalized, not rejected for differing serialization.

The stale package also lacked the Workspace Trust declaration: it was unavailable to the Restricted Mode extension host. Building the current package exposed another concrete packaging blocker: a repository-relative README link without repository metadata caused `vsce package` to fail. That link/metadata is repaired.

## 5. Shared cause

**Yes:** both observed ordinary-use symptoms shared the stale pre-migration installed artifact. Their immediate mechanisms were different: a stale grammar tag spelling versus stale import-name discovery. The additional source-level binding/highlighting and exact-admission gaps were independently repaired.

## 6. Files changed

All implementation changes are under `editors/vscode-hson/`; production library source is unchanged.

- `src/highlighting.ts` (new): existing-grammar loading, binding-selected literal tokens, expression exclusion.
- `src/tag-admission.ts` (new): real tag admission and conservative prefix diagnostics, using existing raw/host mapping.
- `src/extension.ts`: unconditional grammar-backed semantic-token registration.
- `src/document-diagnostics.ts`: secure tag admission routing; D4 ordinary-string path unchanged.
- `syntaxes/hson-template-injection.tmLanguage.json` (removed): obsolete spelling-only injection; recoverable from Git.
- `package.json`, `package-lock.json`, `scripts/build.mjs`: extension 0.1.1, semantic scope declarations, WASM packaging, repository metadata, focused scripts.
- `scripts/build-tests.mjs`, `tsconfig.json`: new test entrypoints.
- `tests/baseline.test.ts`, `tests/integration/baseline.ts`, `tests/integration/run-baseline.mjs` (new): zero-Schema and installed/dev real-host journeys.
- `tests/grammar.test.mjs`, `tests/validate-artifact.mjs`: test the active grammar/manifest path, not a synthetic inactive injection.
- `README.md`: corrected contracts, package link, verification instructions.
- This report.

Generated ignored artifact: `editors/vscode-hson/hson-language.vsix`.

## 7. Binding recognition

Census: package root resolves to `dist/index.js`; `/hson` resolves to `dist/hson-authoring.js`. `src/index.ts` re-exports `Hson` from `src/hson-authoring.ts`; no other public index exports Hson. The lowercase aggregate facade is not a tag.

The existing TypeScript checker/import-symbol discovery is unchanged. Direct named imports from **`hson-live` and `hson-live/hson`**, including renames, retain authority. Local names, shadows, wrong packages, wrappers, copied/extracted functions and unsupported import forms do not acquire it from spelling.

## 8. Highlighting contract

Recognized valid, invalid and interpolated templates receive existing-grammar-backed Hson tokens. Direct/root/renamed imports are equivalent. Expressions retain host-language ownership. Registration does not await a provider, D1, Schema, association, runtime interpolation evidence or completion.

## 9. Secure admission contract

No-substitution templates are admitted by the actual Hson tag operation, including raw-template behavior, physical newline normalization, detached/canonical output, escape handling and Unicode-safe host ranges. Invalid → valid clears and valid → invalid publishes on unsaved edits. Version guards reject stale results. Standalone `.hson` and D4 `fromHson` behavior remain separate.

## 10. Restricted Mode

The final installed **0.1.1** VSIX activated in an actual untrusted workspace, emitted Hson tokens, and produced diagnostic counts **1 → 0 → 1** across invalid/corrected/invalid edits. No trusted provider executed. Workspace Trust declarations and trusted execution gates remain intact.

## 11. Interpolation / D5

Literal highlighting is independent of substitution knowledge. Secure mode executes no expressions and supplies no invented values. Only irrevocable tokenizer failures in the literal prefix are reported statically; incomplete prefixes and unknown completed candidates remain unclaimed. The existing trusted D5 completed-candidate/value capture and mapping paths are unchanged and passed their focused and real-host regressions.

## 12. Schema layering

Discovery → grammar-backed highlighting → secure tag admission run without Schema. Trusted Schema diagnostics and D6 completion remain optional layers behind their existing trust, enablement, association, ambiguity and staleness checks. No `fromHson` completion or highlighting expansion was added.

## 13. New focused suite

**`npm run test:baseline`**, from `editors/vscode-hson`: **24/24 checks passed**. Grammar testing now also runs this suite. The checks cover official surfaces/renames, exclusions, valid/invalid tokens, readable admission, edit transitions, zero-Schema/provider independence, trust declaration, interpolation exclusion/nonexecution, conservative prefix diagnostics, raw/invalid-cooked escapes, CRLF/related evidence, Unicode, TSX and stale publication.

## 14. Real VS Code integration

- Ordinary VS Code **1.134.0**, development host: baseline passed in trusted and Restricted Mode workspaces.
- Actual semantic-token API decoded direct/root/renamed tokens for valid, invalid and interpolated Hson; excluded expression ranges and unsupported bindings; reflected unsaved edits.
- Pinned VS Code **1.95.3**, existing full D2–D6 journey: passed, including D4–D6 Restricted Mode checks.
- Additional ordinary-1.134.0 full D2–D6 run passed through D5 but stalled in the completion command. The isolated process was stopped. This additional run is **not claimed as a D6 pass**; pinned D6 and ordinary baseline results are separate evidence.

## 15. Final installed-VSIX smoke

Built with the existing `npm run package:vsix` path. Installed into a clean extensions directory using the VS Code CLI. Only an empty test driver was a development extension; Hson loaded from the installed package, not the repository source.

| Final 0.1.1 result | Trusted | Restricted |
| --- | --- | --- |
| Activated | yes | yes |
| Grammar-backed Hson semantic tokens | yes | yes |
| Invalid diagnostic | 1 | 1 |
| Unsaved correction | 0 | 0 |
| Invalid edit republishes | 1 | 1 |
| Provider executed | no | no |

Final artifact SHA-256: `88a25f4e3a34454b09ee1b6659c6014637fa0e7f259b6ab7d7f665ad43d08a02`.

Evidence: `/tmp/hson-baseline-installed-final.log`; isolated installed extension: `/private/tmp/hson-baseline-GGdxuQ/extensions/terminal-gothic.hson-language-0.1.1`. Ordinary daily-profile installation was deliberately not changed; install the rebuilt VSIX there to replace stale 0.1.0.

## 16. Narrow `/hson` bundle

Before and after: **186,554 raw / 99,683 minified / 27,550 gzip bytes; 51 retained modules**. All ten package-boundary checks passed. No editor, grammar, completion, capture/provider or source-mapping machinery entered the production authoring graph.

## 17. D4–D6 focused regressions

- D4 editor **26/26**, performance **8/8**; static discovery and JS-literal mapping **25/25 each**.
- D5 mapping **25/25**, runtime capture **28/28**, editor **29/29**, performance **19/19**.
- D6 context **25/25**, data completion **26/26**, document completion **26/26**, editor completion **29/29**, performance **6/6**.
- Pinned real-host D4–D6 and Restricted Mode: passed. D6 measured completion-command p50 **4.72 ms**, maximum **17.84 ms** (six samples).

## 18. Other verification

Passed `npm run check:source`, `check:tests`, `build`, `check:entrypoints`; extension `check`, grammar/baseline and **32/32** unit/lifecycle checks; `git diff --check`.

**35 focused library commands passed**, including:

```text
hson-tagged-template-discovery, hson-authoring-discovery, hson-tagged-template,
hson-tokenizer, hson-source-provenance-{core,parser,boundary},
embedded-hson-diagnostic-mapping, static-hson-js-literal-mapping,
from-hson-static-discovery, schema-d2-{discovery,runtime,editor,presentation},
schema-d3-{discovery,runtime,editor}, schema-d4-{editor,performance},
hson-d5-mapping, trusted-d5-capture, schema-d5-{editor,performance},
hson-completion-context, schema-{projected,document,editor}-completion,
schema-completion-performance, livemap-{projected,document}-schema-source-lowering,
diagnostics-inventory, hson-authoring-package, public-boundaries,
root-compatibility, hson-root-boundary
```

Run each as `npm run test:<name>`. Per-command evidence is retained in `/tmp/hson-baseline-<name>.log`. No unrelated hosted certification was run.

## 19. Public API

**No public API changes.** No library source, public export, method, prototype identity, root entrypoint or production dependency was changed. New adapter exports are private extension implementation modules, not library package surfaces.

## 20. Git/worktree

Started clean at `f145c77` (D6), following `b67bed6` (D5) and `766856c` (D4), consistent with the user's correction. Those commits are preserved. This repair is unstaged and uncommitted. No reset, stage, checkout or commit occurred. The obsolete injection removal is recoverable from Git; the ignored VSIX was rebuilt.

## 21. Remaining baseline defects / limits

No baseline defect is known in the tested final package. The everyday profile still contains the stale package until the rebuilt VSIX is installed there. Rendering follows normal VS Code semantic-highlighting preferences; tests inspect real tokens rather than claiming final pixel colors. Full ordinary-1.134.0 D6 completion remains unverified because of the additional stalled run noted above. Secure mode deliberately does not claim complete validity for unknown interpolated candidates.

## 22. Suggested commit

`fix(vscode): restore binding-aware Hson authoring baseline`

No message-bank, settings, presentation, control-plane or exhaustive distribution phase was started.
