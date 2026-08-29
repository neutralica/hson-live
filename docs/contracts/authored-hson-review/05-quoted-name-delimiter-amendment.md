# Authored-Hson quoted-name delimiter amendment

## Binding and scope

This amendment supplements, and does not rewrite, the completed human worksheet
[`01-authored-source-verdicts.md`](./01-authored-source-verdicts.md). The worksheet
remains historical input with SHA-256
`df17f7de1e9452754b9ab1ddc4d80fdfc82c473f1323ce91a72f9a46ec79db7c`.
Its backtick-delimited examples, case IDs, family IDs, reviewer notes, and evidence
hashes record the syntax that was presented to the reviewer at that time.

The reviewer approved the quoted-name escape semantics, including ordinary
escapes, Unicode escapes, malformed-escape rejection, and raw-control rejection.
The authored-name delimiter subsequently changed from backtick to apostrophe.
This amendment changes only the delimiter spelling and the delimiter-specific
escape; it does not reopen the reviewed decoded-name semantics.

## Current rule

- Authored Hson names are bare or single-quoted.
- `"..."` delimits authored string values.
- `'...'` delimits authored quoted names.
- `` ` `` has no Hson delimiter role.
- `\'` replaces the former escaped-delimiter case.
- Backslashes and the established `\b`, `\f`, `\n`, `\r`, `\t`, and `\uXXXX`
  escapes retain their reviewed meanings inside quoted names.
- Backticks remain ordinary data inside single-quoted names and double-quoted
  string values.
- Legacy backtick-delimited names are invalid, without compatibility parsing.

## Historical-to-active ID migration

The current ledger records every historical and active ID pair explicitly. The
mapping is also defined exactly by these rules:

1. Replace the case-ID segment `backtick-name` with `quoted-name`.
2. Replace the accepted variation suffix `escaped-backtick` with
   `escaped-apostrophe`.
3. Replace the rejected variation suffix `unicode-interrupted-backtick` with
   `unicode-interrupted-apostrophe`.
4. Apply the same `backtick-name` → `quoted-name` replacement to corpus-family
   IDs and human-review group IDs.
5. All other historical IDs remain identical.

The following active cases have no historical worksheet row and receive their
verdict directly from this amendment:

| Active case ID | Verdict | Amendment claim |
|---|---|---|
| `hson.accept.family.quoted-name.literal-backtick` | valid | A backtick is ordinary unescaped data inside a single-quoted name. |
| `hson.reject.literal.legacy-backtick-name` | invalid | A backtick cannot begin a name or invoke legacy syntax. |
| `hson.reject.literal.quoted-name.raw-apostrophe` | invalid | An apostrophe inside a quoted name must be written `\'`. |
| `hson.reject.literal.single-quoted-value` | invalid | Single quotes do not delimit Hson string values. |

## Derived-artifact policy

The current ledger and reconciliation report are regenerated from the unchanged
historical worksheet, this amendment, and the active corpus. They must include
both input hashes and the full historical-to-active ID mapping. Regeneration must
not overwrite the worksheet or its historical evidence files.
