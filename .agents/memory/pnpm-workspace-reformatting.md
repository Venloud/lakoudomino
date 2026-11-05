---
name: pnpm workspace reformatting
description: Package additions can rewrite workspace-level YAML policy and formatting.
---

After using `pnpm add` in this workspace, inspect `pnpm-workspace.yaml` and restore unrelated formatting, comments, and ordering changes before finishing.

**Why:** The installed pnpm version rewrites the workspace file when adding a package, reordering overrides and removing explanatory comments even when those settings are unchanged.

**How to apply:** Keep dependency and lockfile changes, but review the workspace YAML diff separately and avoid broad churn to security policy or platform overrides.
