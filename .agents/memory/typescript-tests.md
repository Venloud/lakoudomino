---
name: Native TypeScript tests
description: The workspace can run TypeScript unit tests directly with Node's built-in test runner.
---

Use Node 24's built-in test runner for lightweight TypeScript engine tests instead of adding a test framework when the tests only need standard assertions. Keep relative imports explicit with the `.ts` extension, including workspace package entrypoints reached by direct tests, and enable `allowImportingTsExtensions` in each package's TypeScript config.

**Why:** The first engine slice needed tests without expanding the workspace dependency surface, and the runtime already supports TypeScript test files.

**How to apply:** For dependency-free shared logic packages, prefer `node --test src/*.test.ts` with `node:assert/strict`; use a dedicated framework only when its fixtures or browser integrations are actually needed. Node's direct ESM loader rejects extensionless directory imports even when the bundled application build accepts them. If authoritative or protected source uses extensionless imports, run tests through an already-installed `tsx` workspace runner rather than changing source imports solely to satisfy Node's loader.