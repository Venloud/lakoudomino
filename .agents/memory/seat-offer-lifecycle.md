---
name: Seat-offer lifecycle
description: Distinction between creating seat offers after a game and maintaining existing offers.
---

After a finished game, `afterGame` returns new seat-offer events at the lifecycle boundary; callers must dispatch them immediately to connected waitlisted players. `checkOffers` handles expiration and offline maintenance for existing offers, so it cannot deliver a newly created offer by itself.

**Why:** A waitlisted client otherwise never receives the offer even though it is persisted.

**How to apply:** When an API path invokes `afterGame`, send its offer events to online waitlist sockets in the same request lifecycle. Keep periodic `checkOffers` for expiration and offline follow-up.