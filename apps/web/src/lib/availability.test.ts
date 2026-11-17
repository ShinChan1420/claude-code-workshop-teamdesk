import { describe, expect, test } from "bun:test";
import {
  buildGrid,
  nextFreeSlot,
  nextFreeTime,
  overlapsBooked,
} from "./availability.ts";

const DAY = "2026-10-23";
const iso = (day: string, time: string) => `${day}T${time}:00.000Z`;
const early = new Date(iso(DAY, "00:00"));

describe("buildGrid", () => {
  test("covers 7 days of 40 slots from 08:00 to 18:00", () => {
    const grid = buildGrid([], DAY, early);

    expect(grid).toHaveLength(7);
    expect(grid.map((d) => d.day)).toEqual([
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
    ]);
    const first = grid.at(0);
    expect(first?.slots).toHaveLength(40);
    expect(first?.slots[0]?.startsAt).toBe(iso(DAY, "08:00"));
    expect(first?.slots.at(-1)?.endsAt).toBe(iso(DAY, "18:00"));
    expect(grid.every((d) => d.slots.every((s) => s.state === "free"))).toBe(
      true
    );
  });

  test("marks slots that have started as past", () => {
    const grid = buildGrid([], DAY, new Date(iso(DAY, "09:10")));
    const states = grid
      .at(0)
      ?.slots.slice(0, 6)
      .map((s) => s.state);

    // 08:00, 08:15, 08:30, 08:45, 09:00 have started; 09:15 has not.
    expect(states).toEqual(["past", "past", "past", "past", "past", "free"]);
  });

  test("marks a booked run and records where it ends", () => {
    const grid = buildGrid(
      [{ endsAt: iso(DAY, "10:00"), startsAt: iso(DAY, "09:00") }],
      DAY,
      early
    );
    const slots = grid.at(0)?.slots ?? [];
    const at = (time: string) =>
      slots.find((s) => s.startsAt === iso(DAY, time));

    expect(at("08:45")?.state).toBe("free");
    expect(at("09:00")).toMatchObject({
      bookedUntil: iso(DAY, "10:00"),
      state: "booked",
    });
    expect(at("09:45")?.state).toBe("booked");
    expect(at("10:00")?.state).toBe("free");
    expect(at("10:00")?.bookedUntil).toBeNull();
  });

  test("a booking that spans midnight fills the next morning's slots", () => {
    const grid = buildGrid(
      [{ endsAt: iso("2026-10-24", "08:30"), startsAt: iso(DAY, "23:00") }],
      DAY,
      early
    );
    const next = grid.at(1)?.slots ?? [];

    expect(next[0]?.state).toBe("booked");
    expect(next[1]?.state).toBe("booked");
    expect(next[2]?.state).toBe("free");
  });
});

describe("nextFreeSlot", () => {
  test("returns the first free slot at or after the time", () => {
    const grid = buildGrid(
      [{ endsAt: iso(DAY, "10:00"), startsAt: iso(DAY, "09:00") }],
      DAY,
      early
    );

    expect(nextFreeSlot(grid, iso(DAY, "09:00"))).toBe(iso(DAY, "10:00"));
    expect(nextFreeSlot(grid, iso(DAY, "10:00"))).toBe(iso(DAY, "10:00"));
    expect(nextFreeSlot(grid, iso(DAY, "08:00"))).toBe(iso(DAY, "08:00"));
  });

  test("skips past slots when searching from now", () => {
    const now = new Date(iso(DAY, "09:10"));
    const grid = buildGrid([], DAY, now);

    expect(nextFreeSlot(grid, now.toISOString())).toBe(iso(DAY, "09:15"));
  });

  test("skips across a day boundary", () => {
    const grid = buildGrid(
      [{ endsAt: iso(DAY, "18:00"), startsAt: iso(DAY, "17:00") }],
      DAY,
      early
    );

    expect(nextFreeSlot(grid, iso(DAY, "17:00"))).toBe(
      iso("2026-10-24", "08:00")
    );
  });

  test("returns null when nothing is free", () => {
    const grid = buildGrid(
      [{ endsAt: iso("2026-10-30", "00:00"), startsAt: iso(DAY, "00:00") }],
      DAY,
      early
    );

    expect(nextFreeSlot(grid, iso(DAY, "00:00"))).toBeNull();
  });
});

describe("nextFreeTime", () => {
  const nine = { endsAt: iso(DAY, "10:00"), startsAt: iso(DAY, "09:00") };
  const ten = { endsAt: iso(DAY, "11:00"), startsAt: iso(DAY, "10:00") };

  test("returns a free time unchanged, including a booking's end", () => {
    expect(nextFreeTime([nine], iso(DAY, "08:45"))).toBe(iso(DAY, "08:45"));
    expect(nextFreeTime([nine], iso(DAY, "10:00"))).toBe(iso(DAY, "10:00"));
  });

  test("moves a time inside a booking to its end", () => {
    expect(nextFreeTime([nine], iso(DAY, "09:30"))).toBe(iso(DAY, "10:00"));
    expect(nextFreeTime([nine], iso(DAY, "09:00"))).toBe(iso(DAY, "10:00"));
  });

  test("chains across back-to-back bookings", () => {
    expect(nextFreeTime([ten, nine], iso(DAY, "09:15"))).toBe(
      iso(DAY, "11:00")
    );
  });
});

describe("overlapsBooked", () => {
  const nine = { endsAt: iso(DAY, "10:00"), startsAt: iso(DAY, "09:00") };

  test("touching ends do not overlap", () => {
    expect(overlapsBooked([nine], iso(DAY, "08:00"), iso(DAY, "09:00"))).toBe(
      false
    );
    expect(overlapsBooked([nine], iso(DAY, "10:00"), iso(DAY, "10:15"))).toBe(
      false
    );
  });

  test("a range running into a booking overlaps", () => {
    expect(overlapsBooked([nine], iso(DAY, "08:30"), iso(DAY, "09:15"))).toBe(
      true
    );
  });

  test("a booking falling inside the range overlaps", () => {
    expect(overlapsBooked([nine], iso(DAY, "08:00"), iso(DAY, "11:00"))).toBe(
      true
    );
  });
});
