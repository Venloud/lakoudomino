---
name: Vite compressed assets
description: Serving manually gzipped static data in Vite development and production.
---

Keep a manually gzipped asset under a non-`.gz` filename when browser code explicitly decompresses it. Vite recognizes `.gz` as precompressed content and may serve it decoded in development, which makes a `DecompressionStream` consumer fail.

**Why:** Word Yard's bundled dictionary loaded correctly in the production build but failed in the development preview when the compressed asset used a `.gz` suffix.

**How to apply:** Name compressed Vite assets with a neutral extension such as `.bin`, verify the dev response bytes are still gzip-compressed, and test decompression from the browser-facing loader.
