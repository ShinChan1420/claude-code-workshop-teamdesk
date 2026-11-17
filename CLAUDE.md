# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Bun workspaces + Turborepo: `apps/web` (TanStack Start on Cloudflare Workers, Hono, tRPC), `packages/db` (Drizzle + D1), `packages/services` (business rules). A request flows route → tRPC router → service → db query functions.

## Commands

- `bun run dev` starts the app on :3000 against a local D1 (SQLite in `apps/web/.wrangler`). It re-applies migrations and re-seeds on every start. Delete `.wrangler` for a clean slate.
- `bun test` runs every test. One file: `bun test <path>`. One test: add `-t "name"`.
- `bun run check` is lint (Ultracite/Biome) plus typecheck. Run it before saying work is done. `bun run fix` formats.

- `bun run dev:remote` runs the dev server against the real D1 database (`REMOTE_DB=1`, read in `vite.config.ts`). `db:apply` / `db:seed` (and `:remote` variants) run wrangler against local or remote D1. `bun run deploy` builds and runs `wrangler deploy`.
- A husky pre-commit hook runs `ultracite fix` and re-stages files, so staged files may change on commit.

Use bun, not npm or yarn. The lockfile is `bun.lock` and scripts assume bun.

## Rules that are easy to get wrong

**Browser code imports only `@repo/db/shared`.**
Every other `@repo/db` entry imports drizzle. A route component that imports one pulls drizzle into the client bundle. Types and limits the UI needs go in `packages/db/src/shared.ts`.

**No barrel files; register new modules by hand.**
Each module is its own `exports` line in the package's `package.json`, so a new table or service file is unreachable until you add the line. A new service also needs a line in `apps/web/src/server/trpc/context.ts`, or `ctx.services` won't have it.

**Validate in services, never in `@repo/db`.**
Query functions trust their input. Services export the zod schema, the tRPC router passes it to `.input()`, and the service parses again so callers that skip tRPC are still safe. Service methods stay `async` so a validation error rejects rather than throws synchronously.

**Read `env.DB` only in `trpc/context.ts`.**
Services and query functions take a drizzle instance as a parameter. That lets the same code run on D1 and on `bun:sqlite` in tests. Reading a binding anywhere else breaks the tests.

**Return plain JSON shapes from db functions.**
tRPC serializes to JSON, so ids are strings and dates are ISO strings. Don't leak the stored row type.

**Fail with a `ServiceError` subclass.**
`NotFoundError`, `ValidationError`, `ConflictError` and `ForbiddenError` from `@repo/services/errors`. `trpc/init.ts` maps them to HTTP status codes. A plain `Error` becomes a 500.

**There is no auth. Mutations take `actorId`.**
Mutations take the acting member's id first and check it with `requireMember` or `requireAdmin`. `ctx.userId` is always null, so `protectedProcedure` always returns 401. Don't use it for team features.

**Schema changes need a generated migration.**
After editing `packages/db/src/schema.ts`, run `bun run generate` in `packages/db` and commit `migrations/` including `migrations/meta/`. Without the snapshot, the next generate tries to recreate the tables. Wrangler applies migrations, not drizzle-kit.

**Keep routers thin.**
A router is an input schema plus one service call. Business rules go in the service so tests cover them. Tests use `createTestDatabase()` with the real migrations, and `packages/services/src/fixtures.ts` provides a small team and two rooms.

**Call tRPC through `getTrpc()` from `#/integrations/trpc/client`.**
It runs in-process during SSR and over HTTP in the browser. Don't `fetch('/api/trpc')` from a loader. The Worker would call itself.

**Don't hand-edit `apps/web/src/components/ui/`.**
It is shadcn output and gets regenerated.

**`notes` is boilerplate.**
It is the template for new tables and services (`packages/db/src/notes.ts`, `packages/services/src/notes.ts`), not a product feature.

**Live sync goes through one Durable Object.**
`BookingsHub` (`apps/web/src/server/bookings-hub.ts`) is a single instance (`idFromName("main")`) that holds every browser's WebSocket from `/api/ws` (routed in `server.ts`). After a booking mutation the router calls `ctx.notifyBookingsChanged(roomId)`, which POSTs `/notify` to the hub, and the hub broadcasts `{type: "bookings.changed", roomId}`. The socket carries no booking data: clients (`hooks/use-bookings-socket.ts`) refetch over tRPC. The notifier never rejects, since the booking already succeeded. The class must stay a named export of `server.ts`, and `wrangler.jsonc` declares its binding and migration. Design notes are in `docs/specs/`.

**The availability grid is pure logic plus pointer handling.**
`apps/web/src/lib/availability.ts` builds the 7-day grid and clamps drags (`dragRange` stops at the first non-free slot); it has no DOM or bindings and is unit-tested. `AvailabilityGrid.tsx` turns pointer events into a range, where a plain click is a one-slot drag. The picked range lives in `routes/bookings.tsx` (`selection`) and stays highlighted until the booking is created or the room changes. Slots someone else books drop out of the highlight because only free slots render as selected.
