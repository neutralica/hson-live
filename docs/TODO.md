// hson-todo

## 25JAN2025
+ hson.keyframes/hson.anim currently coerce underscores to hyphens; fix this

## 24JAN2026
+ move .anim, .keyframes off of .css and onto tree.anim. atProperty stays on .css
+ .anim.setMany({})
+ getAttrs/setAttrs => attrs.set/get

## 18JAN2026
+ change .setText so that it does not check element_for_node and instead writes node and updates if applicable
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
+ 

## 16JAN2026
+ handle append() better. Should you be able to append an attached node to something new? If so it should not copy but remove and transport probably. Even if it does copy, it should not copy the quid; it should .clone() the node at most, which leaves quids behind. 

+ Keyframes automatic teardown--node:keyframe map removes registered keyframes when node is removed

## 14JAN2026
✅ ~~.css.apply() for RAF calls~~

## 13JAN2026 
✅ ~~add Promise-based 'await' listener for timing sequenced listeners (see hson-demo2 for examples)~~ (see hson-demo2 for trial impl; issues exist)



## 09JAN2026
+ ~~LiveTree.clone => same node IR, differet quid; for recreating elements but appending to different roots (ie for root-element swaps?)~~
✅ ~~.listen.onAnim("[name of animation]") (.end, .begin, etc) -- allows prefiltration/null checks of names of multiple events~~ (see hson-demo2 for trial impl)
