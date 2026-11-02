---
name: Protected GitHub main
description: GitHub rejects direct pushes to the Lakou Domino main branch.
---

The repository's `main` branch is protected and accepts changes only through a pull request. Do not force-push or attempt to bypass the protection. Push project changes to a feature branch and open a PR; keep remote commits intact.

**Why:** A direct push was rejected by GitHub's protected-branch hook, while a feature branch push and PR succeeded.

**How to apply:** Before syncing workspace changes, fetch `github/main`. Rebase local work on the current remote history, publish a feature branch, and open a PR. After the PR is merged, fetch the result so the workspace and `main` match.
