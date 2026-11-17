import { trpcServer } from "@hono/trpc-server";
import handler from "@tanstack/react-start/server-entry";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { createHonoContext } from "./server/trpc/context.ts";
import { appRouter } from "./server/trpc/router.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ status: "ok" }));

// tRPC: queries and mutations for the browser. During SSR the loaders call the
// same router in-process instead (src/integrations/trpc/client.ts).
// csrf() rejects cross-site POSTs with form content types, which browsers send
// without a preflight. JSON POSTs are safe only because a cross-site one needs
// a CORS preflight that nothing here answers: adding cors() to these routes
// would leave mutations open to CSRF.
app.use("/api/trpc/*", csrf());
app.use(
  "/api/trpc/*",
  trpcServer({
    createContext: (_opts, c) => createHonoContext(c),
    endpoint: "/api/trpc",
    // Production clients only see "Internal server error" (see init.ts), so
    // the real error goes to the Worker logs.
    onError: ({ error, path }) => {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error(`tRPC ${path ?? "?"} failed:`, error.cause ?? error);
      }
    },
    router: appRouter,
  })
);

// Live sync: every browser's WebSocket lands on the one BookingsHub, which
// pings them when a booking changes (see trpc/context.ts).
app.get("/api/ws", (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected a WebSocket upgrade", 426);
  }
  const hub = c.env.BOOKINGS_HUB.get(c.env.BOOKINGS_HUB.idFromName("main"));
  return hub.fetch(c.req.raw);
});

// Everything else is handled by TanStack Start (SSR pages and assets).
app.all("*", (c) => handler.fetch(c.req.raw));

// biome-ignore lint/performance/noBarrelFile: Cloudflare finds a Durable Object class only as a named export of the Worker entry
export { BookingsHub } from "./server/bookings-hub.ts";
export default app;
