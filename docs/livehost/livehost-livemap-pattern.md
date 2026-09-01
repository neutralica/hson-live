# Deployment Patterns | hson-live

## Thin-Client - LiveHost / nojs client
## use cases:
• progressive

## Headless - LiveHost/Locus + Echo LiveMap (no DOM/LiveTree)
## use cases:
• Canvas/WebGL rendered manually rather than through DOM interpretation.
• Audio or MIDI applications.
• Collaborative editors whose view layer is some unrelated framework.
• Games or simulations.
• State-heavy background clients.
• A React/Vue/etc. view consuming the Echo-governed replica while ignoring LiveTree entirely.
• Automation or agent endpoints that participate in application state but have no UI.
• Potentially server/client coordination where the “client” is another process rather than a browser view
