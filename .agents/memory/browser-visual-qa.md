---
name: Browser visual QA
description: Workspace browser limitations and the reliable visual verification path for the dominoes app
---

The workspace preview capture is a reliable visual check for this app even when the terminal Playwright CLI cannot launch because its bundled Chrome channel is unavailable. Use the preview capture for layout review and test realtime behavior directly against the WebSocket server when browser automation is blocked.

**Why:** The environment may have a system Chromium binary while the Playwright CLI expects a separate browser distribution, so installing test browsers just for a visual check is unnecessary overhead.

**How to apply:** Keep responsive fallback markup functional without session-only setup, and verify chat or other socket behavior with a direct authenticated WebSocket client when needed.