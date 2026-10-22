# Caribbean Dominoes

Caribbean Dominoes is a mobile-first guest room game for four friends to play regular or points-style dominoes from a shared link.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for room and game snapshot contracts
- `artifacts/api-server/src/routes/rooms.ts` — durable room/lobby API and WebSocket game state
- `artifacts/caribbean-dominoes/src/pages/home.tsx` — create/join flow
- `artifacts/caribbean-dominoes/src/pages/room.tsx` — lobby and game-table shell
- `artifacts/caribbean-dominoes/src/components/domino-tile.tsx` — reusable pip-rendered domino tile

## Architecture decisions

- The game engine is a dependency-free shared library so server-authoritative rules can be reused by future WebSocket handlers and tests.
- Room state is persisted in PostgreSQL and rehydrated before the API begins accepting traffic; live WebSocket connections remain process-local and reconnect by their persisted seat name.
- API contracts are OpenAPI-first; generated React Query hooks are the frontend integration boundary.
- The UI is intentionally restrained: tactile table-game styling with no decorative motion that competes with play.
- During the owner-selected Tiki Taka / Vandam Route workflow, Replit is publisher-only: approved GitHub pull requests are the source of application changes, and Replit must not make or commit code edits. Outside Tiki Taka, the owner may explicitly instruct Replit Agent to code selected changes on a separate branch and PR. Never automatically commit, push directly to `main`, overwrite concurrent Claude/Codex work or force-push. See `Venloud/claudevandam/route/PHASE4_DECISION.md` for the current owner override.

## Product

- Guests can open or join a room with a code, choose Regular or Points mode, and set the Points row length.
- Hosts can fill empty seats with bots and deal a verified seven-tile hand to all four seats.
- Players can see room occupancy, the current turn, tile counts, the board, and their own hand in the live shell.

## User preferences

 - Keep the build incremental: engine and scoring first, then rooms and multiplayer, then the UI.

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`.
- The generated API client needs `dom.iterable` in its TypeScript `lib` settings for `Headers.entries()`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
