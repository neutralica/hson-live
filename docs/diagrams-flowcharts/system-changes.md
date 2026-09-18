# HSON-LIVE - SYSTEM CHANGES & CLARIFICATIONS
15SEP2026

There have been substantial changes to the internals of hson-live, mainly around hardening and feature expansion. The claims made in the application will likely not change but the responsibilities will be shifted. 

The system has been hardened and tested much more rigorously, and any tentative claims can now be made with confidence. In addition, previously hypothetical architecture and capability has been added, particularly on the server side (LiveHost / Locus). Claims around the server architecture can accordingly expand to include full-stack end-to-end SSR via authoritative mutation of a distributed canonical node graph. 

## ARCHITECTURE

### overview
```
LiveHost = hosting/runtime/application dispatch boundary
* Locus = authoritative mutation/order/recovery boundary
LiveMap = canonical graph state and reduction
* Echo = client-side replica/authority connector
Reflect = LiveMap ↔ LiveTree bridge
LiveTree = runtime/browser realization

* = new
```

### LiveTree 

No changes.


### LiveMap

No changes.


### Transform

No changes. 


### LiveHost

LiveHost was previously broadly defined as 'the server side'. In addition to transport and session concerns, LiveHost's responsibilities included authoritative management of the shared node graph--control of the app state and the LiveMap that holds it. It became clear the subsystem was doing too much so I split it into two parts. 

Today, LiveHost is the application and runtime boundary. It provides the hosting contract: application registration, request/connection/dispatch, normalizing execution context, readiness, and lifecycle/disposal. It is no longer concerned with the canonical Hson graph state; that responsibility has been removed.

LiveHost is the portable hosting abstraction. Node LiveHost is the current Node.js implementation of that abstraction, responsible for physical HTTP/WebSocket ingress, security/resource policy, transport adaptation, and process lifecycle. The generic LiveHost layer exposes normalized requests and connections to applications without embedding Node-, WebSocket-, Locus-, or graph-specific semantics.

The application sits immediately beneath LiveHost and owns domain-specific composition. The dev determines routes, authorization and domain coordination, SSR and request policy, and Locus configuration and deployment.



### Locus (new)

Locus is the server-side LiveMap authority. It governs one authoritative LiveMap/state domain and synchronizes subordinate replicas across client sessions. Locus decides and sequences graph mutation, coordinates persistence and authorization, retains accepted canonical history, and synchronizes client replicas (-> Echo)._

Locus is an authoritative capstone to a server-side LiveMap, which it controls. The LiveMap's responsibilities do not change; it owns and edits canonical graph state and validates candidate state against schema. Locus governs who may mutate it, when, and how that is published or recovered. 

Locus does not replace LiveMap; it wraps it with hosted authority so that retained handles or other code cannot bypass the authoritative mutation path. Locus gives all canonical mutations one authoritative order even when application actions are happening concurrently. Locus also governs publication, session, recovery, and replay. 


### Echo (formerly 'client' or 'client LiveMap/LiveHost')

_Echo is a subjugated client endpoint. It submits client-side semantic edits to the server authority, maintains synchronization and recovery state, and applies only authority-approved canonical state to its local LiveMap replica._

Echo is the client-side counterpart to Locus. It maintains a LiveMap replica of authoritative state, sends client mutation intent to Locus, receives state changes back, and keeps the client synchronized without becoming a peer authority. Local mutation is fenced to prevent divergence from authority.



## IMPLICATIONS

- Where LiveHost is discussed as having 'authority' or controlling a LiveMap state--that is now more appropriately Locus. 
LiveHost is still the application layer and server router. 

- Where the phrases 'client' or 'client LiveMap/LiveHost' were used to describe the browser-side graph state manager, that is describing what is now the Echo component. 



