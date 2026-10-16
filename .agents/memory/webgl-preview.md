---
name: WebGL preview fallback
description: The shared browser preview can fail to create a WebGL context even when the app is otherwise healthy.
---

Check WebGL capability before mounting React Three Fiber Canvas surfaces in this project family, and keep the fallback interactive rather than allowing the renderer error overlay to replace the room.

**Why:** The Replit headless preview may report `THREE.WebGLRenderer: Error creating WebGL context` while ordinary browsers and supported phones can render WebGL normally.

**How to apply:** Keep 3D scenes progressively enhanced: the supported path should use the real R3F scene, while unsupported or headless clients should retain the current game state and legal actions in a readable fallback.