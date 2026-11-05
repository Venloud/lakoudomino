---
name: Scrabble private snapshots
description: Preserve hidden racks and tile-bag order across arcade room messages and validation.
---

Scrabble's stored room state must retain every rack and the ordered tile bag. Every client-facing snapshot is a seat-specific projection: include only that player's rack and hide the bag's tile identities. Move validation must rebuild the accepted result from the complete stored state rather than persisting a client projection.

**Why:** players must not gain an advantage by inspecting opponents' racks or future draws, while the server still needs the real tile order to validate draws and exchanges.

**How to apply:** use a per-seat view for create, reconnect, error recovery, public lookup, and broadcasts; keep database state authoritative and test projections for every seat. In the online client, represent the hidden bag as an empty identity list plus a separate public count. Recreate legacy blank bag entries only at the network serialization boundary; never let those placeholders enter the rack. Offline play keeps the full bag.
