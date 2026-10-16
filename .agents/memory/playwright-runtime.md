---
name: Headless browser runtime
description: Replit container requirements for Playwright and artifact-proxy routing.
---

In this Replit Nix container, downloading a Playwright browser is not enough to launch it: the browser may still lack runtime shared libraries. Install missing libraries through the Nix system-dependency flow rather than apt.

The current `playwright-cli` defaults to the separate Chrome channel at `/opt/google/chrome/chrome`; `install-browser chrome` attempts apt and fails. `--browser=firefox` with `install-browser firefox` worked after installing `gtk3`, `gdk-pixbuf`, `nss`, and `nspr` through Nix system dependencies. CLI browser daemons may be cleaned up when a `ShellExec` call ends, so keep open, interactions, and screenshots in one call.

In the installed CLI, `run-code` accepts an inline async callback such as `async (page) => ...`. Its outer execution scope may lack browser globals such as `URL` and Node timers such as `setTimeout`; derive the origin from `page.url()`, use `page.evaluate()` for browser APIs, and use `page.waitForTimeout()` for delays. The workspace wrapper may also need to be invoked with `bash` when it has no executable bit.

For browser tests that depend on API or WebSocket routes, inspect the artifact's `previewPath` in `artifact.toml` and use the proxied preview URL. A direct Vite dev-port URL can render the UI while bypassing service routing; adding the artifact directory name to a root-path artifact URL can instead trigger the app's 404 route.

**Why:** The container blocks apt, browser startup fails before navigation when required shared libraries or matching NSS versions are unavailable, shell cleanup can terminate the CLI daemon between calls, and `run-code` executes outside the browser page's global scope without Node timers. In browser testing, the direct dev port rendered the app but left API/WebSocket requests disconnected; the root proxy URL routed them correctly.

**How to apply:** Check the current CLI's supported browser channels, install a managed browser, add only the missing libraries through Nix system dependencies, invoke a non-executable wrapper with `bash`, keep each CLI session within one shell call, and use browser-side APIs or `page.waitForTimeout()` from `run-code`. For app interaction tests, check `previewPath` first and use the proxied preview URL that preserves API/WebSocket routing.