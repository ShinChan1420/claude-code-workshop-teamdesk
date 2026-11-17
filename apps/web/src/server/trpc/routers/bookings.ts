import {
  availabilityInput,
  createBookingInput,
  rescheduleBookingInput,
} from "@repo/services/bookings";
import { z } from "zod";
import { publicProcedure, router } from "../init.ts";

export const bookingsRouter = router({
  availability: publicProcedure
    .input(availabilityInput)
    .query(({ ctx, input }) =>
      ctx.services.bookings.availability(input.roomId, input.from)
    ),
  cancel: publicProcedure
    .input(z.object({ actorId: z.string(), bookingId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.services.bookings.cancel(
        input.actorId,
        input.bookingId
      );
      await ctx.notifyBookingsChanged(booking.roomId);
      return booking;
    }),
  create: publicProcedure
    .input(z.object({ actorId: z.string(), booking: createBookingInput }))
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.services.bookings.create(
        input.actorId,
        input.booking
      );
      await ctx.notifyBookingsChanged(booking.roomId);
      return booking;
    }),
  forRoom: publicProcedure
    .input(z.object({ day: z.iso.datetime(), roomId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.services.bookings.listForRoom(input.roomId, input.day)
    ),
  reschedule: publicProcedure
    .input(
      z.object({
        actorId: z.string(),
        bookingId: z.string(),
        slot: rescheduleBookingInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const booking = await ctx.services.bookings.reschedule(
        input.actorId,
        input.bookingId,
        input.slot
      );
      await ctx.notifyBookingsChanged(booking.roomId);
      return booking;
    }),
  upcoming: publicProcedure
    .input(z.object({ memberId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.services.bookings.listUpcoming(
        input.memberId,
        new Date().toISOString()
      )
    ),
});
