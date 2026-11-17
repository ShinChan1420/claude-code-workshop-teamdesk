import { BOOKING_MIN_MINUTES, BOOKING_TITLE_MAX_LENGTH } from "@repo/db/shared";
import { type ChangeEvent, type FormEvent, useCallback, useState } from "react";
import { toast } from "sonner";
import FormError from "#/components/form-error";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
  type BookedInterval,
  nextFreeTime,
  overlapsBooked,
} from "#/lib/availability";
import { formatUtcTime, isoFromDayAndTime } from "#/lib/datetime";

export interface BookingDraft {
  attendees: number;
  endsAt: string;
  startsAt: string;
  title: string;
}

/** Times picked from the availability grid. `seq` changes on every pick. */
export interface BookingPrefill {
  end: string;
  seq: number;
  start: string;
}

const DEFAULT_TIMES: BookingPrefill = { end: "10:00", seq: 0, start: "09:00" };
const SLOT_MS = BOOKING_MIN_MINUTES * 60_000;
const TOAST_ID = "booking-times";
const OVERLAP_MESSAGE = "You cannot make a booking overlapping others.";

/** "09:00" -> "09:15" on `day`, or the same time if it would pass midnight. */
function plusOneSlot(day: string, time: string): string {
  const next = new Date(Date.parse(isoFromDayAndTime(day, time)) + SLOT_MS);
  const iso = next.toISOString();
  return iso.startsWith(day) ? formatUtcTime(iso) : time;
}

interface BookingFormProps {
  /** Active bookings in the room, to keep Start and End off other people's time. */
  booked: BookedInterval[];
  capacity: number;
  /** The chosen UTC day, YYYY-MM-DD. */
  day: string;
  error: string | null;
  onSubmit: (draft: BookingDraft) => Promise<boolean>;
  pending: boolean;
  prefill?: BookingPrefill | null;
}

export default function BookingForm({
  booked,
  capacity,
  day,
  error,
  onSubmit,
  pending,
  prefill,
}: BookingFormProps) {
  const times = prefill ?? DEFAULT_TIMES;
  const [start, setStart] = useState(times.start);
  const [end, setEnd] = useState(times.end);
  const [seenSeq, setSeenSeq] = useState(times.seq);

  // A new grid pick replaces whatever is in the time fields.
  if (times.seq !== seenSeq) {
    setSeenSeq(times.seq);
    setStart(times.start);
    setEnd(times.end);
  }

  const overlaps = useCallback(
    (startTime: string, endTime: string) =>
      overlapsBooked(
        booked,
        isoFromDayAndTime(day, startTime),
        isoFromDayAndTime(day, endTime)
      ),
    [booked, day]
  );

  const warnOverlap = useCallback(() => {
    toast.error(OVERLAP_MESSAGE, { id: TOAST_ID });
  }, []);

  const handleStartChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      if (!value) {
        setStart(value);
        return;
      }
      // Start may not sit inside a booking: skip to the next free time and
      // restart End at the minimum slot.
      const typed = isoFromDayAndTime(day, value);
      const free = nextFreeTime(booked, typed);
      if (free !== typed) {
        if (!free.startsWith(day)) {
          toast.error(`Nothing free after that on ${day}.`, { id: TOAST_ID });
          return;
        }
        const freeTime = formatUtcTime(free);
        const freeEnd = plusOneSlot(day, freeTime);
        setStart(freeTime);
        setEnd(freeEnd);
        if (overlaps(freeTime, freeEnd)) {
          warnOverlap();
        } else {
          toast.info(`That time is booked. Moved to ${freeTime}.`, {
            id: TOAST_ID,
          });
        }
        return;
      }
      // End always stays at least one slot after Start.
      const minEnd = plusOneSlot(day, value);
      const nextEnd = end < minEnd ? minEnd : end;
      setStart(value);
      setEnd(nextEnd);
      if (overlaps(value, nextEnd)) {
        warnOverlap();
      }
    },
    [booked, day, end, overlaps, warnOverlap]
  );

  const handleEndChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      if (!value) {
        setEnd(value);
        return;
      }
      const minEnd = plusOneSlot(day, start);
      const nextEnd = value < minEnd ? minEnd : value;
      setEnd(nextEnd);
      if (overlaps(start, nextEnd)) {
        warnOverlap();
      }
    },
    [day, overlaps, start, warnOverlap]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (overlaps(start, end)) {
        warnOverlap();
        return;
      }
      const form = event.currentTarget;
      const data = new FormData(form);
      const ok = await onSubmit({
        attendees: Number(data.get("attendees")),
        endsAt: isoFromDayAndTime(day, end),
        startsAt: isoFromDayAndTime(day, start),
        title: String(data.get("title") ?? ""),
      });
      if (ok) {
        form.reset();
      }
    },
    [day, end, onSubmit, overlaps, start, warnOverlap]
  );

  return (
    <form className="island-shell p-6 sm:p-8" onSubmit={handleSubmit}>
      <p className="island-kicker mb-3">New booking on {day} (times in UTC)</p>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] sm:items-end">
        <label className="grid gap-1 text-sm" htmlFor="booking-title">
          Title
          <Input
            id="booking-title"
            maxLength={BOOKING_TITLE_MAX_LENGTH}
            name="title"
            required
          />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="booking-start">
          Start
          <Input
            id="booking-start"
            name="startsAt"
            onChange={handleStartChange}
            required
            step={900}
            type="time"
            value={start}
          />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="booking-end">
          End
          <Input
            id="booking-end"
            name="endsAt"
            onChange={handleEndChange}
            required
            step={900}
            type="time"
            value={end}
          />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="booking-attendees">
          Attendees
          <Input
            defaultValue={1}
            id="booking-attendees"
            max={capacity}
            min={1}
            name="attendees"
            required
            type="number"
          />
        </label>
        <Button disabled={pending} type="submit">
          {pending ? "Booking…" : "Book"}
        </Button>
      </div>
      <FormError message={error} />
    </form>
  );
}
