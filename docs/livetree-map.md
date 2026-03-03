

                        ┌────────────────────┐
                        │     index.html     │
                        │  (static shell)    │
                        └─────────┬──────────┘
                                  │
                                  ▼
                        ┌────────────────────┐
                        │   HSON bootstrap   │
                        │  parse / hydrate  │
                        └─────────┬──────────┘
                                  │
                                  ▼
                        ┌────────────────────┐
                        │     HsonNode       │
                        │  (canonical IR)   │
                        └─────────┬──────────┘
                                  │
                          wrapped by reference
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────┐
│                       LiveTree                          │
│  (mutable handle for one node + one host root)          │
│                                                         │
│  nodeRef ──────▶ HsonNode                               │
│  hostRoot ─────▶ HsonNode                               │
│                                                         │
│  ┌───────────────┐   ┌────────────────────────--──────┐ │
│  │ dom (lazy)    │──▶│ LiveTreeDom                    │ │
│  │               │   │  - query DOM element           │ │
│  │               │   │  - DOM mutations               │ │
│  └───────────────┘   └─────────────────────────────--─┘ │
│                                                         │
│  ┌───────────────┐   ┌─────────────────────────────--─┐ │
│  │ style (lazy)  │──▶│ StyleManager                   │ │
│  │               │   │  - inline style=""             │ │
│  │               │   │  - element-scoped              │ │
│  └───────────────┘   └────────────────────────────--──┘ │
│                                                         │
│  ┌───────────────┐   ┌──────────────────────────────--┐ │
│  │ css (cached)  │──▶│ CssHandle                      │ │
│  │               │   │  - QUID-scoped rules           │ │
│  │               │   │  - animations / keyframes      │ │
│  └───────────────┘   └─-─────────────┬───────────────-┘ │
│                                      │                  │
│                                      ▼                  │
│                           ┌────────────────────┐        │
│                           │   CssManager       │◀─────--┘
│                           │  (singleton)       │
│                           │                    │
│                           │  rulesByQuid       │
│                           │  globalCss         │
│                           │  @property mgr     │
│                           │  keyframes mgr     │
│                           └─────────┬──────────┘
│                                     │
│                                     ▼
│                          <style id="hson-_style">        │
│                                                        │
│  ┌───────────────┐   ┌──────────────────────────────-┐ │
│  │ data (lazy)   │──▶│ DataManager                   │ │
│  │               │   │  - data-* attrs               │ │
│  │               │   │  - node ↔ DOM sync            │ │
│  └───────────────┘   └─────────────────────────────-─┘ │
│                                                        │
│  ┌───────────────┐   ┌───────────────────────────── ─┐ │
│  │ listen        │──▶│ ListenerBuilder               │ │
│  │               │   │  - DOM events                 │ │
│  │               │   │  - typed handlers             │ │
│  └───────────────┘   └────────────────────────────-──┘ │
│                                                        │
│  ┌───────────────┐   ┌────────────────────────────-──┐ │
│  │ events        │──▶│ TreeEvents                    │ │
│  │               │   │  - local pub/sub              │ │
│  │               │   │  - not DOM                    │ │
│  └───────────────┘   └───────────────────────────-───┘ │
│                                                        │
│  find / findAll / create / attrs / flags / text        │
└────────────────────────────────────────────────────────┘
