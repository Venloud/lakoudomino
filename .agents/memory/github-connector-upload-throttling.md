---
name: GitHub connector upload pacing
description: The GitHub connector can throttle bursts of Git blob uploads even when the GitHub core API quota is not exhausted.
---

When uploading a large workspace through GitHub's Git Data API, limit concurrency and add a short pause between blob requests. If a burst returns 429 responses, retry those blobs at a slower pace before creating the tree and moving the branch ref.

**Why:** A fast burst of parallel blob requests hit connector throttling while the GitHub core API quota still had capacity.

**How to apply:** Pace bulk uploads through `proxyFetch`; check that every expected blob has a SHA before creating a commit or updating a branch.
