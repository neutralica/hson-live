## 2.3.0
### TreeSelector, CSS/selector/get, find/findAll
• fix selector-backed CSS readback for nested pseudo-element rules
• key selector rules by resolved selector text so set/get paths agree
• require ampersand-prefixed selector blocks inside css.setMany()
• preserve permissive appended-pattern behavior for css.selector(...)
• add selector-backed get.all() and get.stringAll() read surfaces
• add QUID-backed css.get.all() support using CssManager declaration state
• separate structured get.all() output from string serialization
• handle CSS `all` property collision via get.property("all")
• normalize vendor-prefixed CSS readback and string serialization
• preserve custom properties in get.all() and stringAll()
• fix stale rendered CSS by deleting rules/rendered maps without short-circuiting
• ensure selector clear resets both local rule state and manager-rendered state
• add regression coverage for selector clear, custom props, CSS all, and defensive snapshots

• delete dead find-builder path and consolidate finder changes in methods/find.ts
• add find/findAll helpers for byClass and byData
• add findAll byId/byIds collection helpers
• clarify findAll as TreeSelector-returning rather than array-returning
• update find/findAll tests around TreeSelector semantics

• expand TreeSelector surface with length, first, last, at, array, map, each, filter, and removal behavior
• fix TreeSelector.last() indexing
• add broad TreeSelector surface coverage for indexing, snapshots, filtering, broadcasts, and removals