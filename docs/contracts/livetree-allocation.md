# LiveTree allocation contract

LiveTree 3.0 Patch 4 changes construction strategy without changing public or
lifecycle behavior.

- Bare construction assigns only the node reference and host root.
- Optional manager caches do not materialize as own properties until used.
- `append()` and `empty()` are prototype methods.
- `find` and `findAll` are independent lazy, stable getters. Touching one does
  not allocate the other.
- QUID-backed CSS creates its write surface immediately, while getter, variable,
  and animation sub-surfaces replace lazy accessors with stable cached values on
  first use. Selector and at-rule handles remain call-lazy.
- `listen` intentionally remains an eager-per-access builder. Caching the current
  closure-heavy implementation increased retained memory for access-only trees;
  a cached listener requires a separately measured prototype-backed builder.

Run the allocation harness after `npm run build`:

```sh
node --expose-gc benchmarks/livetree-allocation.mjs 1000 bare
node --expose-gc benchmarks/livetree-allocation.mjs 1000 css
```

Use fresh processes and compare medians from at least five runs. The census
walks enumerable own data and accessor functions without invoking lazy getters.

Patch 4 measurements used the bundled Node runtime with `--expose-gc`, five
fresh processes per cell, and report the median:

| Scenario | Patch 3 heap | Patch 4 heap | Functions before → after | Objects before → after |
| --- | ---: | ---: | ---: | ---: |
| 100 bare trees | 963,312 B | 555,736 B | 5,202 → 0 | 600 → 600 |
| 1,000 bare trees | 4,811,720 B | 967,352 B | 52,002 → 0 | 6,000 → 6,000 |
| 1,000 trees after `.css` | 10,529,336 B | 4,823,448 B | 93,002 → 13,017 | 13,000 → 8,002 |
| 1,000 discarded `.listen` accesses | 4,888,688 B | 1,034,280 B | 52,002 → 0 | 6,000 → 6,000 |

Median construction time for 1,000 bare trees changed from 15.19 ms to
11.17 ms. The 100-tree timing sample was dominated by process/JIT noise and is
not used as a performance claim; retained heap at that size remains reported.

After lazy access, 1,000 `find` surfaces retain 32,000 functions and about
3.23 MB, while 1,000 `findAll` surfaces retain 18,000 functions and about
2.32 MB. Before Patch 4 both surfaces were always present, including on trees
that never queried.
