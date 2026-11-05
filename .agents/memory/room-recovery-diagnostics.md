---
name: Safe persisted-room recovery diagnostics
description: Keep operator-facing summaries of skipped persisted rooms aggregate and credential-free.
---

Operator-facing recovery diagnostics may show skipped-room totals and sanitized issue field paths, but must not expose room codes, reconnect-token hashes, tokens, raw persisted values, or raw exception messages.

**Why:** The task requirements explicitly forbid credentials in operator-facing recovery output; aggregate diagnostics are useful without identifying rooms or revealing stored values.

**How to apply:** Add only counts and sanitized static field paths to health or operational endpoints. Keep detailed room context in server logs, not response payloads.
