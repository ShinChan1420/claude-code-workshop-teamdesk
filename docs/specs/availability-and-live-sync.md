# Spec: 7-day availability grid + live booking sync


## Context

Teamdesk's /bookings page shows one room and one day at a time, so finding a free slot means paging through days. Two bookers can also look at the same room and only find out about a clash when the create call fails. This adds a 7-day availability grid on /bookings and a WebSocket so every open browser sees changes straight away. Scope is sized for about 20 minutes.

## Decisions (from the interview)

- Slot = 15 minutes (`BOOKING_MIN_MINUTES`).
- Grid window = 08:00 to 18:00 UTC, 40 slots per day, next 7 UTC days starting today. New constants in `packages/db/src/shared.ts`: `AVAILABILITY_DAYS = 7`, `AVAILABILITY_START_HOUR = 8`, `AVAILABILITY_END_HOUR = 18`.
- Lives on /bookings, for the room already selected in the room picker.
- Booked cells read "Booked" only. No title, no member name.
- Clicking a free cell prefills the form start time (end = start + 15 min, user can extend).
- Clicking a booked or past cell jumps to the first free slot at or after that booking's end (or after now for past cells), searching forward through the 7 days. If none exists, show a short message and leave the form alone.
- WebSocket via one Durable Object, `BookingsHub`, as a broadcast hub. Message is a ping, `{ "type": "bookings.changed", "roomId": "<id>" }`. Clients refetch over tRPC. No booking data travels over the socket.

## Out of scope

Auth, time zones, multi-room overview, reconnect backoff tuning, presence, patching state from the socket payload, tests for the Durable Object itself.

## Design

### Server

1. `packages/services/src/bookings.ts`: add `availability(roomId, from)` returning the room's active bookings overlapping `[from day 00:00Z, +7 days)` as plain `{ startsAt, endsAt }[]`. Reuse `listRoomBookings` from `@repo/db/bookings` with a wider range and `utcDayBounds` from `time.ts`. Validate input with an exported zod schema, parse again in the service, keep it `async`.
2. `apps/web/src/server/trpc/routers/bookings.ts`: add `availability` query, thin (schema plus one service call).
3. Notify the hub after `create`, `cancel` and `reschedule` succeed. Do it in the router (not the service, so tests and services stay free of bindings). The hub stub comes from the Worker env, which is read only in `trpc/context.ts`: expose a `ctx.notifyBookingsChanged(roomId)` helper built there. Failures to notify are swallowed, since the booking already succeeded. A reschedule stays in the same room, so one ping.
4. `apps/web/src/server.ts`: route `GET /api/ws` with `Upgrade: websocket` to the Durable Object stub (`env.BOOKINGS_HUB.idFromName("main")`); everything else goes to TanStack Start as now.
5. New `apps/web/src/server/bookings-hub.ts`: `BookingsHub` Durable Object using the hibernation API (`ctx.acceptWebSocket`). `fetch` upgrades a socket; a `POST /notify` with `{ roomId }` broadcasts the ping to every accepted socket. Export the class from `server.ts`.
6. `apps/web/wrangler.jsonc`: add `durable_objects.bindings` (`BOOKINGS_HUB` to `BookingsHub`) and a `migrations` entry (`tag: "v1"`, `new_sqlite_classes: ["BookingsHub"]`).

### Client

1. `apps/web/src/lib/availability.ts` (pure, tested): `buildGrid(bookedIntervals, fromDay, now)` returns days of 40 slots with `state: "free" | "booked" | "past"` and the booking end for booked slots; `nextFreeSlot(grid, fromIso)` returns the first free slot start at or after `fromIso`, or null.
2. `apps/web/src/components/bookings/AvailabilityGrid.tsx`: renders columns for 7 days and rows for slots, each cell a button. Click handler applies the rules above and calls `onPick(startIso)`.
3. `apps/web/src/hooks/use-bookings-socket.ts`: opens `ws(s)://<host>/api/ws`, calls `onChange(roomId)` on each ping, closes on unmount, reconnects once after 2 s if it drops.
4. `apps/web/src/routes/bookings.tsx`: load availability in the loader next to `forRoom`, render the grid above the day list, pass `onPick` into the existing `BookingDraft` prefill, and when a ping's `roomId` matches the selected room, refetch availability and the day list (reuse the page's existing reload path). Import only `@repo/db/shared` in browser code.

### Rules from CLAUDE.md that apply

- Any new `package.json` `exports` line is manual; no new package modules are expected here since the service change goes in the existing file.
- `env` bindings are read only in `trpc/context.ts` (the DO binding is read there and in `server.ts`, the Worker entry; services stay binding-free).
- Plain JSON shapes: ids as strings, dates as ISO strings.
- No schema change, so no new drizzle migration. The Wrangler migration is for the Durable Object class only.

## Verification

- `bun test packages/services` with new service tests for `availability`: empty room, booking inside the window, booking spanning midnight, cancelled bookings excluded, other rooms excluded. Uses `createTestDatabase()` and the fixtures.
- `bun test apps/web/src/lib/availability.test.ts` for `buildGrid` and `nextFreeSlot`: past slots, booked run, skip across a day boundary, nothing free returns null.
- `bun run check` passes (lint and typecheck).
- Manual: `bun run dev`, open /bookings in two browser windows on the same room. Create a booking in one; the other grid updates without reload. Cancel it; the cell frees up. Click a booked cell: the form prefills the next free slot. Fill a whole week in the seed room and confirm the "no free slot" message.

## Open assumptions to flag

- Local `wrangler dev` supports Durable Objects, so sync should work under `bun run dev`. If the Vite Cloudflare plugin doesn't serve the DO locally, fall back to testing with `wrangler dev`.
- One hub for the whole app (`idFromName("main")`) is fine at team size.
