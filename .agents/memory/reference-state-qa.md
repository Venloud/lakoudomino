---
name: Reference-state visual QA
description: Visual QA guidance for multi-state reference-driven interface work.
---

Reference-driven UI work should be checked as separate visual states: public lobby, signed-in lobby, auth, waiting room, desktop table, mobile table, and results overlay.

**Why:** These states use different route markup and responsive composition. A successful lobby screenshot can hide broken auth spacing, missing waiting-room rails, or mobile table sizing.

**How to apply:** Capture each requested state at its intended viewport after the shared styling pass. Treat route-specific clipping, missing token/preview handling, and modal layering as separate defects.