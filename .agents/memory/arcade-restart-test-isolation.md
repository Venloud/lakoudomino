---
name: Arcade restart test isolation
description: Keep process-restart regression tests isolated from shared arcade matchmaking data.
---

Arcade startup intentionally deletes rooms older than the room TTL. Integration tests that restart the arcade process should point the child process at a dedicated database schema rather than the shared `arcade_rooms` table.

**Why:** A restart test must exercise the real persistence and startup cleanup paths without deleting or joining a room owned by a developer or player.

**How to apply:** Create a temporary schema for the test, set the child process connection search path to that schema, and drop it after all child processes stop.
