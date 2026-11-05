---
name: Arcade resignation results
description: Persistence and privacy rules for resignation outcomes in arcade rooms.
---

Keep resignation results in server-owned metadata alongside the arcade room's stored player JSON, not in game state supplied by clients. Public room snapshots must map player rows to only their public name and seat fields.

**Why:** arcade game states have different shapes and clients submit them; storing outcome metadata inside those states risks game-specific breakage or client forgery. A dedicated result column would require a database migration.

**How to apply:** preserve the metadata through room restore/update paths, validate it before trusting it, and never expose it through room player summaries.
