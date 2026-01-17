// hson-todo



## 17JAN
+fix multi-line CssMap calls: create a 'join' function within the set/setMany calls to accept a single string (w line breaks) and parse to style rather than necessitating this kind of thing:
 ```
 textShadow: [
    // slight emboss: light edge + dark edge
    "0 1px 0 rgba(255,255,255,0.08)",
    "0 -1px 0 rgba(0,0,0,0.35)",
    // soft “ink” bleed
    "0 0 18px rgba(0,0,0,0.30)",
  ].join(", "),
```

## 16JAN2026
+ handle append() better. Should you be able to append an attached node to something new? If so it should not copy but remove and transport probably. Even if it does copy, it should not copy the quid; it should .clone() the node at most, which leaves quids behind. 

+ Keyframes automatic teardown--node:keyframe map removes registered keyframes when node is removed

## 14JAN2026
√ .css.apply() for RAF calls

## 13JAN2026 
+ add Promise-based 'await' listener for timing sequenced listeners (see hson-demo2 for examples)


## 09JAN2026
+ LiveTree.clone => same node IR, differet quid; for recreating elements but appending to different roots (ie for root-element swaps?)
+ .listen.onAnim("[name of animation]") (.end, .begin, etc) -- allows prefiltration/null checks of names of multiple events
