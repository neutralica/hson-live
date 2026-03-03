// hson-todo

## TEMP TODO

1) Unify LiveTree API around handle surfaces for “fields”
	•	Treat “field-ish” domains as handles (id, text, classlist, css, data, content, etc).
	•	Attrs + flags are the main offenders and should be converted to handles.

2) Break the old attrs/flags methods on purpose
	•	Go “all-in” on breaking changes (no long deprecation layer), and rely on the LiveTree tests to keep us honest.

3) Naming choice
	•	Use singular manager handles: tree.attr and tree.flag (not attrs/flags), consistent with text, id, css, etc.
	•	Keep data as-is for now (you noted dataset naming is optional; current surface works).

4) Keep DOM-specific things in .dom
	•	.dom stays the “specialized / might be absent off-DOM” zone.
	•	We’re not trying to route anything through raw document.* at this stage.

-> Likely-next, but still triage-worthy

5) Define what “flag” means precisely
	•	You want hasFlag()-style ability; under the new surface that becomes:
	•	tree.flag.has("disabled")
	•	plus tree.flag.set(...) and tree.flag.drop(...) (or remove).
	•	Decide whether flag.set("disabled") implies boolean-present attribute semantics only (almost certainly yes).

6) Decide whether data should become dataset
	•	Not required. You like the pared-down naming.
	•	If you ever add a tree.data non-DOM concept, then renaming to dataset becomes attractive to avoid semantic collision.

-> Parked / optional (not in the “do it now” scope)

7) Document / globals convenience surfaces:
	•	tree.doc (curated document methods, useful for lifecycle/teardown wiring)
	•	tree.root (graph root of the node universe)
	•	hson.getRoot / global manager direction

-> good ideas, but they’re bigger semantics decisions than attrs/flags and don’t need to be bundled into the same breaking-change batch.

8) DOM geometry + animation affordances
	•	getBoundingClientRect and friends, maybe under .dom
	•	getAnimations
	•	elementFromPoint, etc

-> useful, but separate from the “normalize the API surface” work.

9) Keyframes teardown + keyframe ownership maps
	•	Still a TODO category; not directly coupled to attrs/flags.

10) Multi-document / window switching bug
	•	queryBody() locked to one document; needs a fix eventually.
	•	Not coupled to attrs/flags.

## 14FEB2026
+ (HTMLElement).focus() (see: getBoundingRect, below)
+ hasFlag()
+ document.getElementByPoint? (add to getClientBoundingRect etc -- .dom? )

## 12FEB2025
+ break up CssManager similar to livetree

## 07FEB2026
+ add 'role' special-casing?? 
+ livetree.aria?
+ liveTree.queryBody() currently is locked to a single window document; creating a new window and calling LiveTree does not switch from the old. fix.
+ automatic teardown of keyframes when possible

## 29JAN2026
+ needed on LiveTree somewhere:
 -- getBoundingRect & co.
 -- getAnimations
 -- setTimeout?
 -- etc


## 25JAN2025
+ hson.keyframes/hson.anim currently coerce underscores to hyphens? fix 

## 24JAN2026
+ move .anim, .keyframes off of .css and onto tree.anim. atProperty stays on .css
+ .anim.setMany({})
√ ~~getAttrs/setAttrs => attrs.set/get~~

## 18JAN2026
+ ~~change .setText so that it does not check element_for_node and instead writes node and updates if applicable~~
+ create.textnode
+ pseudoelements handling 

## 17JAN
+ fix multi-line CssMap calls: create a 'join' function within the set/setMany calls to accept a single string (w line breaks) and parse to style rather than necessitating this kind of thing:
 ```
 textShadow: [
    "0 1px 0 rgba(255,255,255,0.08)",
    "0 -1px 0 rgba(0,0,0,0.35)",
    "0 0 18px rgba(0,0,0,0.30)",
  ].join(", "),
```
+ tree.css.keyframes.deleteMany()/deleteAll()

## 16JAN2026
+ handle append() better. Should you be able to append an attached node to something new? If so it should not copy but remove and transport probably. Even if it does copy, it should not copy the quid; it should .clone() the node at most, which leaves quids behind. 

+ Keyframes automatic teardown--node:keyframe map removes registered keyframes when node is removed

## 14JAN2026
✅ ~~.css.apply() for RAF calls~~

## 13JAN2026 
✅ ~~add Promise-based 'await' listener for timing sequenced listeners (see hson-demo2 for examples)~~ (no - out of scope for library)



## 09JAN2026
+ ~~LiveTree.clone => same node IR, differet quid; for recreating elements but appending to different roots (ie for root-element swaps?)~~
✅ ~~.listen.onAnim("[name of animation]") (.end, .begin, etc) -- allows prefiltration/null checks of names of multiple events~~ 
