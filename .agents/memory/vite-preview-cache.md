---
name: Vite preview module cache
description: An environment-specific preview quirk for newly added or renamed TypeScript/TSX modules.
---

When a newly added TSX module is renamed or changes extension, the running Vite preview can retain an obsolete HMR resolution and render a blank page even though a clean production build passes.

**Why:** The preview workflow and browser can hold the prior module graph longer than the filesystem state, so the symptom looks like an application failure rather than a stale dev graph.

**How to apply:** After confirming the source path and import graph are correct, restart the artifact workflow once before further visual debugging.