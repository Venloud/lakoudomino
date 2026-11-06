---
name: Retried room synchronization
description: Keep successful quarantined-room retries visible to all running API instances.
---

Broadcast retry activation through PostgreSQL notifications, then reconcile active persisted rooms after a listener reconnect. Synchronization should only register rooms missing from the local map; replacing an existing runtime can discard live sockets and current in-memory state.

**Why:** API instances own separate in-memory room maps, while the database is shared. Notifications provide fast fan-out, and reconciliation recovers events missed during a listener outage.

**How to apply:** For other persisted room types with cross-instance activation, publish a transactional notification and make reconnect reconciliation idempotent and non-destructive to active local runtimes.
