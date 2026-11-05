---
name: Post-merge schema application
description: Verify managed development database changes after merging schema updates.
---

After merging a database schema change, verify the provisioned development table before running schema-dependent integration tests. In this environment, the PR merge completed without applying the new columns; the documented post-merge setup callback successfully applied them.

**Why:** the persistence integration test clones the provisioned table, so it correctly failed until the actual development schema was updated.

**How to apply:** check `information_schema.columns` for the expected additions. If they are absent, use the documented post-merge setup flow rather than issuing ad hoc DDL.
