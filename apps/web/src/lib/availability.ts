// Pure grid logic for the /bookings availability view: no DOM, no bindings, so
// it runs the same in the Worker (SSR) and the browser, and tests need no setup.
import {
  AVAILABILITY_DAYS,
  AVAILABILITY_END_HOUR,
  AVAILABILITY_START_HOUR,
  BOOKING_MIN_MINUTES,
} from "@repo/db/shared";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const SLOT_MS = BOOKING_MIN_MINUTES * MS_PER_MINUTE;
const SLOTS_PER_DAY =
  ((AVAILABILITY_END_HOUR - AVAILABILITY_START_HOUR) * MS_PER_HOUR) / SLOT_MS;

export interface BookedInterval {
  endsAt: string;
  startsAt: string;
}

export type SlotState = "free" | "booked" | "past";

export interface GridSlot {
  /** For a booked slot, when the booking covering it ends. Otherwise null. */
  bookedUntil: string | null;
  endsAt: string;
  startsAt: string;
  state: SlotState;
}

export interface GridDay {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  slots: GridSlot[];
}

/**
 * AVAILABILITY_DAYS days of slots starting at `fromDay` (YYYY-MM-DD, UTC). A
 * slot that has already started by `now` is "past", even if it is also booked.
 */
export function buildGrid(
  booked: BookedInterval[],
  fromDay: string,
  now: Date
): GridDay[] {
  const intervals = booked.map((b) => ({
    end: Date.parse(b.endsAt),
    endsAt: b.endsAt,
    start: Date.parse(b.startsAt),
  }));
  const firstDayMs = Date.parse(`${fromDay}T00:00:00.000Z`);
  const nowMs = now.getTime();

  return Array.from({ length: AVAILABILITY_DAYS }, (_, dayIndex) => {
    const dayMs = firstDayMs + dayIndex * MS_PER_DAY;
    const slots = Array.from({ length: SLOTS_PER_DAY }, (_slot, slotIndex) => {
      const start = dayMs + AVAILABILITY_START_HOUR * MS_PER_HOUR;
      const slotStart = start + slotIndex * SLOT_MS;
      const slotEnd = slotStart + SLOT_MS;
      const covering = intervals.filter(
        (i) => i.start < slotEnd && i.end > slotStart
      );
      const bookedUntil = covering.reduce<number | null>(
        (latest, i) => (latest === null || i.end > latest ? i.end : latest),
        null
      );

      let state: SlotState = "free";
      if (slotStart < nowMs) {
        state = "past";
      } else if (bookedUntil !== null) {
        state = "booked";
      }

      return {
        bookedUntil:
          state === "booked" && bookedUntil !== null
            ? new Date(bookedUntil).toISOString()
            : null,
        endsAt: new Date(slotEnd).toISOString(),
        startsAt: new Date(slotStart).toISOString(),
        state,
      };
    });
    return { day: new Date(dayMs).toISOString().slice(0, 10), slots };
  });
}

/**
 * Start of the first free slot at or after `fromIso`, searching forward through
 * every day in the grid, or null when the rest of the grid is taken.
 */
export function nextFreeSlot(grid: GridDay[], fromIso: string): string | null {
  const fromMs = Date.parse(fromIso);
  for (const { slots } of grid) {
    for (const slot of slots) {
      if (slot.state === "free" && Date.parse(slot.startsAt) >= fromMs) {
        return slot.startsAt;
      }
    }
  }
  return null;
}

/**
 * `fromIso` if it is free, otherwise the end of the booking covering it,
 * repeated while back-to-back bookings keep covering the new time.
 */
export function nextFreeTime(
  booked: BookedInterval[],
  fromIso: string
): string {
  let t = Date.parse(fromIso);
  let moved = true;
  while (moved) {
    moved = false;
    for (const b of booked) {
      const end = Date.parse(b.endsAt);
      if (Date.parse(b.startsAt) <= t && t < end) {
        t = end;
        moved = true;
      }
    }
  }
  return new Date(t).toISOString();
}

/** True when any booking shares time with [startIso, endIso). Touching is fine. */
export function overlapsBooked(
  booked: BookedInterval[],
  startIso: string,
  endIso: string
): boolean {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  return booked.some(
    (b) => Date.parse(b.startsAt) < end && Date.parse(b.endsAt) > start
  );
}
