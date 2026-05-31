// hson-todo

# 2DÜ


## 11MAY2026
#### LiveTree SVG ergonomics
~~• SVG helpers wrap attrs.set calls (initially: viewBox, preserveAspectRatio, d, fill, stroke)~~

~~•optional path builder - accept chained args and convert to string for d attribute~~ X NO

## 03MAY2026
~~- 3-way test "auto" mode interprets malformed HSON as weird HTML~~
~~- change VSN prefix from `_VSN` to `_-VSN` to permit underscored JSON keys ~~
  • this should be done for _attrs, _tag, _content, and _meta as well
- declutter CssManager, GlobalCss,~~ LiveTree~~ as much as possible. 
  ~~- create e.g. ~`LiveTreeInter` interface that LiveTree implements; move all docs to interface~~
  

## 21APR2026
~~SVG — still missing:~~
~~1. ViewBox / coordinate helpers~~
~~• get/set viewBox~~
• pan/zoom helpers
•  coordinate conversion helpers

~2. Path helpers~
• append path segments
~~• maybe a path-string utility layer~~ X NO
• helpers for common commands // ??? what tho


3. Transform helpers
• translate / rotate / scale composition
• maybe transform-origin-ish helpers
• matrix parsing?


~~4. Namespace / tag guarantees~~ // tested exhaustively
~~• SVG tag creation correctness~~
~~• mixed HTML/SVG boundary correctness~~
~~• serialization correctness~~


~5. Geometry reads~
~~• bbox~~
• path length //??
• point-at-length
• hit testing helpers



## 19APR2026
~~• hson.liveTree.from*("") returns a LiveTree directly. Is that good? Do we want 'asBranch()' to finalize call??~~

## 02APR2026
~~• inheritance/nested element rule creation? to avoid dozens of small CSS objects and consolidate into a single nested one?~~

## 01APR2026
~~• gcss.ALL.rule.set / gcss.rule.ALL.set~~ // (already implemented in gcss.rule.set)

## 19MAR2026
~~dom.el.must~~
~~- (remove livetree.asDomElement() in favor of the above)~~

## 18MAR2026
~~• find/findall.byClass~~
~~• find/findall.byData?~~
~~• find/findall.byTag~~
~~• scrollHeight/width~~
~~• scrollTop~~
~~• similar~~
~~• find.query/queryAll(CSSSelector)~~

**data.remove**

## 11MAR2026 still remaining from refactor:
~~• document / globals surfaces:~~
~~• tree.doc (curated document methods, useful for lifecycle/teardown wiring)~~
~~• tree.root (graph root of the node universe)~~
~~• hson.getRoot / global manager direction~~

 ~~DOM geometry + animation affordances~~
~~•	getBoundingClientRect and friends, maybe under .dom~~
• getAnimations
• automatic animation removal
~~• elementFromPoint, etc~~
~~• Keyframes teardown + keyframe ownership maps~~
 Multi-document / window switching bug
	•	queryBody() locked to one document; needs a fix eventually.
	•	Not coupled to attrs/flags.

## 14FEB2026
• (HTMLElement).focus() (see: getBoundingRect, below)
~~• hasFlag()~~
~~• document.getElementByPoint? (add to getClientBoundingRect etc -- .dom? )~~

## 12FEB2025
• break up CssManager similar to livetree (break out methods)

## 07FEB2026
• add 'role' special-casing?? 
• livetree.aria?
~~• liveTree.queryBody() currently is locked to a single window document; creating a new window and calling LiveTree does not switch from the old. fix.~~
~~• automatic teardown of keyframes~~

## 29JAN2026
~~• needed on LiveTree somewhere:~~
 ~~-- getBoundingRect & co.~~
 -- getAnimations
 ~~-- setTimeout?~~


## 25JAN2025
~~• hson.keyframes/hson.anim currently coerce underscores to hyphens? fix ~~

## 24JAN2026
~~• move .anim, .keyframes off of .css and onto tree.anim. atProperty stays on .css (?)~~ // possibly not actually
• .anim.setMany({})
√ ~~getAttrs/setAttrs => attrs.set/get~~

## 18JAN2026
• ~~change .setText so that it does not check element_for_node and instead writes node and updates if applicable~~
XXX  ~~• create.textnode~~
~~• pseudoelements ~~

## 17JAN
~~• fix multi-line CssMap calls: create a 'join' function within the set/setMany calls to accept a single string (w line breaks) and parse to style rather than necessitating this kind of thing:~~
 ~~```~~
 ~~textShadow: [~~
    ~~"0 1px 0 rgba(255,255,255,0.08)",~~
    ~~"0 -1px 0 rgba(0,0,0,0.35)",~~
    ~~"0 0 18px rgba(0,0,0,0.30)",~~
~~  ].join(", "),~~
~~```~~ // solved with backticks duh
• tree.css.keyframes.deleteMany()/deleteAll()

## 16JAN2026
• handle append() better. Should you be able to append an attached node to something new? If so it should not copy but remove and transport probably. Even if it does copy, it should not copy the quid; it should .clone() the node at most, which leaves quids behind. 

~~• Keyframes automatic teardown--node:keyframe map removes registered keyframes when node is removed~~

## 14JAN2026
✅ ~~.css.apply() for RAF calls~~

## 13JAN2026 
XXX ~~add Promise-based 'await' listener for timing sequenced listeners (see hson-demo2 for examples)~~ (no - out of scope for library)



## 09JAN2026
• ~~LiveTree.clone => same node IR, differet quid; for recreating elements but appending to different roots (ie for root-element swaps?)~~
✅ ~~.listen.onAnim("[name of animation]") (.end, .begin, etc) -- allows prefiltration/null checks of names of multiple events~~ 
