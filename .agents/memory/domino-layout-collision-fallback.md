---
name: Domino layout collision fallback
description: Durable rule for keeping centered domino chains and spinner branches inside the safe table area.
---

The domino renderer must treat the complete placed-tile rectangle set as the source of truth: keep straight cardinal growth while it fits, turn or detour when an edge or collision blocks it, and use a bounded free-slot search rather than allowing a dense branch to overlap or escape the table.

**Why:** A crowded spinner can have all four adjacent cardinal slots occupied by the main chain. A straight-only fallback can place a branch outside the safe area, which then distorts recentering and makes the rendered board appear off-center.

**How to apply:** Recompute physical rectangles after any placement change, recenter the full rectangle bounds, and only then apply the display scale. Validate both main-chain turns and multi-branch layouts.